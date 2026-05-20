/* ============================================================
   Prana-Prompter v0.3 — Main Application
   2-column layout, 3-row teleprompter, iridescent theme
   ============================================================ */

(function () {
  'use strict';

  // ---- Canvas ----
  const canvas = document.getElementById('pacer');
  const ctx = canvas.getContext('2d');
  let dpr = 1;

  // ---- State ----
  let timeline = null; // from PranaSession.flatten()
  let session = null;
  let isPlaying = false;
  let isPaused = false;
  let startTime = 0;
  let animFrame = null;
  let wakeLock = null;

  // ---- DOM refs ----
  const el = {
    sessionName:    document.getElementById('sessionName'),
    phaseLabel:     document.getElementById('phaseLabel'),
    phaseCountdown: document.getElementById('phaseCountdown'),
    totalTimer:     document.getElementById('totalTimer'),
    cueText:        document.getElementById('cueText'),
    cueNext:        document.getElementById('cueNext'),
    chordCurrent:   document.getElementById('chordCurrent'),
    chordNext:      document.getElementById('chordNext'),
    playBtn:        document.getElementById('playBtn'),
    pauseBtn:       document.getElementById('pauseBtn'),
    stopBtn:        document.getElementById('stopBtn'),
    loadBtn:        document.getElementById('loadBtn'),
    themeToggle:    document.getElementById('themeToggle'),
    fileInput:      document.getElementById('fileInput'),
    musicVol:       document.getElementById('musicVol'),
    musicVolVal:    document.getElementById('musicVolVal'),
    breathVol:      document.getElementById('breathVol'),
    breathVolVal:   document.getElementById('breathVolVal'),
    cueVol:         document.getElementById('cueVol'),
    cueVolVal:      document.getElementById('cueVolVal'),
    elapsedTime:    document.getElementById('elapsedTime'),
    remainingTime:  document.getElementById('remainingTime'),
    currentRound:   document.getElementById('currentRound'),
    statusLeft:     document.getElementById('statusLeft'),
  };

  // ---- Music Player (Web Audio) ----
  let audioCtx = null;
  let musicSource = null;
  let musicGain = null;
  let musicBuffer = null;
  let musicPlaying = false;
  let musicStartTime = 0;
  let musicOffset = 0;

  function initAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      musicGain = audioCtx.createGain();
      musicGain.connect(audioCtx.destination);
    }
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
      chordLine:'#FBBF24',
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
    // Past end: return last known level
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
      if (cues[i].at <= t) {
        active = cues[i];
      } else if (!next) {
        next = cues[i];
        break;
      }
    }
    return { active, next };
  }

  // ---- Find active and next chord at time ----
  function getChordAtTime(t) {
    if (!session || !session.chords || session.chords.length === 0) return null;
    const chords = [...session.chords].sort((a, b) => a.at - b.at);

    let active = null;
    let next = null;

    for (let i = 0; i < chords.length; i++) {
      if (chords[i].at <= t) {
        active = chords[i];
      } else if (!next) {
        next = chords[i];
        break;
      }
    }
    return { active, next };
  }

  // ---- Draw Graph ----
  function drawGraph(currentT) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const colors = getColors();

    const margin = 30;
    const ballR = 22;
    const drawH = h - 2 * margin - 2 * ballR;
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
    const botY = margin + ballR + drawH;
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
    ctx.beginPath(); ctx.moveTo(centerX, margin); ctx.lineTo(centerX, h - margin); ctx.stroke();
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

    // Trace: SINGLE continuous path per side
    const step = 0.02;

    function buildPoints(startT, endT) {
      const pts = [];
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
  }

  // ---- Update UI (timers, cues, chords) ----
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

    // Chords (Row C)
    const chord = getChordAtTime(t);
    if (chord && chord.active) {
      el.chordCurrent.textContent = `♪ ${chord.active.chord}`;
    } else {
      el.chordCurrent.textContent = '—';
    }

    if (chord && chord.next) {
      el.chordNext.textContent = `→ ${chord.next.chord}`;
    } else {
      el.chordNext.textContent = '';
    }

    el.statusLeft.textContent = `${isPlaying ? 'playing' : 'ready'}: ${session ? session.name : '—'} (${fmtTime(remaining)})`;
  }

  // ---- Animation Loop ----
  function loop() {
    if (!isPlaying || isPaused) return;
    const elapsed = (performance.now() - startTime) / 1000;

    if (timeline && elapsed >= timeline.totalTime) {
      stopSession();
      return;
    }

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
    drawGraph(0);
    updateUI(0);
    el.phaseLabel.textContent = '—';
    el.phaseCountdown.textContent = '0.0s';
    el.cueText.textContent = 'awaiting session...';
    el.cueText.classList.add('inactive');
    el.chordCurrent.textContent = '—';
    el.chordNext.textContent = '';
    updateTransportUI();
  }

  function updateTransportUI() {
    if (el.playBtn) el.playBtn.disabled = isPlaying && !isPaused;
    if (el.pauseBtn) el.pauseBtn.disabled = !isPlaying || isPaused;
    if (el.stopBtn) el.stopBtn.disabled = !isPlaying && !isPaused;
  }

  // ---- Load Session ----
  async function loadSessionFile(file) {
    try {
      const s = await PranaSession.import(file);
      setSession(s);
      await PranaSession.save(s);
      el.statusLeft.textContent = `loaded: ${s.name}`;
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
    // Music slider controls gain
    if (el.musicVol) {
      el.musicVol.addEventListener('input', () => {
        if (el.musicVolVal) el.musicVolVal.textContent = el.musicVol.value;
        if (musicGain) musicGain.gain.value = el.musicVol.value / 100;
      });
    }
    const pairs = [[el.breathVol, el.breathVolVal], [el.cueVol, el.cueVolVal]];
    for (const [slider, display] of pairs) {
      if (!slider || !display) continue;
      slider.addEventListener('input', () => { display.textContent = slider.value; });
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

  // ---- Init ----
  function init() {
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); drawGraph(0); });

    if (el.playBtn) el.playBtn.addEventListener('click', playSession);
    if (el.pauseBtn) el.pauseBtn.addEventListener('click', pauseSession);
    if (el.stopBtn) el.stopBtn.addEventListener('click', stopSession);
    if (el.themeToggle) el.themeToggle.addEventListener('click', toggleTheme);

    if (el.loadBtn) el.loadBtn.addEventListener('click', () => el.fileInput.click());
    if (el.fileInput) {
      el.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) { loadSessionFile(e.target.files[0]); e.target.value = ''; }
      });
    }

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
      version: '1.1',
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
      rounds: 36,
      totalDuration: 2700,
    };
    setSession(defaultSession);
    updateUI(0);
  }

  init();
})();
