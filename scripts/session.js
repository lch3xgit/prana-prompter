/* ============================================================
   Prana-Prompter — Session Engine v2.0
   JSON session format, parser, save/load via IndexedDB + File API
   Added: sounds (chime cues), phase labels, composer integration
   ============================================================ */

const PranaSession = (() => {

  const DB_NAME = 'prana-prompter';
  const DB_VERSION = 3; // bumped for sounds + label field
  const STORE_NAME = 'sessions';
  let db = null;

  // ---- Session Schema v2.0 ----
  // {
  //   name: string,
  //   version: '2.0',
  //   created: ISO date,
  //   modified: ISO date,
  //   breath: [ { phase: 'inhale'|'hold_in'|'exhale'|'hold_out',
  //               duration: number, label?: string } ],
  //   cues: [     { at: number (seconds from start), text: string } ],
  //   chords: [   { at: number, chord: string } ],
  //   sounds: [   { at: number, type: 'chime'|'click', note: string } ],
  //   rounds: number | 'auto',
  //   totalDuration: number | null
  // }

  function createSession(name, breathPhases, options = {}) {
    const now = new Date().toISOString();
    return {
      name: name || 'untitled',
      version: '2.0',
      created: now,
      modified: now,
      breath: breathPhases || [],
      cues: options.cues || [],
      chords: options.chords || [],
      sounds: options.sounds || [],
      rounds: options.rounds || 1,
      totalDuration: options.totalDuration || null,
    };
  }

  // ---- Flatten breath phases into timeline ----
  // Converts session.breath + rounds into a flat array of phases
  // with absolute start times for the engine
  function flattenBreath(session) {
    const phases = [];
    const totalRounds = session.rounds === 'auto' ? 999 : session.rounds;
    let t = 0;

    for (let r = 0; r < totalRounds; r++) {
      for (const p of session.breath) {
        phases.push({
          phase: p.phase,
          duration: p.duration,
          cue: p.cue || null,
          label: p.label || null,
          start: t,
          end: t + p.duration,
          round: r + 1,
        });
        t += p.duration;

        // If totalDuration is set, stop when we exceed it
        if (session.totalDuration && t >= session.totalDuration) {
          // Truncate last phase to fit exactly
          if (t > session.totalDuration) {
            const overflow = t - session.totalDuration;
            phases[phases.length - 1].duration -= overflow;
            phases[phases.length - 1].end = session.totalDuration;
          }
          return { phases, totalTime: session.totalDuration };
        }
      }
    }

    return { phases, totalTime: t };
  }

  // ---- Parse shorthand text script ----
  // Format:
  //   repeat 30: inhale 2, hold in 2, exhale 2, hold out 2
  //   hold out 45
  //   tcue: "this is the text that ill read at the next time", 1800
  //   mcue: "C Major -> F Major", 2000
  //   sc: "chime", 3600
  function parseScript(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const breathPhases = [];
    const cues = [];
    const chords = [];
    const sounds = [];

    for (const line of lines) {
      // Text cue: tcue: "text", seconds
      const tcueMatch = line.match(/^tcue:\s*"([^"]+)",\s*(\d+(?:\.\d+)?)$/);
      if (tcueMatch) {
        cues.push({ at: parseFloat(tcueMatch[2]), text: tcueMatch[1] });
        continue;
      }

      // Music cue: mcue: "chord text", seconds
      const mcueMatch = line.match(/^mcue:\s*"([^"]*)"\s*,\s*(\d+(?:\.\d+)?)$/);
      if (mcueMatch) {
        chords.push({ at: parseFloat(mcueMatch[2]), chord: mcueMatch[1] });
        continue;
      }

      // Sound cue: sc: "type"[ note], seconds
      // Format: sc: "chime", "C5", 3600  OR  sc: "click", 3600
      const scMatch = line.match(/^sc:\s*"(\w+)"(?:\s*,\s*"([^"]+)")?,?\s*(\d+(?:\.\d+)?)\s*$/);
      if (scMatch) {
        const type = scMatch[1];
        const note = scMatch[2] || null;
        const at = parseFloat(scMatch[3]);
        sounds.push({ at, type, note });
        continue;
      }

      // Repeat block: repeat N: phase1 dur1, phase2 dur2, ...
      const repeatMatch = line.match(/^repeat\s+(\d+)\s*:\s*(.*)$/i);
      if (repeatMatch) {
        const n = parseInt(repeatMatch[1]);
        const subPhases = parsePhaseList(repeatMatch[2]);
        for (let i = 0; i < n; i++) {
          breathPhases.push(...subPhases);
        }
        continue;
      }

      // Plain phase list
      const plainPhases = parsePhaseList(line);
      if (plainPhases.length > 0) {
        breathPhases.push(...plainPhases);
      }
    }

    return createSession('imported', breathPhases, { cues, chords, sounds });
  }

  function parsePhaseList(str) {
    if (!str) return [];
    const items = str.split(',').map(s => s.trim()).filter(Boolean);
    const phases = [];
    for (const item of items) {
      const match = item.match(/^(inhale|exhale|hold\s+in|hold\s+out)\s+(\d+(?:\.\d+)?)$/i);
      if (!match) continue;
      const type = match[1].toLowerCase().replace(/\s+/g, '_');
      const dur = parseFloat(match[2]);
      if (dur <= 0) continue;
      phases.push({ phase: type, duration: dur });
    }
    return phases;
  }

  // ---- Export to script text (reverse of parse) ----
  function exportScript(session) {
    const lines = [];
    // Breath phases
    // TODO: Detect repeats and coalesce into repeat N: syntax
    // For now, just list them linearly
    let lastRepeat = 0;
    for (let i = 0; i < session.breath.length; i++) {
      const p = session.breath[i];
      lines.push(`${p.phase.replace('_', ' ')} ${p.duration}`);
    }

    // Cues
    if (session.cues && session.cues.length > 0) {
      for (const c of session.cues.sort((a, b) => a.at - b.at)) {
        lines.push(`tcue: "${c.text}", ${c.at}`);
      }
    }

    // Music cues
    if (session.chords && session.chords.length > 0) {
      for (const c of session.chords.sort((a, b) => a.at - b.at)) {
        lines.push(`mcue: "${c.chord}", ${c.at}`);
      }
    }

    // Sound cues
    if (session.sounds && session.sounds.length > 0) {
      for (const s of session.sounds.sort((a, b) => a.at - b.at)) {
        if (s.note) {
          lines.push(`sc: "${s.type}", "${s.note}", ${s.at}`);
        } else {
          lines.push(`sc: "${s.type}", ${s.at}`);
        }
      }
    }

    return lines.join('\n');
  }

  // ---- IndexedDB: Save/Load ----
  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          d.createObjectStore(STORE_NAME, { keyPath: 'name' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function saveSession(session) {
    const d = await openDB();
    session.modified = new Date().toISOString();
    // Ensure schema version
    session.version = '2.0';
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(session);
      tx.oncomplete = () => resolve({ status: 'saved', name: session.name });
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function loadSession(name) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function listSessions() {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteSession(name) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(name);
      tx.oncomplete = () => resolve({ status: 'deleted', name });
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ---- File Export/Import ----
  function exportSession(session) {
    const json = JSON.stringify(session, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.name.replace(/\s+/g, '-').toLowerCase()}.prana.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSession(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const session = JSON.parse(e.target.result);
          // Validate minimum schema
          if (!session.breath || !Array.isArray(session.breath)) {
            throw new Error('Invalid session: missing breath array');
          }
          // Migrate old versions if needed
          if (!session.version || session.version < '2.0') {
            session.sounds = session.sounds || [];
            session.version = '2.0';
          }
          resolve(session);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsText(file);
    });
  }

  // Public API
  return {
    create: createSession,
    flatten: flattenBreath,
    parseScript,
    exportScript,
    save: saveSession,
    load: loadSession,
    list: listSessions,
    delete: deleteSession,
    export: exportSession,
    import: importSession,
  };

})();
