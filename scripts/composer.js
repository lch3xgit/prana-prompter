/* ============================================================
   Prana-Prompter — Session Composer Modal
   Parse shorthand text, preview timeline, save/export
   ============================================================ */

(function () {
  'use strict';

  const modal = document.getElementById('composerModal');
  const openBtn = document.getElementById('openComposerBtn');
  const closeBtn = document.getElementById('closeComposerBtn');
  const saveBtn = document.getElementById('saveComposerBtn');
  const parseBtn = document.getElementById('parseComposerBtn');
  const importBtn = document.getElementById('importComposerBtn');
  const exportBtn = document.getElementById('exportComposerBtn');
  const exportCurrentBtn = document.getElementById('exportSessionBtn');

  // Form elements
  const sessionNameEl = document.getElementById('composerSessionName');
  const breathTextEl = document.getElementById('composerBreath');
  const textsTextEl = document.getElementById('composerTexts');
  const chordsTextEl = document.getElementById('composerChords');
  const soundsTextEl = document.getElementById('composerSounds');
  const previewEl = document.getElementById('previewTimeline');
  const durationEl = document.getElementById('previewDuration');
  const fileInput = document.getElementById('composerFileInput');

  let previewSession = null;

  // ---- Modal Open/Close ----
  function open() {
    modal.classList.add('open');
    // Load current session into editor if available
    if (window._currentSession) {
      loadSessionIntoEditor(window._currentSession);
    }
  }

  function close() {
    modal.classList.remove('open');
  }

  // ---- Parse input into session ----
  function parseComposer() {
    const name = sessionNameEl.value.trim() || 'untitled';
    const breathRaw = breathTextEl.value;
    const textsRaw = textsTextEl.value;
    const chordsRaw = chordsTextEl.value;
    const soundsRaw = soundsTextEl.value;

    // Combine all lines for the parser
    const fullScript = [
      breathRaw,
      textsRaw,
      chordsRaw,
      soundsRaw,
    ].filter(Boolean).join('\n');

    const session = PranaSession.parseScript(fullScript);
    session.name = name;
    session.version = '2.0';
    session.modified = new Date().toISOString();

    return session;
  }

  // ---- Preview ----
  function updatePreview() {
    try {
      previewSession = parseComposer();
      const flat = PranaSession.flatten(previewSession);

      // Total duration
      const totalMins = Math.floor(flat.totalTime / 60);
      const totalSecs = Math.floor(flat.totalTime % 60);
      durationEl.textContent = `Total: ${totalMins}m ${totalSecs}s`;

      // Build timeline HTML
      let html = '';

      // Breath phases
      if (flat.phases.length > 0) {
        html += '<div class="preview-section"><div class="preview-sec-title">Breath Phases</div>';
        flat.phases.forEach((ph, i) => {
          if (i < 50) { // Limit for performance
            const mins = Math.floor(ph.start / 60);
            const secs = Math.floor(ph.start % 60);
            const timeStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
            html += `<div class="preview-item breath-item">
              <span class="preview-time">${timeStr}</span>
              <span class="preview-phase">${ph.phase.replace('_', ' ')}</span>
              <span class="preview-dur">${ph.duration.toFixed(1)}s</span>
            </div>`;
          } else if (i === 50) {
            html += `<div class="preview-more">... ${flat.phases.length - 50} more phases ...</div>`;
          }
        });
        html += '</div>';
      }

      // Text cues
      if (previewSession.cues && previewSession.cues.length > 0) {
        html += '<div class="preview-section"><div class="preview-sec-title">Text Cues</div>';
        previewSession.cues.sort((a, b) => a.at - b.at).forEach(c => {
          const mins = Math.floor(c.at / 60);
          const secs = Math.floor(c.at % 60);
          html += `<div class="preview-item cue-item">
            <span class="preview-time">${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</span>
            <span class="preview-text">${c.text.substring(0, 60)}${c.text.length > 60 ? '...' : ''}</span>
          </div>`;
        });
        html += '</div>';
      }

      // Music cues
      if (previewSession.chords && previewSession.chords.length > 0) {
        html += '<div class="preview-section"><div class="preview-sec-title">Music Cues</div>';
        previewSession.chords.sort((a, b) => a.at - b.at).forEach(c => {
          const mins = Math.floor(c.at / 60);
          const secs = Math.floor(c.at % 60);
          html += `<div class="preview-item chord-item">
            <span class="preview-time">${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</span>
            <span class="preview-chord">${c.chord || '— clear —'}</span>
          </div>`;
        });
        html += '</div>';
      }

      // Sound cues
      if (previewSession.sounds && previewSession.sounds.length > 0) {
        html += '<div class="preview-section"><div class="preview-sec-title">Sound Cues</div>';
        previewSession.sounds.sort((a, b) => a.at - b.at).forEach(s => {
          const mins = Math.floor(s.at / 60);
          const secs = Math.floor(s.at % 60);
          html += `<div class="preview-item sound-item">
            <span class="preview-time">${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}</span>
            <span class="preview-sound">${s.type}${s.note ? ` (${s.note})` : ''}</span>
          </div>`;
        });
        html += '</div>';
      }

      if (!html) {
        html = '<div class="preview-empty">Enter breath script to generate preview</div>';
      }

      previewEl.innerHTML = html;
    } catch (err) {
      previewEl.innerHTML = `<div class="preview-error">Parse error: ${err.message}</div>`;
      durationEl.textContent = 'Total: —';
    }
  }

  // ---- Load existing session into editor ----
  function loadSessionIntoEditor(session) {
    sessionNameEl.value = session.name || '';

    // Export script from session
    const script = PranaSession.exportScript(session);

    // Split by marker lines to populate each field
    // (This is a best-effort reverse parse)
    const lines = script.split('\n');
    const breathLines = [];
    const textLines = [];
    const chordLines = [];
    const soundLines = [];

    lines.forEach(line => {
      if (line.startsWith('tcue:')) textLines.push(line);
      else if (line.startsWith('mcue:')) chordLines.push(line);
      else if (line.startsWith('sc:')) soundLines.push(line);
      else if (line.trim()) breathLines.push(line);
    });

    breathTextEl.value = breathLines.join('\n');
    textsTextEl.value = textLines.join('\n');
    chordsTextEl.value = chordLines.join('\n');
    soundsTextEl.value = soundLines.join('\n');

    updatePreview();
  }

  // ---- Save & Load ----
  async function saveAndLoad() {
    try {
      const session = parseComposer();
      if (!session || session.breath.length === 0) {
        alert('Please enter at least one breath phase before saving.');
        return;
      }

      await PranaSession.save(session);

      // Dispatch event to tell app.js to load this session
      const event = new CustomEvent('pranaSessionSaved', {
        detail: { session },
      });
      window.dispatchEvent(event);

      close();
    } catch (err) {
      alert('Save error: ' + err.message);
    }
  }

  // ---- Export current editor to file ----
  function exportFromComposer() {
    try {
      const session = parseComposer();
      PranaSession.export(session);
    } catch (err) {
      alert('Export error: ' + err.message);
    }
  }

  // ---- Import file into composer ----
  function importFile(file) {
    PranaSession.import(file).then(session => {
      loadSessionIntoEditor(session);
    }).catch(err => {
      alert('Import error: ' + err.message);
    });
  }

  // ---- Event Listeners ----
  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  parseBtn.addEventListener('click', updatePreview);
  saveBtn.addEventListener('click', saveAndLoad);
  exportBtn.addEventListener('click', exportFromComposer);
  exportCurrentBtn.addEventListener('click', exportFromComposer);

  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      importFile(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Close modal on overlay click or Escape
  document.querySelector('.modal-overlay').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // Keyboard shortcut to open composer
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'c' || e.key === 'C') {
      open();
    }
  });

  // Auto-preview on every input (debounced)
  let previewTimer;
  [breathTextEl, textsTextEl, chordsTextEl, soundsTextEl].forEach(el => {
    el.addEventListener('input', () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(updatePreview, 500);
    });
  });

  // ---- Export for app.js to use ----
  window.Composer = {
    open,
    close,
    parseComposer,
    updatePreview,
    loadSessionIntoEditor,
    exportFromComposer,
  };

})();
