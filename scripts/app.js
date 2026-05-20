/* ============================================================
   Prana-Prompter v0.4 — Main Application
   2-column layout, 2-row teleprompter, music strip, chimes
   ============================================================ */

(function () {
  'use strict';

  // ---- Canvas ----
  const canvas = document.getElementById('pacer');
  const ctx = canvas.getContext('2d');
  let dpr = 1;

  // ---- State ----
  let timeline = null;
  let session = null;
  let isPlaying = false;
  let isPaused = false;
  let startTime = 0;
  let animFrame = null;
  let wakeLock = null;

  // ---- DOM refs ----
  const el = {
    sessionSelect:  document.getElementById('sessionSelect'),
    sessionName:    document.getElementById('sessionName'),
    phaseLabel:     document.getElementById('phaseLabel'),
    phaseCountdown: document.getElementById('phaseCountdown'),
    totalTimer:     document.getElementById('totalTimer'),
    cueText:        document.getElementById('cueText'),
    cueNext:        document.getElementById('cueNext'),
    playBtn:        document.getElementById('playBtn'),
    stopBtn:        document.getElementById('stopBtn'),
    loadBtn:        document.getElementById('loadBtn'),
    themeToggle:    document.getElementById('themeToggle'),
    fileInput:      document.getElementById('fileInput'),
    musicVol:       document.getElementById('musicVol'),
    musicVolVal:    document.getElementById('musicVolVal'),
    chimeVol:       document.getElementById('chimeVol'),
    chimeVolVal:    document.getElementById('chimeVolVal'),
    cueVol:         document.getElementById('cueVol'),
    cueVolVal:      document.getElementById('cueVolVal'),
    elapsedTime:    document.getElementById('elapsedTime'),
    remainingTime:  document.getElementById('remainingTime'),
    currentRound:   document.getElementById('currentRound'),
    statusLeft:     document.getElementById('statusLeft'),
  };

  // ---- Audio ----
  let audioCtx = null;
  let musicSource = null;
  let musicGain = null;
  let chimeGain = null;
  let musicBuffer = null;
  let musicPlaying = false;
  let musicStartTime = 0;
  let musicOffset = 0;

  // ---- Played sounds tracking ----
  let playedSounds = new Set();

  function initAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = audioCtx.createGain();
      musicGain.connect(audioCtx.destination);
      chimeGain = audioCtx.createGain();
      chimeGain.connect(audioCtx.destination);
    }
  }

  // ---- Chime / Sound generation ----
  function playChime(note, type) {
    if (!audioCtx) initAudioCtx();
    const now = audioCtx.currentTime;
    const vol = chimeGain ? chimeGain.gain.value : 0.5;

    if (type === 'click') {
      // Wood block / click sound
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);
      gain.gain.setValueAtTime(vol * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } else {
      // Default chime (sine wave bell)
      const noteFreq = noteToFreq(note || 'C5');
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(noteFreq, now);
      gain.gain.setValueAtTime(vol * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 2.5);
    }
  }

  function noteToFreq(note) {
    const notes = { 'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63,
                    'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00,
                    'A#4': 466.16, 'B4': 493.88, 'C5': 523.25, 'C#5': 554.37, 'D5': 587.33,
                    'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99,
                    'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77 };
    return notes[note] || 523.25;
  }

  // ---- Helpers ----
  function fmtTime(s) {
    const m = Math.floor(Math.abs(s) / 60);
    const sec = Math.floor(Math.abs(s) % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function getColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      bg:       s.getPropertyValue('--pacer-bg').trim(),
      past:     '#3B3B55',
      future:   '#7B3FD9',
      ball:     '#A78BFA',
      ballGlow: 'rgba(167, 139, 250, 0.35)',
      grid:     '#1A1E3A',
      label:    '#4A4766',
      stripBg:  'rgba(123, 63, 217, 0.08)',
      stripText:'#A78BFA',
      stripBorder:'rgba(123, 63, 217, 0.25)',
    };
  }

  // ---- Canvas sizing ----
  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  }

  // ---- Breath level at time t ----
  function getBreathLevel(t) {
    if (!timeline) return 0.5;
    for (const p of timeline.phases) {
      if (t >= p.start && t < p.end) {
        const frac = (t - p.start) / p.duration;
        switch (p.phase) {
          case 'inhale':     return frac;
          case 'hold_in':    return 1;
          case 'exhale':     return 1 - frac;
          case 'hold_out':   return 0;
        }
      }
    }
    const last = timeline.phases[timeline.phases.length - 1];
    if (last) return last.phase === 'hold_in' ? 1 : 0;
    return 0.5;
  }

  // ---- Get current phase index ----
  function getCurrentPhase(t) {
    if (!timeline) return null;
    for (let i = 0; i < timeline.phases.length; i++) {
      if (t >= timeline.phases[i].start && t < timeline.phases[i].end) return i;
    }
    return timeline.phases.length - 1;
  }

  // ---- Find active and next cue at time ----
  function getCueAtTime(t) {
    if (!session || !session.cues || session.cues.length === 0) return null;
    const cues = [...session.cues].sort((a, b) => a.at - b.at);
    let active = null;
    let next = null;
    for (let i = 0; i < cues.length; i++) {
      if (cues[i].at <= t) { active = cues[i]; }
      else if (!next) { next = cues[i]; break; }
    }
    return { active, next };
  }

  // ---- Find active and next music cue at time ----
  function getChordAtTime(t) {
    if (!session || !session.chords || session.chords.length === 0) return null;
    const chords = [...session.chords].sort((a, b) => a.at - b.at);
    let active = null;
    let next = null;
    for (let i = 0; i < chords.length; i++) {
      if (chords[i].at <= t) { active = chords[i]; }
      else if (!next) { next = chords[i]; break; }
    }
    return { active, next };
  }

  // ---- Get current music cue text for strip ----
  function getCurrentChordText(t) {
    if (!session || !session.chords || session.chords.length === 0) return '';
    const sorted = [...session.chords].sort((a, b) => a.at - b.at);
    let active = null;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].at <= t) { active = sorted[i]; }
      else break;
    }
    return active ? active.chord : '';
  }

  // ---- Draw Graph ----
  function drawGraph(currentT) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const colors = getColors();

    const margin = 30;
    const ballR = 22;
    const stripH = 28; // music strip height
    const drawH = h - 2 * margin - 2 * ballR - stripH - 10;
    const centerX = w / 2;

    const visiblePast = 8;
    const visibleFuture = 8;
    const pps = (w / 2 - margin) / Math.max(visibleFuture, 1);

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    const topY = margin + ballR;
    const botY = topY + drawH;
    const midY = topY + drawH / 2;

    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.label;

    ctx.beginPath(); ctx.moveTo(margin, topY); ctx.lineTo(w - margin, topY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin, midY); ctx.lineTo(w - margin, midY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin, botY); ctx.lineTo(w - margin, botY); ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillStyle = colors.label;
    ctx.textAlign = 'left';
    ctx.fillText('FULL', margin + 4, topY - 6);
    ctx.fillText('HALF', margin + 4, midY - 6);
    ctx.fillText('EMPTY', margin + 4, botY + 16);

    // NOW marker
    ctx.strokeStyle = colors.ball;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.moveTo(centerX, margin); ctx.lineTo(centerX, h - margin - stripH - 10); ctx.stroke();
    ctx.globalAlpha = 1.0;

    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = colors.ball;
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.5;
    ctx.fillText('NOW', centerX, margin - 4);
    ctx.globalAlpha = 1.0;

    // Breath level
    const currentLevel = getBreathLevel(currentT);
    const currentY = topY + drawH * (1 - currentLevel);

    // Phases (for past trace)
    function buildPoints(startT, endT) {
      const pts = [];
      const step = 0.02;
      for (let t = startT; t < endT; t += step) {
        pts.push({ t, level: getBreathLevel(t) });
      }
      return pts;
    }

    // Future trace
    const futureStart = currentT;
    const futureEnd = Math.min(currentT + visibleFuture, timeline ? timeline.totalTime : 0);
    if (timeline && futureEnd > futureStart) {
      const pts = buildPoints(futureStart, futureEnd);
      if (pts.length >= 2) {
        ctx.strokeStyle = colors.future;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
        ctx.beginPath();
        const firstDt = pts[0].t - currentT;
        ctx.moveTo(centerX + firstDt * pps, topY + drawH * (1 - pts[0].level));
        for (let i = 1; i < pts.length; i++) {
          const dt = pts[i].t - currentT;
          const x = centerX + dt * pps;
          if (x > w - margin) break;
          const y = topY + drawH * (1 - pts[i].level);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // Past trace
    const pastStart = Math.max(0, currentT - visiblePast);
    if (timeline && currentT > pastStart) {
      const pts = buildPoints(pastStart, currentT);
      if (pts.length >= 2) {
        ctx.strokeStyle = colors.past;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
        ctx.beginPath();
        const lastPt = pts[pts.length - 1];
        const lastDt = lastPt.t - currentT;
        ctx.moveTo(centerX + lastDt * pps, topY + drawH * (1 - lastPt.level));
        for (let i = pts.length - 2; i >= 0; i--) {
          const dt = pts[i].t - currentT;
          const x = centerX + dt * pps;
          if (x < margin) break;
          const y = topY + drawH * (1 - pts[i].level);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // Ball
    ctx.shadowColor = colors.ballGlow;
    ctx.shadowBlur = 25;
    ctx.fillStyle = colors.ball;
    ctx.beginPath();
    ctx.arc(centerX, currentY, ballR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ---- Music Cue Strip ----
    const stripY = h - margin - stripH;
    if (session && session.chords && session.chords.length > 0) {
      // Draw strip background
      ctx.fillStyle = colors.stripBg;
      ctx.fillRect(margin, stripY, w - 2 * margin, stripH);
      ctx.strokeStyle = colors.stripBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(margin, stripY, w - 2 * margin, stripH);

      // Draw music cue blocks
      const sorted = [...session.chords].sort((a, b) => a.at - b.at);
      const stripStart = currentT - visiblePast;
      const stripEnd = currentT + visibleFuture;
      const stripPxPerSec = (w - 2 * margin) / (visiblePast + visibleFuture);

      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        const nextC = sorted[i + 1];
        const blockStart = c.at;
        const blockEnd = nextC ? nextC.at : (timeline ? timeline.totalTime : blockStart + 60);

        // Check if visible
        if (blockEnd < stripStart || blockStart > stripEnd) continue;

        const relStart = blockStart - currentT;
        const relEnd = blockEnd - currentT;
        const x1 = centerX + relStart * stripPxPerSec;
        const x2 = centerX + relEnd * stripPxPerSec;
        const drawX1 = Math.max(margin, x1);
        const drawX2 = Math.min(w - margin, x2);
        const drawW = Math.max(0, drawX2 - drawX1);

        if (drawW <= 0) continue;

        // Alternate subtle colors
        const isActive = currentT >= blockStart && currentT < blockEnd;
        ctx.fillStyle = isActive ? 'rgba(167, 139, 250, 0.2)' : 'rgba(123, 63, 217, 0.08)';
        ctx.fillRect(drawX1, stripY + 1, drawW, stripH - 2);

        // Text
        if (drawW > 20 && c.chord) {
          ctx.fillStyle = isActive ? colors.ball : colors.stripText;
          ctx.font = isActive ? 'bold 10px JetBrains Mono, monospace' : '10px JetBrains Mono, monospace';
          const textX = (drawX1 + drawX2) / 2;
          const textY = stripY + stripH / 2;
          ctx.fillText(c.chord, textX, textY);
        }

        // Separator line between blocks
        if (nextC) {
          ctx.strokeStyle = 'rgba(123, 63, 217, 0.2)';
          ctx.lineWidth = 1;
          const sepX = centerX + (nextC.at - currentT) * stripPxPerSec;
          if (sepX >= margin && sepX <= w - margin) {
            ctx.beginPath();
            ctx.moveTo(sepX, stripY + 1);
            ctx.lineTo(sepX, stripY + stripH - 1);
            ctx.stroke();
          }
        }
      }

      // Left edge of strip
      ctx.fillStyle = colors.label;
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('▶', margin + 4, stripY + stripH / 2);

      // Current chord indicator
      const currentChord = getCurrentChordText(currentT);
      if (currentChord) {
        ctx.textAlign = 'right';
        ctx.fillStyle = colors.ball;
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillText(currentChord, w - margin - 4, stripY + stripH / 2);
      }
    } else {
      // No chords: just show empty strip
      ctx.fillStyle = 'rgba(123, 63, 217, 0.04)';
      ctx.fillRect(margin, stripY, w - 2 * margin, stripH);
      ctx.strokeStyle = 'rgba(123, 63, 217, 0.1)';
      ctx.lineWidth = 1;
      ctx.strokeRect(margin, stripY, w - 2 * margin, stripH);
      ctx.fillStyle = colors.label;
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('no music cues', centerX, stripY + stripH / 2);
    }
  }

  // ---- Update UI (timers, cues) ----
  function updateUI(elapsed) {
    const t = elapsed;
    const total = timeline ? timeline.totalTime : 0;
    const remaining = Math.max(0, total - t);

    // Timers
    el.totalTimer.textContent = `REMAINING ${fmtTime(remaining)}`;
    if (el.remainingTime) el.remainingTime.textContent = fmtTime(remaining);
    if (el.elapsedTime) el.elapsedTime.textContent = fmtTime(t);

    // Phase info
    const phaseIdx = getCurrentPhase(t);
    if (phaseIdx !== null && timeline) {
      const phase = timeline.phases[phaseIdx];
      const name = phase.phase.toUpperCase().replace('_', ' ');
      const phaseElapsed = t - phase.start;
      const phaseRemaining = Math.max(0, phase.duration - phaseElapsed);
      el.phaseLabel.textContent = name;
      el.phaseCountdown.textContent = `${phaseRemaining.toFixed(1)}s`;
      if (el.currentRound) el.currentRound.textContent = phase.round ? `R${phase.round}` : '—';
    } else {
      el.phaseLabel.textContent = '—';
      el.phaseCountdown.textContent = '0.0s';
    }

    // Cues (Row B)
    const cue = getCueAtTime(t);
    if (cue && cue.active) {
      el.cueText.textContent = cue.active.text;
      el.cueText.classList.remove('inactive');
    } else {
      el.cueText.textContent = isPlaying ? '' : 'awaiting session...';
      el.cueText.classList.add('inactive');
    }

    if (cue && cue.next) {
      el.cueNext.textContent = `→ ${fmtTime(cue.next.at)}: ${cue.next.text.substring(0, 40)}`;
    } else {
      el.cueNext.textContent = '';
    }

    // Status
    el.statusLeft.textContent = `${isPlaying ? 'playing' : 'ready'}: ${session ? session.name : '—'} (${fmtTime(remaining)})`;
  }

  // ---- Play sounds at their timestamps ----
  function playSoundsAtTime(t) {
    if (!session || !session.sounds || session.sounds.length === 0) return;
    for (const s of session.sounds) {
      const key = `${s.at}-${s.type}-${s.note || ''}`;
      if (s.at <= t && !playedSounds.has(key)) {
        playChime(s.note, s.type);
        playedSounds.add(key);
      }
    }
  }

  // ---- Animation Loop ----
  function loop() {
    if (!isPlaying || isPaused) return;
    const elapsed = (performance.now() - startTime) / 1000;

    if (timeline && elapsed >= timeline.totalTime) {
      stopSession();
      return;
    }

    playSoundsAtTime(elapsed);
    drawGraph(elapsed);
    updateUI(elapsed);
    animFrame = requestAnimationFrame(loop);
  }

  // ---- Transport ----
  function playSession() {
    if (isPlaying && isPaused) {
      isPaused = false;
      startTime = performance.now() - (pauseTime || 0) * 1000;
      requestWakeLock();
      loop();
      updateTransportUI();
      return;
    }
    if (!timeline || timeline.phases.length === 0) {
      el.statusLeft.textContent = 'error: no session loaded';
      return;
    }
    isPlaying = true;
    isPaused = false;
    startTime = performance.now();
    // Reset played sounds
    playedSounds.clear();
    requestWakeLock();
    loop();
    updateTransportUI();
  }

  let pauseTime = 0;

  function pauseSession() {
    if (!isPlaying || isPaused) return;
    isPaused = true;
    pauseTime = (performance.now() - startTime) / 1000;
    if (animFrame) cancelAnimationFrame(animFrame);
    releaseWakeLock();
    updateTransportUI();
  }

  function stopSession() {
    isPlaying = false;
    isPaused = false;
    pauseTime = 0;
    if (animFrame) cancelAnimationFrame(animFrame);
    releaseWakeLock();
    playedSounds.clear();
    drawGraph(0);
    updateUI(0);
    el.phaseLabel.textContent = '—';
    el.phaseCountdown.textContent = '0.0s';
    el.cueText.textContent = 'awaiting session...';
    el.cueText.classList.add('inactive');
    updateTransportUI();
  }

  function updateTransportUI() {
    if (el.playBtn) el.playBtn.disabled = isPlaying && !isPaused;
    if (el.stopBtn) el.stopBtn.disabled = !isPlaying && !isPaused;
  }

  // ---- Load Session ----
  async function loadSessionFile(file) {
    try {
      const s = await PranaSession.import(file);
      setSession(s);
      await PranaSession.save(s);
      el.statusLeft.textContent = `loaded: ${s.name}`;
      updateSessionSelector();
    } catch (err) {
      el.statusLeft.textContent = `error: ${err.message}`;
    }
  }

  function setSession(s) {
    session = s;
    timeline = PranaSession.flatten(s);
    if (el.sessionName) el.sessionName.textContent = s.name;
    if (el.totalTimer) el.totalTimer.textContent = `REMAINING ${fmtTime(timeline.totalTime)}`;
    el.statusLeft.textContent = `ready: ${s.name} (${fmtTime(timeline.totalTime)})`;
    drawGraph(0);
    updateUI(0);
  }

  // ---- Session Selector ----
  async function updateSessionSelector() {
    try {
      const names = await PranaSession.list();
      el.sessionSelect.innerHTML = '<option value="">— select session —</option>';
      for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        el.sessionSelect.appendChild(opt);
      }
    } catch (e) {
      console.error('Failed to list sessions:', e);
    }
  }

  async function handleSessionSelect(e) {
    const name = e.target.value;
    if (!name) return;
    try {
      const s = await PranaSession.load(name);
      if (s) {
        setSession(s);
        el.statusLeft.textContent = `loaded: ${s.name}`;
      }
    } catch (err) {
      el.statusLeft.textContent = `error loading session: ${err.message}`;
    }
  }

  // ---- Wake Lock ----
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) {}
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
  }

  // ---- Theme Toggle ----
  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    document.getElementById('theme-dark').disabled = (next !== 'dark');
    document.getElementById('theme-light').disabled = (next !== 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'dark' ? '#0A0E1A' : '#F5F0EB';
    const elapsed = isPlaying ? (performance.now() - startTime) / 1000 : 0;
    drawGraph(elapsed);
  }

  // ---- Sliders ----
  function setupSliders() {
    if (el.musicVol) {
      el.musicVol.addEventListener('input', () => {
        if (el.musicVolVal) el.musicVolVal.textContent = el.musicVol.value;
        if (musicGain) musicGain.gain.value = el.musicVol.value / 100;
      });
    }
    if (el.chimeVol) {
      el.chimeVol.addEventListener('input', () => {
        if (el.chimeVolVal) el.chimeVolVal.textContent = el.chimeVol.value;
      });
    }
    if (el.cueVol) {
      el.cueVol.addEventListener('input', () => {
        if (el.cueVolVal) el.cueVolVal.textContent = el.cueVol.value;
      });
    }
  }

  // ---- Music player ----
  function loadMusicFile(file) {
    initAudioCtx();
    const reader = new FileReader();
    reader.onload = (e) => {
      audioCtx.decodeAudioData(e.target.result, (buffer) => {
        musicBuffer = buffer;
        const name = file.name.replace(/\.[^.]+$/, '').substring(0, 20);
        if (document.getElementById('musicName')) document.getElementById('musicName').textContent = name;
        if (document.getElementById('musicPlayBtn')) document.getElementById('musicPlayBtn').disabled = false;
        el.statusLeft.textContent = `music loaded: ${name}`;
      }, () => { el.statusLeft.textContent = 'error: could not decode audio'; });
    };
    reader.readAsArrayBuffer(file);
  }

  function toggleMusic() {
    if (!musicBuffer) return;
    initAudioCtx();
    const btn = document.getElementById('musicPlayBtn');
    if (musicPlaying) {
      musicOffset += audioCtx.currentTime - musicStartTime;
      if (musicOffset >= musicBuffer.duration) musicOffset = 0;
      if (musicSource) { musicSource.stop(); musicSource = null; }
      musicPlaying = false;
      if (btn) { btn.textContent = '▸'; btn.classList.remove('active'); }
    } else {
      musicSource = audioCtx.createBufferSource();
      musicSource.buffer = musicBuffer;
      musicSource.loop = true;
      musicSource.connect(musicGain);
      musicStartTime = audioCtx.currentTime;
      musicSource.start(0, musicOffset);
      musicPlaying = true;
      if (btn) { btn.textContent = '⏸'; btn.classList.add('active'); }
    }
  }

  // ---- Keyboard ----
  function handleKeydown(e) {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space': e.preventDefault(); if (isPlaying && !isPaused) pauseSession(); else playSession(); break;
      case 'Enter': e.preventDefault(); break;
      case 'KeyR': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); stopSession(); } break;
    }
  }

  // ---- Listen for composer save event ----
  window.addEventListener('pranaSessionSaved', (e) => {
    if (e.detail && e.detail.session) {
      setSession(e.detail.session);
      el.statusLeft.textContent = `loaded: ${e.detail.session.name}`;
      updateSessionSelector();
    }
  });

  // ---- Init ----
  function init() {
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); drawGraph(0); });

    if (el.playBtn) el.playBtn.addEventListener('click', playSession);
    if (el.stopBtn) el.stopBtn.addEventListener('click', stopSession);
    if (el.themeToggle) el.themeToggle.addEventListener('click', toggleTheme);

    if (el.loadBtn) el.loadBtn.addEventListener('click', () => el.fileInput.click());
    if (el.fileInput) {
      el.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) { loadSessionFile(e.target.files[0]); e.target.value = ''; }
      });
    }

    if (el.sessionSelect) el.sessionSelect.addEventListener('change', handleSessionSelect);

    // Music controls
    const musicLoadBtn = document.getElementById('musicLoadBtn');
    const musicFileInput = document.getElementById('musicFileInput');
    const musicPlayBtn = document.getElementById('musicPlayBtn');
    if (musicLoadBtn && musicFileInput) musicLoadBtn.addEventListener('click', () => musicFileInput.click());
    if (musicFileInput) {
      musicFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) { loadMusicFile(e.target.files[0]); e.target.value = ''; }
      });
    }
    if (musicPlayBtn) musicPlayBtn.addEventListener('click', toggleMusic);

    document.addEventListener('keydown', handleKeydown);
    setupSliders();
    updateTransportUI();

    // Load default session
    const defaultSession = {
      name: 'Holotropic 45min',
      version: '2.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      breath: [
        { phase: 'inhale', duration: 2 }, { phase: 'hold_in', duration: 1.5 },
        { phase: 'exhale', duration: 3 }, { phase: 'hold_out', duration: 1 },
      ],
      cues: [
        { at: 0,  text: "Begin. Let the breath move through you like a gentle wave." },
        { at: 30, text: "If any tension arises, send the breath there. Soften into it." },
        { at: 60, text: "Let go of any expectation. The breath knows what to do." },
        { at: 90, text: "Allow the energy to move upward through the spine." },
        { at: 120, text: "O son of Kuntī, the nonpermanent appearance of happiness and distress, and their disappearance in due course, are like the appearance and disappearance of winter and summer seasons. They arise from sense perception, O scion of Bharata, and one must learn to tolerate them without being disturbed." },
        { at: 150, text: "Return to the breath. Each inhale is a new beginning." },
        { at: 180, text: "Fully release. Empty completely. Trust the pause." },
        { at: 210, text: "Rest in the space between breaths." },
        { at: 240, text: "Deepen. The body opens as the breath lengthens." },
        { at: 270, text: "Let sound arise if it wishes. Let movement happen." },
      ],
      chords: [
        { at: 0,  chord: "C Major" },
        { at: 15, chord: "Am" },
        { at: 30, chord: "F" },
        { at: 45, chord: "G" },
        { at: 60, chord: "C Major" },
        { at: 75, chord: "G" },
        { at: 90, chord: "Am" },
        { at: 105, chord: "F" },
        { at: 120, chord: "C Major" },
        { at: 135, chord: "Am" },
        { at: 150, chord: "F" },
        { at: 165, chord: "G" },
      ],
      sounds: [
        { at: 0,  type: 'chime', note: 'C5' },
        { at: 120, type: 'chime', note: 'E5' },
      ],
      rounds: 36,
      totalDuration: 2700,
    };
    setSession(defaultSession);
    updateSessionSelector();
    updateUI(0);
  }

  init();
})();
