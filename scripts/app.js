/* ============================================================
   Prana-Prompter v0.2 — Main Application
   Canvas animation, teleprompter, transport, wake lock
   ============================================================ */

const PranaApp = (() => {

  // ---- State ----
  let session = null;        // Current session object
  let timeline = null;       // Flattened { phases, totalTime }
  let isPlaying = false;
  let isPaused = false;
  let startTime = null;      // Performance.now() reference
  let pausedAt = 0;          // Elapsed time when paused
  let currentPhaseIdx = -1;
  let animFrameId = null;
  let wakeLock = null;

  // ---- DOM refs ----
  const canvas = document.getElementById('pacer');
  const ctx = canvas.getContext('2d');

  const el = {
    sessionName:    document.getElementById('sessionName'),
    phaseLabel:     document.getElementById('phaseLabel'),
    phaseCountdown: document.getElementById('phaseCountdown'),
    totalTimer:     document.getElementById('totalTimer'),
    currentPhase:   document.getElementById('currentPhase'),
    currentRound:   document.getElementById('currentRound'),
    elapsedTime:    document.getElementById('elapsedTime'),
    remainingTime:  document.getElementById('remainingTime'),
    activeCueText:  document.getElementById('activeCueText'),
    activeCueTs:    document.getElementById('activeCueTimestamp'),
    pastCue:        document.getElementById('pastCue'),
    currentCue:     document.getElementById('currentCue'),
    nextCue:        document.getElementById('nextCue'),
    playBtn:        document.getElementById('playBtn'),
    pauseBtn:       document.getElementById('pauseBtn'),
    stopBtn:        document.getElementById('stopBtn'),
    loadBtn:        document.getElementById('loadBtn'),
    skipBtn:        document.getElementById('skipBtn'),
    themeToggle:    document.getElementById('themeToggle'),
    fileInput:      document.getElementById('fileInput'),
    musicVol:       document.getElementById('musicVol'),
    breathVol:      document.getElementById('breathVol'),
    cueVol:         document.getElementById('cueVol'),
    musicVolVal:    document.getElementById('musicVolVal'),
    breathVolVal:   document.getElementById('breathVolVal'),
    cueVolVal: document.getElementById('cueVolVal'),
    musicLoadBtn: document.getElementById('musicLoadBtn'),
    musicPlayBtn: document.getElementById('musicPlayBtn'),
    musicName: document.getElementById('musicName'),
    musicFileInput: document.getElementById('musicFileInput'),
    statusLeft: document.getElementById('statusLeft'),
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

  function loadMusicFile(file) {
    initAudioCtx();
    const reader = new FileReader();
    reader.onload = (e) => {
      audioCtx.decodeAudioData(e.target.result, (buffer) => {
        musicBuffer = buffer;
        el.musicName.textContent = file.name.replace(/\.[^.]+$/, '').substring(0, 12);
        el.musicPlayBtn.disabled = false;
        el.statusLeft.textContent = `music loaded: ${file.name.substring(0, 20)}`;
      }, () => {
        el.statusLeft.textContent = 'error: could not decode audio';
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function toggleMusic() {
    if (!musicBuffer) return;
    initAudioCtx();

    if (musicPlaying) {
      // Pause — record offset
      musicOffset += audioCtx.currentTime - musicStartTime;
      if (musicOffset >= musicBuffer.duration) musicOffset = 0;
      if (musicSource) { musicSource.stop(); musicSource = null; }
      musicPlaying = false;
      el.musicPlayBtn.textContent = '▸';
      el.musicPlayBtn.classList.remove('active');
    } else {
      // Play from offset
      musicSource = audioCtx.createBufferSource();
      musicSource.buffer = musicBuffer;
      musicSource.loop = true;
      musicSource.connect(musicGain);
      musicStartTime = audioCtx.currentTime;
      musicSource.start(0, musicOffset);
      musicPlaying = true;
      el.musicPlayBtn.textContent = '▮';
      el.musicPlayBtn.classList.add('active');
    }
  }

  // ---- Theme colors (read from CSS vars at render time) ----
  function getColors() {
    const s = getComputedStyle(document.documentElement);
    return {
      bg:       s.getPropertyValue('--pacer-bg').trim(),
      past:     s.getPropertyValue('--pacer-past').trim(),
      future:   s.getPropertyValue('--pacer-future').trim(),
      ball:     s.getPropertyValue('--pacer-ball').trim(),
      ballGlow: s.getPropertyValue('--pacer-ball-glow').trim(),
      grid:     s.getPropertyValue('--pacer-grid').trim(),
      label:    s.getPropertyValue('--pacer-label').trim(),
    };
  }

  // ---- Canvas sizing (retina-aware) ----
  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- Breath Level (PURE LINEAR — no easing) ----
  // Phase levels: inhale=0→1, hold_in=1→1, exhale=1→0, hold_out=0→0
  function getPhaseLevel(phase) {
    switch (phase) {
      case 'inhale':   return { start: 0, end: 1 };
      case 'hold_in':  return { start: 1, end: 1 };
      case 'exhale':   return { start: 1, end: 0 };
      case 'hold_out': return { start: 0, end: 0 };
      default:         return { start: 0, end: 0 };
    }
  }

  function getBreathLevel(t) {
    if (!timeline || t < 0 || t >= timeline.totalTime) return 0;
    for (const phase of timeline.phases) {
      if (t < phase.end) {
        const frac = (t - phase.start) / phase.duration;
        const lvl = getPhaseLevel(phase.phase);
        return lvl.start + frac * (lvl.end - lvl.start);
      }
    }
    return 0;
  }

  function getCurrentPhase(t) {
    if (!timeline || t < 0) return null;
    for (let i = 0; i < timeline.phases.length; i++) {
      if (t < timeline.phases[i].end) return i;
    }
    return null;
  }

  // ---- Phase display names ----
  const PHASE_NAMES = {
    inhale:   'INHALE',
    hold_in:  'HOLD IN',
    exhale:   'EXHALE',
    hold_out: 'HOLD OUT',
  };

  // ---- Format time ----
  function fmtTime(s) {
    const m = Math.floor(Math.abs(s) / 60);
    const sec = Math.floor(Math.abs(s) % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ---- Draw Graph (canvas — wave + ball ONLY) ----
  function drawGraph(currentT) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const colors = getColors();

    const margin = 30;
    const ballR = 22; // WAS 14 — bigger ball
    const drawH = h - 2 * margin - 2 * ballR;
    const centerX = w / 2;

    // How many seconds of past/future are visible
    const visiblePast = 8;
    const visibleFuture = 8;
    const pps = (w / 2 - margin) / Math.max(visibleFuture, 1);

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    // Horizontal grid lines
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

    // Phase labels
    ctx.font = '11px Source Code Pro, monospace';
    ctx.fillStyle = colors.label;
    ctx.textAlign = 'left';
    ctx.fillText('FULL', margin + 4, topY - 6);
    ctx.fillText('HALF', margin + 4, midY - 6);
    ctx.fillText('EMPTY', margin + 4, botY + 16);

    // Center vertical line (current time marker)
    ctx.strokeStyle = colors.ball;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.moveTo(centerX, margin); ctx.lineTo(centerX, h - margin); ctx.stroke();
    ctx.globalAlpha = 1.0;

    // "NOW" label at top of center line
    ctx.font = '9px Source Code Pro, monospace';
    ctx.fillStyle = colors.ball;
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.5;
    ctx.fillText('NOW', centerX, margin - 4);
    ctx.globalAlpha = 1.0;

    // Current breath level
    const currentLevel = getBreathLevel(currentT);
    const currentY = topY + drawH * (1 - currentLevel);

  // ---- Draw trace as SINGLE continuous path per side ----
  // This avoids aliasing/scramble at phase transitions by using
  // butt caps (not round) and a single path so corners are clean.
  const step = 0.02;

  function buildPoints(startT, endT) {
    const pts = [];
    for (let t = startT; t < endT; t += step) {
      pts.push({ t, level: getBreathLevel(t) });
    }
    // Don't add the exact endpoint — prevents double-draw at corners
    // The last step's t is close enough
    return pts;
  }

  // FUTURE trace (right of ball)
  const futureStart = currentT;
  const futureEnd = Math.min(currentT + visibleFuture, timeline ? timeline.totalTime : 0);
  if (timeline && futureEnd > futureStart) {
    const pts = buildPoints(futureStart, futureEnd);
    if (pts.length >= 2) {
      ctx.strokeStyle = colors.future;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'miter';  // Sharp corners — no rounding artifacts
      ctx.lineCap = 'butt';    // Clean endpoints — no cap overlap

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

  // PAST trace (left of ball)
  const pastStart = Math.max(0, currentT - visiblePast);
  if (timeline && currentT > pastStart) {
    const pts = buildPoints(pastStart, currentT);
    if (pts.length >= 2) {
      ctx.strokeStyle = colors.past;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';

      ctx.beginPath();
      // Draw past left-to-right (time flows right)
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

    // Draw Ball
    ctx.shadowBlur = 20;
    ctx.shadowColor = colors.ballGlow;
    ctx.beginPath();
    ctx.arc(centerX, currentY, ballR, 0, 2 * Math.PI);
    ctx.fillStyle = colors.ball;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Ball border
    ctx.beginPath();
    ctx.arc(centerX, currentY, ballR, 0, 2 * Math.PI);
    ctx.strokeStyle = colors.ball;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---- Update UI (phase label, timer, cue) ----
  function updateUI(elapsed) {
    if (!timeline) return;

    const remaining = Math.max(0, timeline.totalTime - elapsed);
    const phaseIdx = getCurrentPhase(elapsed);

    el.totalTimer.textContent = fmtTime(remaining);
    el.elapsedTime.textContent = fmtTime(elapsed);
    el.remainingTime.textContent = fmtTime(remaining);

    // Phase change detection
    if (phaseIdx !== null && phaseIdx !== currentPhaseIdx) {
      currentPhaseIdx = phaseIdx;
      const phase = timeline.phases[phaseIdx];
      const name = PHASE_NAMES[phase.phase] || phase.phase;

      el.phaseLabel.textContent = name;
      el.currentPhase.textContent = name;
      el.currentRound.textContent = phase.round ? `R${phase.round}` : '—';

      // Cue for this phase
      if (phase.cue) {
        updateTeleprompter(phase.cue, elapsed);
      }
    }

    // Phase countdown
    if (phaseIdx !== null) {
      const phase = timeline.phases[phaseIdx];
      const phaseElapsed = elapsed - phase.start;
      const phaseRemaining = Math.max(0, phase.duration - phaseElapsed);
      el.phaseCountdown.textContent = phaseRemaining.toFixed(1) + 's';
    }

    // Update cue timeline
    updateCueTimeline(elapsed);
  }

  // ---- Teleprompter ----
  function updateTeleprompter(text, elapsed) {
    el.activeCueText.textContent = text;
    el.activeCueTs.textContent = fmtTime(elapsed);
  }

  // ---- Cue Timeline (past / current / future) ----
  function updateCueTimeline(elapsed) {
    if (!session || !session.cues) return;

    const cues = session.cues;
    let pastCue = null, currentCue = null, futureCue = null;

    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (elapsed >= c.at) {
        pastCue = c;
      } else if (!futureCue) {
        futureCue = c;
        break;
      }
    }

    // Current = most recent past cue, or null if none
    currentCue = pastCue;
    // Past = cue before current
    const pastIdx = currentCue ? cues.indexOf(currentCue) - 1 : -1;
    pastCue = pastIdx >= 0 ? cues[pastIdx] : null;

    // Update DOM
    el.pastCue.querySelector('.cue-ts').textContent = pastCue ? fmtTime(pastCue.at) : '—';
    el.pastCue.querySelector('.cue-text').textContent = pastCue ? pastCue.text.substring(0, 40) + '...' : '—';

    el.currentCue.querySelector('.cue-ts').textContent = currentCue ? fmtTime(currentCue.at) : '—';
    el.currentCue.querySelector('.cue-text').textContent = currentCue ? currentCue.text.substring(0, 40) : '—';

    el.nextCue.querySelector('.cue-ts').textContent = futureCue ? fmtTime(futureCue.at) : '—';
    el.nextCue.querySelector('.cue-text').textContent = futureCue ? futureCue.text.substring(0, 40) + '...' : '—';
  }

  // ---- Animation Loop ----
  function animationLoop() {
    if (!isPlaying || isPaused) return;

    const now = performance.now();
    const elapsed = (now - startTime) / 1000;

    if (elapsed >= timeline.totalTime) {
      stopSession();
      updateTeleprompter('Session complete', elapsed);
      el.statusLeft.textContent = 'session complete';
      return;
    }

    drawGraph(elapsed);
    updateUI(elapsed);
    animFrameId = requestAnimationFrame(animationLoop);
  }

  // ---- Transport ----
  function playSession() {
    if (!timeline) return;

    if (isPaused) {
      startTime = performance.now() - (pausedAt * 1000);
      isPaused = false;
    } else {
      startTime = performance.now();
      currentPhaseIdx = -1;
      updateTeleprompter('Session started', 0);
    }

    isPlaying = true;
    updateTransportUI();
    requestWakeLock();
    animationLoop();
  }

  function pauseSession() {
    if (!isPlaying) return;
    isPaused = true;
    pausedAt = (performance.now() - startTime) / 1000;
    cancelAnimationFrame(animFrameId);
    updateTransportUI();
  }

  function stopSession() {
    isPlaying = false;
    isPaused = false;
    startTime = null;
    pausedAt = 0;
    currentPhaseIdx = -1;
    cancelAnimationFrame(animFrameId);
    releaseWakeLock();
    drawGraph(0);
    updateTransportUI();

    // Reset displays
    el.phaseLabel.textContent = '—';
    el.phaseCountdown.textContent = '0.0s';
    el.totalTimer.textContent = fmtTime(timeline ? timeline.totalTime : 0);
    el.currentPhase.textContent = '—';
    el.currentRound.textContent = '—';
    el.elapsedTime.textContent = '00:00';
    el.remainingTime.textContent = fmtTime(timeline ? timeline.totalTime : 0);
    updateTeleprompter('awaiting session...', 0);
    updateCueTimeline(-1);
  }

  function skipPhase() {
    if (!isPlaying || !timeline) return;
    const elapsed = (performance.now() - startTime) / 1000;
    const phaseIdx = getCurrentPhase(elapsed);
    if (phaseIdx !== null && phaseIdx + 1 < timeline.phases.length) {
      const nextStart = timeline.phases[phaseIdx + 1].start;
      startTime = performance.now() - (nextStart * 1000);
    }
  }

  function updateTransportUI() {
    el.playBtn.disabled = isPlaying && !isPaused;
    el.pauseBtn.disabled = !isPlaying || isPaused;
    el.stopBtn.disabled = !isPlaying && !isPaused;
    el.skipBtn.disabled = !isPlaying;
    el.loadBtn.disabled = isPlaying && !isPaused;
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
    el.sessionName.textContent = s.name;
    el.totalTimer.textContent = fmtTime(timeline.totalTime);
    el.remainingTime.textContent = fmtTime(timeline.totalTime);
    el.statusLeft.textContent = `ready: ${s.name} (${fmtTime(timeline.totalTime)})`;
    updateTeleprompter('Press play to begin', 0);
    updateCueTimeline(0);
    drawGraph(0);
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
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
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
    if (meta) meta.content = next === 'dark' ? '#0D0D0D' : '#F5F0EB';

    const elapsed = isPlaying ? (performance.now() - startTime) / 1000 : 0;
    drawGraph(elapsed);
  }

  // ---- Audio Volume Sliders ----
  function setupSliders() {
    // Music slider controls Web Audio gain node
    el.musicVol.addEventListener('input', () => {
      el.musicVolVal.textContent = el.musicVol.value;
      if (musicGain) {
        musicGain.gain.value = el.musicVol.value / 100;
      }
    });

    // Breath + cue sliders (display only for now — audio playback TBD)
    const pairs = [
      [el.breathVol, el.breathVolVal],
      [el.cueVol, el.cueVolVal],
    ];
    for (const [slider, display] of pairs) {
      slider.addEventListener('input', () => {
        display.textContent = slider.value;
      });
    }
  }

  // ---- Keyboard Controls ----
  function handleKeydown(e) {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (isPlaying && !isPaused) pauseSession();
        else playSession();
        break;
      case 'Enter':
        e.preventDefault();
        skipPhase();
        break;
      case 'KeyR':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          stopSession();
        }
        break;
    }
  }

  // ---- Init ----
  function init() {
    resizeCanvas();
    window.addEventListener('resize', () => {
      resizeCanvas();
      const elapsed = isPlaying ? (performance.now() - startTime) / 1000 : 0;
      drawGraph(elapsed);
    });

    // Transport
    el.playBtn.addEventListener('click', playSession);
    el.pauseBtn.addEventListener('click', pauseSession);
    el.stopBtn.addEventListener('click', stopSession);
    el.skipBtn.addEventListener('click', skipPhase);
    el.themeToggle.addEventListener('click', toggleTheme);

    // File load
    el.loadBtn.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        loadSessionFile(e.target.files[0]);
        e.target.value = '';
      }
    });

    // Music controls
    el.musicLoadBtn.addEventListener('click', () => el.musicFileInput.click());
    el.musicFileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        loadMusicFile(e.target.files[0]);
        e.target.value = '';
      }
    });
    el.musicPlayBtn.addEventListener('click', toggleMusic);

    // Keyboard
    document.addEventListener('keydown', handleKeydown);

    // Sliders
    setupSliders();

    // Init
    drawGraph(0);
    updateTransportUI();
    updateTeleprompter('awaiting session...', 0);

    // Service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Load default
    loadDefaultSession();
  }

  async function loadDefaultSession() {
    try {
      const resp = await fetch('sessions/holotropic-45min.json');
      if (resp.ok) {
        const s = await resp.json();
        setSession(s);
        await PranaSession.save(s);
      }
    } catch (e) {
      // No default — fine
    }
  }

  return { init, setSession, play: playSession, pause: pauseSession, stop: stopSession };

})();

// Boot
document.addEventListener('DOMContentLoaded', PranaApp.init);
