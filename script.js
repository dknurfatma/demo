/* ==========================================================================
   KHATAM AL-QURAN CEREMONY – OFFICIAL LAUNCH
   Flow:  VIP access  ->  security verification  ->  armed (LAUNCH button)
          ->  countdown  ->  launch burst + confetti  ->  video  ->  end card
   No external dependencies. Settings are saved in this browser (localStorage).
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ------------------------------------------------------------------------
     SETTINGS
     ------------------------------------------------------------------------ */
  const STORAGE_KEY = 'khatam-launch-settings-v2';
  const DEFAULTS = Object.freeze({
    accessCode: 'SKMJ2026',
    eventTitle: 'Majlis Khatam Al-Quran',
    schoolName: 'SK Merpati Jepang',
    badge: '2026',
    videoType: 'file',          // 'file' | 'youtube'
    videoUrl: 'launch.mp4',
    countdown: 3,
    manualLaunch: true,
    sound: true,
    fullscreen: true,
  });
  let settings = { ...DEFAULTS };

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== 'object') return;
      for (const key of Object.keys(DEFAULTS)) {
        const v = saved[key];
        if (typeof v !== typeof DEFAULTS[key]) continue;
        if (typeof v === 'string' && v.trim() === '' && key !== 'badge') continue;
        settings[key] = v;
      }
      settings.countdown = clamp(Math.round(settings.countdown) || 3, 1, 10);
      if (!['file', 'youtube'].includes(settings.videoType)) settings.videoType = 'file';
    } catch (e) { /* storage unavailable – use defaults */ }
  }
  function persistSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------------ */
  const app = $('app');
  const scenes = {
    auth: $('scene-auth'), scan: $('scene-scan'),
    armed: $('scene-armed'), countdown: $('scene-countdown'),
  };
  const accessInput = $('accessCode');
  const authForm = $('authForm');
  const authError = $('authError');
  const statusText = $('statusText');
  const video = $('video');
  const yt = $('yt');
  const fallback = $('fallback');
  const endcard = $('endcard');
  const unmuteBtn = $('unmuteBtn');
  const drawer = $('drawer');
  const scrim = $('scrim');

  const STATUS = {
    auth: 'AWAITING VIP ACCESS CODE',
    scan: 'SECURITY VERIFICATION IN PROGRESS',
    armed: 'SYSTEM ARMED · READY TO LAUNCH',
    countdown: 'LAUNCH SEQUENCE ACTIVE',
    launch: 'OFFICIALLY LAUNCHED',
    video: 'NOW PLAYING',
  };

  /* ------------------------------------------------------------------------
     TIMERS  (one place to cancel everything on reset)
     ------------------------------------------------------------------------ */
  let runToken = 0;
  const timers = new Set();
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }
  function clearTimers() { timers.forEach(clearTimeout); timers.clear(); }

  function tween(from, to, ms, onUpdate) {
    const token = runToken;
    const t0 = performance.now();
    (function step(now) {
      if (token !== runToken) return;
      const p = Math.min(1, (now - t0) / ms);
      onUpdate(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ------------------------------------------------------------------------
     SOUND  (all synthesised – no audio files needed)
     ------------------------------------------------------------------------ */
  const Sound = (() => {
    let ctx = null, master = null, noiseBuf = null, drone = null;
    const live = new Set();

    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { return null; }
        master = ctx.createGain();
        master.gain.value = settings.sound ? 0.9 : 0;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    function noise() {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      return noiseBuf;
    }
    function reg(node) {
      live.add(node);
      node.onended = () => live.delete(node);
      return node;
    }

    function tone({ type = 'sine', f0, f1, at = 0, dur = 0.2, vol = 0.2, attack = 0.008 }) {
      if (!ensure()) return;
      const t = ctx.currentTime + at;
      const o = reg(ctx.createOscillator()), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function hiss({ at = 0, dur = 0.5, vol = 0.2, type = 'lowpass', f0 = 1000, f1 = f0, q = 1 }) {
      if (!ensure()) return;
      const t = ctx.currentTime + at;
      const s = reg(ctx.createBufferSource());
      s.buffer = noise(); s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t); s.stop(t + dur + 0.05);
    }

    return {
      unlock() { ensure(); },
      setMuted(m) { if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02); },

      blip()  { tone({ type: 'sine', f0: 1500, f1: 1000, dur: 0.06, vol: 0.05 }); },
      ping()  { tone({ type: 'sine', f0: 880, dur: 0.5, vol: 0.12 }); tone({ type: 'sine', f0: 1320, at: 0.09, dur: 0.6, vol: 0.09 }); },
      error() { tone({ type: 'square', f0: 170, dur: 0.16, vol: 0.12 }); tone({ type: 'square', f0: 140, at: 0.2, dur: 0.24, vol: 0.12 }); },
      success() {
        tone({ type: 'triangle', f0: 659.25, dur: 0.35, vol: 0.18 });
        tone({ type: 'triangle', f0: 987.77, at: 0.12, dur: 0.6, vol: 0.18 });
      },
      tick(final) {
        tone({ type: 'triangle', f0: final ? 1175 : 784, dur: 0.18, vol: 0.2 });
        hiss({ dur: 0.05, vol: 0.08, type: 'highpass', f0: 4000 });
      },
      riser(dur) {
        if (!ensure()) return;
        const t = ctx.currentTime;
        const s = reg(ctx.createBufferSource()); s.buffer = noise(); s.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4;
        f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(5000, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + dur);
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08);
        s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.12);

        const o = reg(ctx.createOscillator()); o.type = 'sawtooth';
        o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(900, t + dur);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.05, t + dur);
        og.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08);
        o.connect(og); og.connect(master); o.start(t); o.stop(t + dur + 0.12);
      },
      boom() {
        tone({ type: 'sine', f0: 140, f1: 28, dur: 1.3, vol: 0.9, attack: 0.004 });
        hiss({ dur: 0.9, vol: 0.5, type: 'lowpass', f0: 3500, f1: 120 });
      },
      chime() {
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
          tone({ type: 'triangle', f0: f, at: 0.25 + i * 0.11, dur: 1.8 - i * 0.12, vol: 0.15 });
        });
        [2093, 2637, 3136].forEach((f, i) => tone({ type: 'sine', f0: f, at: 0.7 + i * 0.12, dur: 0.9, vol: 0.05 }));
      },
      droneStart() {
        if (!ensure() || drone) return;
        const t = ctx.currentTime;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 2);
        const o1 = reg(ctx.createOscillator()); o1.type = 'sine'; o1.frequency.value = 55;
        const o2 = reg(ctx.createOscillator()); o2.type = 'sawtooth'; o2.frequency.value = 110.6;
        o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
        o1.start(); o2.start();
        drone = { o1, o2, g };
      },
      droneStop() {
        if (!drone || !ctx) return;
        const { o1, o2, g } = drone; drone = null;
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
        try { o1.stop(t + 1.05); o2.stop(t + 1.05); } catch (e) { /* ignore */ }
      },
      stopAll() {
        live.forEach((n) => { try { n.stop(); } catch (e) { /* ignore */ } });
        live.clear(); drone = null;
      },
    };
  })();

  /* ------------------------------------------------------------------------
     VISUAL EFFECTS: floating embers (background) + confetti (foreground)
     ------------------------------------------------------------------------ */
  const FX = (() => {
    const bgc = $('bgfx'), cfc = $('confetti');
    const bg = bgc.getContext('2d'), cf = cfc.getContext('2d');
    const COLORS = ['#ff8ca3', '#e65c7b', '#8fd27d', '#488240', '#f0cc6a', '#ffffff', '#ffe3e8'];
    const EMBER_RGB = ['255,140,163', '143,210,125', '240,204,106', '255,255,255'];
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, dpr = 1, last = 0, rainUntil = 0;
    let embersOn = true, emberDirty = true, cfDirty = false;
    const embers = [], bits = [];

    function newEmber(init) {
      return {
        x: rnd(0, W), y: init ? rnd(0, H) : H + 10,
        r: rnd(0.7, 2.6), vy: -rnd(0.15, 0.6), vx: rnd(-0.25, 0.25),
        ph: rnd(0, 6.28), rgb: pick(EMBER_RGB),
      };
    }
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      for (const c of [bgc, cfc]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      bg.setTransform(dpr, 0, 0, dpr, 0, 0);
      cf.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(clamp((W * H) / 30000, 26, 70)) * (reduced ? 0.5 : 1);
      while (embers.length < target) embers.push(newEmber(true));
      embers.length = Math.min(embers.length, target);
      emberDirty = true;
    }

    function piece(x, y, vx, vy) {
      const s = Math.min(W, H) / 900 + 0.6;
      return {
        x, y, vx, vy, w: rnd(7, 13) * s, h: rnd(4, 8) * s,
        rot: rnd(0, 6.28), vr: rnd(-0.3, 0.3), flip: rnd(0, 6.28), fs: rnd(0.08, 0.25),
        c: pick(COLORS), circle: Math.random() < 0.18, age: 0, max: rnd(220, 340), grav: 0.2,
      };
    }
    function add(p) { if (bits.length < 480) bits.push(p); }

    function cannon(side) {
      const k = Math.min(W, H) / 800;
      const n = reduced ? 40 : 90;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI * rnd(0.2, 0.46);
        const sp = rnd(13, 27) * k;
        const dir = side === 'l' ? 1 : -1;
        add(piece(side === 'l' ? W * 0.02 : W * 0.98, H * 1.01, Math.cos(a) * sp * dir, Math.sin(a) * sp));
      }
    }
    function burst(x, y, n) {
      const k = Math.min(W, H) / 800;
      for (let i = 0; i < (reduced ? n / 2 : n); i++) {
        const a = rnd(0, 6.28), sp = rnd(3, 15) * k;
        const p = piece(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 2 * k);
        p.circle = Math.random() < 0.5; p.c = pick(['#f0cc6a', '#fff3c2', '#ffffff', '#ff8ca3']);
        p.w *= 0.6; p.h = p.w; p.max = rnd(90, 170);
        add(p);
      }
    }
    function rain(ms) { rainUntil = performance.now() + ms; }
    function setEmbers(on) { embersOn = on; if (on) emberDirty = true; }
    function clear() { bits.length = 0; rainUntil = 0; cfDirty = true; }

    function frame(ts) {
      requestAnimationFrame(frame);
      const dt = Math.min(50, ts - (last || ts)) / 16.667;
      last = ts;

      if (embersOn) {
        bg.clearRect(0, 0, W, H);
        for (const e of embers) {
          e.y += e.vy * dt; e.x += e.vx * dt + Math.sin(e.ph) * 0.15; e.ph += 0.02 * dt;
          if (e.y < -10) Object.assign(e, newEmber(false), { x: rnd(0, W) });
          bg.fillStyle = `rgba(${e.rgb},${0.25 + 0.4 * Math.abs(Math.sin(e.ph))})`;
          bg.beginPath(); bg.arc(e.x, e.y, e.r, 0, 6.2832); bg.fill();
        }
        emberDirty = true;
      } else if (emberDirty) { bg.clearRect(0, 0, W, H); emberDirty = false; }

      if (ts < rainUntil) {
        const k = Math.min(W, H) / 800;
        for (let i = 0; i < (reduced ? 1 : 3); i++) {
          const p = piece(rnd(0, W), -12, rnd(-1.2, 1.2) * k, rnd(2, 5) * k);
          p.grav = 0.05; add(p);
        }
      }
      if (bits.length) {
        cf.clearRect(0, 0, W, H); cfDirty = true;
        for (let i = bits.length - 1; i >= 0; i--) {
          const p = bits[i];
          p.vy += p.grav * dt; p.vx *= Math.pow(0.992, dt); p.vy *= Math.pow(0.996, dt);
          p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += p.fs * dt; p.age += dt;
          if (p.y > H + 30 || p.age > p.max) { bits.splice(i, 1); continue; }
          cf.save();
          cf.globalAlpha = Math.min(1, (p.max - p.age) / 40);
          cf.translate(p.x, p.y); cf.rotate(p.rot); cf.fillStyle = p.c;
          if (p.circle) { cf.beginPath(); cf.arc(0, 0, p.w / 2, 0, 6.2832); cf.fill(); }
          else { cf.scale(1, Math.cos(p.flip)); cf.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
          cf.restore();
        }
      } else if (cfDirty) { cf.clearRect(0, 0, W, H); cfDirty = false; }
    }

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    resize();
    requestAnimationFrame(frame);
    return { cannon, burst, rain, setEmbers, clear, size: () => ({ W, H }) };
  })();

  /* ------------------------------------------------------------------------
     FULLSCREEN + SCREEN WAKE LOCK
     ------------------------------------------------------------------------ */
  function inFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function enterFullscreen() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fn && !inFullscreen()) {
      try { const r = fn.call(el); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ }
    }
  }
  function toggleFullscreen() {
    if (inFullscreen()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else enterFullscreen();
  }

  let wakeLock = null;
  async function wakeOn() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* not supported / denied */ }
  }
  function wakeOff() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && phase !== 'auth') wakeOn();
  });

  /* ------------------------------------------------------------------------
     PHASES
     ------------------------------------------------------------------------ */
  let phase = 'auth';

  function setPhase(p) {
    phase = p;
    app.dataset.phase = p;
    statusText.textContent = STATUS[p];
    for (const [key, el] of Object.entries(scenes)) el.classList.toggle('is-active', key === p);
    if (p === 'auth') later(() => accessInput.focus({ preventScroll: true }), 400);
  }

  /* ---- 1. VIP access ---- */
  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    Sound.unlock();
    const entered = accessInput.value.trim();
    if (entered && entered.toUpperCase() === settings.accessCode.trim().toUpperCase()) {
      authError.hidden = true;
      Sound.ping();
      if (settings.fullscreen) enterFullscreen();   // needs a user gesture – this is one
      startScan();
    } else {
      Sound.error();
      authError.hidden = false;
      accessInput.value = '';
      accessInput.focus();
      const panel = authForm;
      panel.classList.remove('shake'); void panel.offsetWidth; panel.classList.add('shake');
    }
  });

  /* ---- 2. Security verification ---- */
  const SCAN_STEPS = [
    { pct: 14, text: 'Booting ceremony protocol' },
    { pct: 32, text: 'Verifying VIP credentials' },
    { pct: 50, text: 'Syncing recitation archive' },
    { pct: 68, text: 'Calibrating sound & light' },
    { pct: 86, text: 'Securing the Khatam channel' },
    { pct: 100, text: 'All systems nominal' },
  ];
  const scanLog = $('scanLog'), scanPct = $('scanPct'), scanRing = $('scanRing'), granted = $('granted');

  function setScan(v) {
    scanPct.textContent = String(Math.round(v));
    scanRing.style.strokeDashoffset = String(283 * (1 - v / 100));
  }
  function resetScanUI() {
    scanLog.innerHTML = ''; setScan(0);
    granted.classList.remove('show'); granted.setAttribute('aria-hidden', 'true');
  }
  function addLogLine(text) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="pr">›</span><span class="t"></span><span class="dots"></span><span class="ok">OK</span>';
    li.querySelector('.t').textContent = text;
    scanLog.appendChild(li);
  }

  function startScan() {
    resetScanUI();
    setPhase('scan');
    Sound.droneStart();
    wakeOn();
    prepareVideo();           // start loading the video now so it plays instantly later

    const stepMs = 720;
    let i = 0, pct = 0;
    const run = () => {
      const s = SCAN_STEPS[i];
      addLogLine(s.text);
      Sound.blip();
      tween(pct, s.pct, stepMs * 0.9, setScan);
      pct = s.pct; i++;
      later(i < SCAN_STEPS.length ? run : grant, i < SCAN_STEPS.length ? stepMs : stepMs + 250);
    };
    later(run, 450);
  }
  function grant() {
    granted.classList.add('show'); granted.setAttribute('aria-hidden', 'false');
    Sound.success();
    later(startArmed, 1800);
  }

  /* ---- 3. Armed ---- */
  const launchBtn = $('launchBtn'), armedHint = $('armedHint');
  function startArmed() {
    setPhase('armed');
    Sound.ping();
    if (settings.manualLaunch) {
      launchBtn.disabled = false;
      armedHint.textContent = 'Press the button to begin the countdown';
      later(() => launchBtn.focus({ preventScroll: true }), 500);
    } else {
      launchBtn.disabled = true;
      armedHint.textContent = 'Launching automatically…';
      later(beginCountdown, 1800);
    }
  }
  launchBtn.addEventListener('click', () => {
    Sound.unlock();
    if (settings.fullscreen) enterFullscreen();
    beginCountdown();
  });

  /* ---- 4. Countdown ---- */
  const countNum = $('countNum'), countRing = $('countRing'), countDial = $('countDial');
  function resetCountUI() {
    countRing.style.transition = 'none';
    countRing.style.strokeDashoffset = '0';
    countNum.textContent = String(settings.countdown);
    countNum.classList.remove('pop');
    countDial.querySelectorAll('.shock').forEach((n) => n.remove());
  }
  function shockwave() {
    const s = document.createElement('div');
    s.className = 'shock';
    s.addEventListener('animationend', () => s.remove());
    countDial.appendChild(s);
  }

  function beginCountdown() {
    if (phase !== 'armed') return;       // guards against double clicks
    setPhase('countdown');
    resetCountUI();
    void countRing.getBoundingClientRect();   // flush so the ring animates from full

    const total = settings.countdown;
    let n = total;
    Sound.riser(total + 0.45);

    const step = () => {
      countNum.textContent = String(n);
      countNum.classList.remove('pop'); void countNum.offsetWidth; countNum.classList.add('pop');
      shockwave();
      Sound.tick(n === 1);
      countRing.style.transition = 'stroke-dashoffset 1s linear';
      countRing.style.strokeDashoffset = String(283 * (1 - (n - 1) / total));
      later(() => { n--; if (n > 0) step(); else doLaunch(); }, 1000);
    };
    later(step, 450);
  }

  /* ---- 5. Launch moment ---- */
  const LAUNCH_HOLD_MS = 4400;
  function doLaunch() {
    setPhase('launch');
    Sound.droneStop();
    Sound.boom();
    Sound.chime();

    const { W, H } = FX.size();
    FX.cannon('l'); FX.cannon('r');
    FX.burst(W / 2, H * 0.42, 150);
    FX.rain(3400);
    later(() => { FX.burst(W * 0.25, H * 0.35, 70); FX.burst(W * 0.75, H * 0.35, 70); }, 700);
    later(() => { FX.cannon('l'); FX.cannon('r'); }, 1300);

    later(showVideo, LAUNCH_HOLD_MS);
  }

  /* ---- 6. Video ---- */
  let videoFailed = false;

  function youtubeEmbed(input) {
    const raw = (input || '').trim();
    let id = null;
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') id = u.pathname.split('/')[1];
      else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
        if (u.searchParams.get('v')) id = u.searchParams.get('v');
        else {
          const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
          if (m) id = m[1];
        }
      }
    } catch (e) {
      if (/^[\w-]{11}$/.test(raw)) id = raw;
    }
    if (!id) return raw;
    return 'https://www.youtube.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0&modestbranding=1&playsinline=1';
  }

  function syncVideoSource(force) {
    if (settings.videoType !== 'file') return;
    const want = settings.videoUrl;
    if (force || video.getAttribute('src') !== want) {
      videoFailed = false;
      video.src = want;
      video.load();          // required – the browser will not reload a changed source by itself
    }
  }
  function prepareVideo() { syncVideoSource(false); }

  video.addEventListener('error', () => {
    videoFailed = true;
    if (phase === 'video' && settings.videoType === 'file') showFallback();
  });
  video.addEventListener('ended', () => {
    if (phase !== 'video') return;
    endcard.hidden = false;
    const { W, H } = FX.size();
    FX.cannon('l'); FX.cannon('r'); FX.burst(W / 2, H * 0.4, 90);
  });

  function showVideo() {
    setPhase('video');
    FX.setEmbers(false);
    playVideo();
  }

  function playVideo() {
    endcard.hidden = true; fallback.hidden = true; unmuteBtn.hidden = true;

    if (settings.videoType === 'youtube') {
      video.pause(); video.hidden = true;
      yt.hidden = false; yt.src = youtubeEmbed(settings.videoUrl);
      return;
    }
    yt.hidden = true; yt.src = 'about:blank'; video.hidden = false;
    syncVideoSource(false);
    if (videoFailed || video.error) { showFallback(); return; }

    try { video.currentTime = 0; } catch (e) { /* not seekable yet */ }
    video.muted = !settings.sound;
    const p = video.play();
    if (p && p.catch) {
      p.catch((err) => {
        if (err && err.name === 'NotAllowedError') {
          // Browser blocked sound: start muted and offer a one-tap unmute
          video.muted = true;
          video.play().then(() => { unmuteBtn.hidden = false; }).catch(() => {});
        } else if (err && err.name === 'NotSupportedError') {
          showFallback();
        }
      });
    }
  }

  function showFallback() {
    fallback.hidden = false;
    const { W, H } = FX.size();
    FX.cannon('l'); FX.cannon('r'); FX.burst(W / 2, H * 0.4, 100); FX.rain(2500);
  }

  unmuteBtn.addEventListener('click', () => { video.muted = false; unmuteBtn.hidden = true; });
  $('replayBtn').addEventListener('click', () => { endcard.hidden = true; playVideo(); });
  $('endBack').addEventListener('click', () => resetAll());
  $('fbBack').addEventListener('click', () => resetAll());

  /* ------------------------------------------------------------------------
     RESET
     ------------------------------------------------------------------------ */
  function resetAll() {
    runToken++;
    clearTimers();
    Sound.stopAll();
    FX.clear(); FX.setEmbers(true);

    video.pause();
    yt.src = 'about:blank'; yt.hidden = true; video.hidden = false;   // stops YouTube audio
    endcard.hidden = true; fallback.hidden = true; unmuteBtn.hidden = true;

    resetScanUI(); resetCountUI();
    authError.hidden = true; accessInput.value = '';
    launchBtn.disabled = false;
    wakeOff();
    setPhase('auth');
  }

  /* ------------------------------------------------------------------------
     SETTINGS DRAWER
     ------------------------------------------------------------------------ */
  let drawerOpen = false;
  function openDrawer() {
    fillForm();
    drawerOpen = true;
    drawer.classList.add('open'); scrim.classList.add('open');
    drawer.removeAttribute('inert'); drawer.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('sCode').focus({ preventScroll: true }), 300);
  }
  function closeDrawer() {
    drawerOpen = false;
    drawer.classList.remove('open'); scrim.classList.remove('open');
    drawer.setAttribute('inert', ''); drawer.setAttribute('aria-hidden', 'true');
    if (document.activeElement && drawer.contains(document.activeElement)) document.activeElement.blur();
  }

  function applyBranding() {
    $('evTitle').textContent = settings.eventTitle;
    $('evSchool').textContent = settings.schoolName;
    const b = $('evBadge'); b.textContent = settings.badge; b.hidden = !settings.badge;
    const line = [settings.eventTitle, [settings.schoolName, settings.badge].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    $('launchSub').textContent = line;
    $('fbSub').textContent = line;
    $('endTitle').textContent = settings.eventTitle;
    document.title = settings.eventTitle + ' – Official Launch | ' + [settings.schoolName, settings.badge].filter(Boolean).join(' ');
    if (phase === 'auth' || phase === 'scan' || phase === 'armed') countNum.textContent = String(settings.countdown);
  }

  function updateVideoHint() {
    const yts = $('sVideoType').value === 'youtube';
    $('sVideoHint').textContent = yts
      ? 'Paste any YouTube link. Needs internet. YouTube may refuse to play when index.html is opened straight from a folder (file://) – test it on the real device first, or use a local video file instead.'
      : 'Type the file name (it must sit in the same folder as index.html, e.g. launch.mp4) or a direct link to an MP4/WebM file.';
    $('sVideoUrl').placeholder = yts ? 'https://www.youtube.com/watch?v=…' : 'launch.mp4';
  }
  function fillForm() {
    $('sCode').value = settings.accessCode;
    $('sTitle').value = settings.eventTitle;
    $('sSchool').value = settings.schoolName;
    $('sBadge').value = settings.badge;
    $('sVideoType').value = settings.videoType;
    $('sVideoUrl').value = settings.videoUrl;
    $('sCountdown').value = settings.countdown;
    $('sManual').checked = settings.manualLaunch;
    $('sSound').checked = settings.sound;
    $('sFullscreen').checked = settings.fullscreen;
    updateVideoHint();
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function saveForm() {
    const code = $('sCode').value.trim();
    const url = $('sVideoUrl').value.trim();
    if (!code) { toast('Access code cannot be empty'); return false; }
    if (!url) { toast('Please enter the video file name or link'); return false; }

    const oldVideo = settings.videoType + '|' + settings.videoUrl;
    settings.accessCode = code;
    settings.eventTitle = $('sTitle').value.trim() || DEFAULTS.eventTitle;
    settings.schoolName = $('sSchool').value.trim() || DEFAULTS.schoolName;
    settings.badge = $('sBadge').value.trim();
    settings.videoType = $('sVideoType').value;
    settings.videoUrl = url;
    settings.countdown = clamp(parseInt($('sCountdown').value, 10) || 3, 1, 10);
    settings.manualLaunch = $('sManual').checked;
    settings.sound = $('sSound').checked;
    settings.fullscreen = $('sFullscreen').checked;

    persistSettings();
    applyBranding();
    updateSoundIcon();
    Sound.setMuted(!settings.sound);
    if (oldVideo !== settings.videoType + '|' + settings.videoUrl) syncVideoSource(true);
    return true;
  }

  $('btnSettings').addEventListener('click', () => (drawerOpen ? closeDrawer() : openDrawer()));
  $('drawerClose').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  $('sVideoType').addEventListener('change', () => {
    // Switching source type clears the field so a stale value is never reused
    $('sVideoUrl').value = $('sVideoType').value === 'youtube' ? '' : DEFAULTS.videoUrl;
    updateVideoHint();
  });
  $('btnSave').addEventListener('click', () => { if (saveForm()) { toast('Settings saved'); closeDrawer(); } });
  $('btnReset').addEventListener('click', () => { closeDrawer(); resetAll(); toast('Show reset to start'); });
  $('btnDefaults').addEventListener('click', () => {
    if (!confirm('Restore all settings to their defaults?')) return;
    settings = { ...DEFAULTS };
    persistSettings(); fillForm(); applyBranding(); updateSoundIcon(); syncVideoSource(true);
    toast('Defaults restored');
  });
  $('btnTestVideo').addEventListener('click', () => {
    if (!saveForm()) return;
    Sound.unlock();
    closeDrawer();
    runToken++; clearTimers(); Sound.stopAll(); FX.clear();
    FX.setEmbers(false);
    [scenes.auth, scenes.scan, scenes.armed, scenes.countdown].forEach((s) => s.classList.remove('is-active'));
    setPhase('video');
    playVideo();
  });

  /* ------------------------------------------------------------------------
     TOOLBAR + KEYBOARD
     ------------------------------------------------------------------------ */
  function updateSoundIcon() {
    $('icoSoundOn').hidden = !settings.sound;
    $('icoSoundOff').hidden = settings.sound;
  }
  $('btnSound').addEventListener('click', () => {
    settings.sound = !settings.sound;
    persistSettings();
    Sound.unlock(); Sound.setMuted(!settings.sound);
    if (!video.paused || !unmuteBtn.hidden) video.muted = !settings.sound;
    updateSoundIcon();
    toast(settings.sound ? 'Sound on' : 'Sound off');
  });
  $('btnFull').addEventListener('click', toggleFullscreen);

  const typing = (el) => el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen) { closeDrawer(); return; }
    if ((e.key === 'f' || e.key === 'F') && !typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();
  });

  /* ------------------------------------------------------------------------
     INIT
     ------------------------------------------------------------------------ */
  loadSettings();
  applyBranding();
  fillForm();
  updateSoundIcon();
  resetCountUI();
  setPhase('auth');
})();
