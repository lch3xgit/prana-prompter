/* ============================================================
   Prana-Prompter — Session Engine
   JSON session format, parser, save/load via IndexedDB + File API
   ============================================================ */

const PranaSession = (() => {

  const DB_NAME = 'prana-prompter';
  const DB_VERSION = 1;
  const STORE_NAME = 'sessions';
  let db = null;

  // ---- Session Schema ----
  // A session defines a complete breathwork sequence:
  // {
  //   name: string,
  //   version: '1.0',
  //   created: ISO date,
  //   modified: ISO date,
  //   breath: [ { phase: 'inhale'|'hold_in'|'exhale'|'hold_out', duration: number, cue: string? } ],
  //   cues: [ { at: number (seconds from start), text: string, voice: boolean? } ],
  //   music: { source: string?, volume: number, duckDuringCues: boolean },
  //   rounds: number | 'auto'  // 'auto' = repeat until total duration
  //   totalDuration: number | null  // if set, overrides round-based calc
  // }

  function createSession(name, breathPhases, options = {}) {
    const now = new Date().toISOString();
    return {
      name: name || 'untitled',
      version: '1.0',
      created: now,
      modified: now,
      breath: breathPhases || [],
      cues: options.cues || [],
      music: options.music || { source: null, volume: 0.7, duckDuringCues: true },
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

  // ---- Parse text script (compatible with old pacer format) ----
  function parseScript(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const breathPhases = [];

    for (const line of lines) {
      const repeatMatch = line.match(/^repeat\s+(\d+)\s*:\s*(.*)$/i);
      if (repeatMatch) {
        const n = parseInt(repeatMatch[1]);
        const subPhases = parsePhaseList(repeatMatch[2]);
        for (let i = 0; i < n; i++) {
          breathPhases.push(...subPhases.map(p => ({ ...p, round: i + 1 })));
        }
      } else {
        const subPhases = parsePhaseList(line);
        breathPhases.push(...subPhases);
      }
    }

    return createSession('imported', breathPhases);
  }

  function parsePhaseList(str) {
    const items = str.split(',').map(s => s.trim());
    const phases = [];
    for (const item of items) {
      const match = item.match(/^(inhale|exhale|hold\s+in|hold\s+out)\s+(\d+(\.\d+)?)$/i);
      if (!match) continue;
      const type = match[1].toLowerCase().replace(/\s+/g, '_');
      const dur = parseFloat(match[2]);
      if (dur <= 0) continue;
      phases.push({ phase: type, duration: dur });
    }
    return phases;
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
    save: saveSession,
    load: loadSession,
    list: listSessions,
    delete: deleteSession,
    export: exportSession,
    import: importSession,
  };

})();
