/* ============================================================
   NEON WARDEN — Cyberpunk Energy Battle
   Vanilla JS / Canvas game engine
   ============================================================ */

(() => {
'use strict';

/* ---------------------------------------------------------
   CANVAS / GLOBAL SETUP
--------------------------------------------------------- */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const fxCanvas = document.getElementById('fxCanvas');
const fxCtx = fxCanvas.getContext('2d');

let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  [canvas, fxCanvas].forEach(c => {
    c.width = W * DPR;
    c.height = H * DPR;
  });
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fxCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// Copyright footer — stamp the current year in wherever it's used
(function stampCopyrightYear() {
  const year = new Date().getFullYear();
  const yearEl = document.getElementById('copyrightYear');
  if (yearEl) yearEl.textContent = year;
  document.querySelectorAll('.creditYear').forEach(el => { el.textContent = year; });
})();

// Detect an actual touch/mobile device — NOT just a narrow window.
// (Using window width alone falsely triggers "mobile mode" in narrow desktop
//  previews/split-screens, which disables free mouse-aim and locks the player
//  onto auto-targeting — this was the cause of aiming feeling stuck/limited.)
const isMobile = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0))
  && window.matchMedia('(pointer: coarse)').matches;

// Reduce expensive canvas glow (shadowBlur) on mobile GPUs for smoother frame rate
const SHADOW_SCALE = isMobile ? 0.5 : 1;

/* ---------------------------------------------------------
   UTILITIES
--------------------------------------------------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
function angleTo(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); }

/* ---------------------------------------------------------
   GAME STATE
--------------------------------------------------------- */
const STATE = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };
let gameState = STATE.START;

let camera = { x: 0, y: 0, shakeMag: 0, shakeT: 0 };
let timeScale = 1;          // for slow-motion ultimate
let slowMoTimer = 0;
let elapsed = 0;            // survival time
let frameCount = 0;

let score = 0;
let combo = 0;
let comboTimer = 0;
let bestCombo = 0;
let wave = 1;
let waveKillsNeeded = 8;
let waveKills = 0;
let bossActive = false;
let bossSpawnedForWave = -1;

/* ---------------------------------------------------------
   INPUT
--------------------------------------------------------- */
const keys = {};
let mouse = { x: 0, y: 0, down: false };
let joystick = { active: false, dx: 0, dy: 0 };

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (gameState === STATE.PLAYING) {
    if (e.code === 'Digit1') setAttack('blast');
    if (e.code === 'Digit2') setAttack('lightning');
    if (e.code === 'Digit3') setAttack('fireball');
    if (e.code === 'Digit4' || e.code === 'KeyF') setAttack('ultimate');
    if (e.code === 'Space') { e.preventDefault(); tryAttack(); }
  }
  if (e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', (e) => keys[e.code] = false);

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
});
canvas.addEventListener('mousedown', (e) => {
  mouse.down = true;
  if (gameState === STATE.PLAYING) tryAttack();
});
window.addEventListener('mouseup', () => mouse.down = false);

/* Mobile joystick */
const joyZone = document.getElementById('joystickZone');
const joyStick = document.getElementById('joystickStick');
let joyTouchId = null;
joyZone.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  joyTouchId = t.identifier;
  joystick.active = true;
  updateJoystick(t);
}, { passive: true });
joyZone.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) if (t.identifier === joyTouchId) updateJoystick(t);
}, { passive: true });
joyZone.addEventListener('touchend', (e) => {
  joystick.active = false; joystick.dx = 0; joystick.dy = 0;
  joyStick.style.transform = 'translate(-50%,-50%)';
}, { passive: true });
function updateJoystick(t) {
  const rect = joyZone.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let dx = t.clientX - cx, dy = t.clientY - cy;
  const max = rect.width / 2;
  const d = Math.hypot(dx, dy);
  if (d > max) { dx = dx / d * max; dy = dy / d * max; }
  joystick.dx = dx / max; joystick.dy = dy / max;
  joyStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

/* Mobile attack buttons — tap fires once immediately, holding auto-fires
   Blast continuously (matches desktop's hold-mouse-to-fire behavior). */
let mobileAttackHeld = false;
document.querySelectorAll('.mbtn').forEach(btn => {
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    setAttack(btn.dataset.atk);
    tryAttack();
    if (btn.dataset.atk === 'blast') mobileAttackHeld = true;
  }, { passive: false });
  btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    mobileAttackHeld = false;
  }, { passive: false });
  btn.addEventListener('touchcancel', () => { mobileAttackHeld = false; });
});

/* Aim: on mobile, aim toward nearest enemy automatically. On desktop, aim at mouse. */

/* ---------------------------------------------------------
   ATTACK DEFINITIONS
--------------------------------------------------------- */
const ATTACKS = {
  blast:     { name: 'Energy Blast', cooldown: 260, damage: 14, color: '#ff2222', unlock: 1 },
  lightning: { name: 'Lightning',    cooldown: 550, damage: 22, color: '#a855ff', unlock: 1 },
  fireball:  { name: 'Fireball',     cooldown: 750, damage: 30, color: '#ff8a1f', unlock: 1 },
  ultimate:  { name: 'Ultimate',     cooldown: 0,   damage: 90, color: '#ff2e88', unlock: 1 },
};
let currentAttack = 'blast';
let cooldowns = { blast: 0, lightning: 0, fireball: 0 };
let ultimatePower = 0; // 0-100
const ULTIMATE_MAX = 100;

function setAttack(name) {
  if (name === 'ultimate') return; // ultimate triggered separately but selectable visually
  currentAttack = name;
  document.querySelectorAll('.atk-slot').forEach(s => s.classList.toggle('active', s.dataset.atk === name));
}

/* ---------------------------------------------------------
   PARTICLE SYSTEM
--------------------------------------------------------- */
class Particle {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.vx = opts.vx ?? rand(-1, 1);
    this.vy = opts.vy ?? rand(-1, 1);
    this.life = opts.life ?? 1;
    this.maxLife = this.life;
    this.size = opts.size ?? rand(2, 5);
    this.color = opts.color ?? '#00f0ff';
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 0.98;
    this.type = opts.type ?? 'dot'; // dot, spark, smoke, ring, line
    this.rot = opts.rot ?? 0;
    this.vrot = opts.vrot ?? 0;
    this.shrink = opts.shrink ?? true;
    this.glow = opts.glow ?? true;
    this.trail = opts.trail ?? null; // {x2,y2} for lightning-like line particles
    this.alphaMul = opts.alphaMul ?? 1;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= this.drag;
    this.vy *= this.drag;
    this.vy += this.gravity * dt;
    this.rot += this.vrot * dt;
    this.life -= dt / 1000 / (this.maxLifeSeconds || (this.maxLife / 1000 || 1));
    this.life -= dt * 0.0011;
  }
  get t() { return clamp(this.life, 0, 1); }
  draw(c) {
    const a = this.t * this.alphaMul;
    if (a <= 0) return;
    c.save();
    c.globalAlpha = a;
    if (this.glow) { c.shadowColor = this.color; c.shadowBlur = (this.size * 3) * SHADOW_SCALE; }
    c.fillStyle = this.color;
    const sz = this.shrink ? this.size * this.t : this.size;
    if (this.type === 'dot') {
      c.beginPath(); c.arc(this.x, this.y, Math.max(0.2, sz), 0, TAU); c.fill();
    } else if (this.type === 'spark') {
      c.translate(this.x, this.y); c.rotate(this.rot);
      c.fillRect(-sz * 1.6, -0.8, sz * 3.2, 1.6);
    } else if (this.type === 'smoke') {
      c.globalAlpha = a * 0.5;
      c.beginPath(); c.arc(this.x, this.y, sz * 2, 0, TAU); c.fill();
    } else if (this.type === 'ring') {
      c.globalAlpha = a * 0.9;
      c.lineWidth = 2; c.strokeStyle = this.color;
      c.beginPath(); c.arc(this.x, this.y, sz * (2 - this.t), 0, TAU); c.stroke();
    }
    c.restore();
  }
}

let particles = [];
const MAX_PARTICLES = isMobile ? 220 : 450; // perf cap to keep frame time smooth during heavy VFX
function spawnParticles(arr) {
  for (const p of arr) particles.push(p);
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
}

function burst(x, y, color, count = 14, opts = {}) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const spd = rand(opts.minSpd ?? 1, opts.maxSpd ?? 4);
    arr.push(new Particle(x, y, {
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      size: rand(opts.minSize ?? 2, opts.maxSize ?? 5),
      color, life: 1, gravity: opts.gravity ?? 0.01,
      type: opts.type ?? 'dot', drag: opts.drag ?? 0.94,
    }));
  }
  spawnParticles(arr);
}

function smokePuff(x, y, count = 6) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push(new Particle(x + rand(-8, 8), y + rand(-8, 8), {
      vx: rand(-0.4, 0.4), vy: rand(-0.8, -0.2),
      size: rand(8, 16), color: 'rgba(120,120,140,0.5)',
      life: 1, type: 'smoke', drag: 0.97, glow: false,
    }));
  }
  spawnParticles(arr);
}

function explosion(x, y, color = '#ff8a1f', big = false) {
  burst(x, y, color, big ? 46 : 22, { minSpd: 1.5, maxSpd: big ? 9 : 6, minSize: 2, maxSize: big ? 7 : 5, gravity: 0.02 });
  burst(x, y, '#fff', big ? 18 : 8, { minSpd: 2, maxSpd: big ? 10 : 6, minSize: 1, maxSize: 3 });
  smokePuff(x, y, big ? 14 : 6);
  spawnParticles([new Particle(x, y, { size: big ? 60 : 30, color, life: 1, type: 'ring', vx: 0, vy: 0, glow: true })]);
  spawnParticles([new Particle(x, y, { size: big ? 90 : 45, color: '#fff', life: 0.7, type: 'ring', vx: 0, vy: 0 })]);
  shakeCamera(big ? 18 : 8, big ? 400 : 200);
}

/* lightning bolt line generator */
function lightningPath(x1, y1, x2, y2, segments = 8, spread = 26) {
  const pts = [{ x: x1, y: y1 }];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const bx = lerp(x1, x2, t) + rand(-spread, spread) * (1 - Math.abs(t - 0.5) * 1.4);
    const by = lerp(y1, y2, t) + rand(-spread, spread) * (1 - Math.abs(t - 0.5) * 1.4);
    pts.push({ x: bx, y: by });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}

let lightningBolts = []; // {pts, life, color, width}
function drawLightningBolt(x1, y1, x2, y2, color = '#c084ff', width = 3, life = 220) {
  lightningBolts.push({ pts: lightningPath(x1, y1, x2, y2), life, maxLife: life, color, width });
  lightningBolts.push({ pts: lightningPath(x1, y1, x2, y2, 6, 14), life: life * 0.7, maxLife: life * 0.7, color: '#fff', width: 1.2 });
}

/* ---------------------------------------------------------
   CAMERA SHAKE / SCREEN FX
--------------------------------------------------------- */
function shakeCamera(mag, dur) {
  camera.shakeMag = Math.max(camera.shakeMag, mag);
  camera.shakeT = Math.max(camera.shakeT, dur);
}
function updateCamera(dt) {
  if (camera.shakeT > 0) {
    camera.shakeT -= dt;
    const f = camera.shakeT / 400;
    camera.x = rand(-1, 1) * camera.shakeMag * clamp(f, 0, 1);
    camera.y = rand(-1, 1) * camera.shakeMag * clamp(f, 0, 1);
    if (camera.shakeT <= 0) { camera.shakeMag = 0; camera.x = 0; camera.y = 0; }
  }
}

const flashEl = document.getElementById('flash');
function screenFlash() {
  flashEl.classList.add('hit');
  setTimeout(() => flashEl.classList.remove('hit'), 70);
}
const glitchEl = document.getElementById('chroma-glitch');
function chromaGlitch(dur = 300) {
  glitchEl.classList.add('on');
  setTimeout(() => glitchEl.classList.remove('on'), dur);
}

/* ---------------------------------------------------------
   SOUND ENGINE — fully synthesized via Web Audio API
   (no external audio files needed; all SFX + music generated live)
--------------------------------------------------------- */
const SFX = (() => {
  let actx = null, masterGain = null, musicGain = null, sfxGain = null;
  let muted = false, ready = false;
  let noiseBuffer = null;

  function init() {
    if (ready) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = actx.createGain(); masterGain.gain.value = 0.9; masterGain.connect(actx.destination);
      musicGain = actx.createGain(); musicGain.gain.value = 0.32; musicGain.connect(masterGain);
      sfxGain = actx.createGain(); sfxGain.gain.value = 0.85; sfxGain.connect(masterGain);
      ready = true;
    } catch (e) { ready = false; }
  }
  function resume() { if (actx && actx.state === 'suspended') actx.resume(); }
  function suspend() { if (actx && actx.state === 'running') actx.suspend(); }
  function now() { return actx.currentTime; }

  function tone(freq, dur, { type = 'sine', gain = 0.3, sweepTo = null, dest = null, attack = 0.005 } = {}) {
    if (!ready || muted) return;
    const osc = actx.createOscillator(), g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now());
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), now() + dur);
    g.gain.setValueAtTime(0.0001, now());
    g.gain.exponentialRampToValueAtTime(gain, now() + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
    osc.connect(g); g.connect(dest || sfxGain);
    osc.start(); osc.stop(now() + dur + 0.02);
  }

  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const len = actx.sampleRate * 1.0;
    noiseBuffer = actx.createBuffer(1, len, actx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function noiseBurst(dur, { filterFreq = 1200, filterType = 'bandpass', gain = 0.3, sweepTo = null, q = 1, dest = null } = {}) {
    if (!ready || muted) return;
    const src = actx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const filt = actx.createBiquadFilter();
    filt.type = filterType; filt.frequency.setValueAtTime(filterFreq, now()); filt.Q.value = q;
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), now() + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, now());
    g.gain.exponentialRampToValueAtTime(gain, now() + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
    src.connect(filt); filt.connect(g); g.connect(dest || sfxGain);
    src.start(); src.stop(now() + dur + 0.02);
  }

  /* ---- SFX presets ---- */
  function blast() { tone(880, 0.12, { type: 'square', gain: 0.16, sweepTo: 220, attack: 0.002 }); }
  function lightning() {
    noiseBurst(0.18, { filterFreq: 3200, filterType: 'highpass', gain: 0.26, sweepTo: 900, q: 0.6 });
    tone(1400, 0.15, { type: 'sawtooth', gain: 0.1, sweepTo: 200 });
  }
  function fire() {
    noiseBurst(0.35, { filterFreq: 900, filterType: 'lowpass', gain: 0.3, sweepTo: 250, q: 0.8 });
    tone(180, 0.3, { type: 'sawtooth', gain: 0.15, sweepTo: 60 });
  }
  function explosion(big = false) {
    noiseBurst(big ? 0.7 : 0.4, { filterFreq: big ? 1800 : 1200, filterType: 'lowpass', gain: big ? 0.5 : 0.3, sweepTo: 60, q: 0.7 });
    tone(big ? 120 : 160, big ? 0.6 : 0.35, { type: 'sine', gain: big ? 0.32 : 0.2, sweepTo: 30 });
  }
  function hit() { tone(140, 0.15, { type: 'square', gain: 0.2, sweepTo: 60 }); }
  function ultimate() {
    noiseBurst(1.1, { filterFreq: 2200, filterType: 'bandpass', gain: 0.38, sweepTo: 400, q: 0.5 });
    tone(80, 1.2, { type: 'sawtooth', gain: 0.28, sweepTo: 400 });
    setTimeout(() => explosion(true), 140);
  }
  function bossRoar() {
    tone(90, 1.4, { type: 'sawtooth', gain: 0.32, sweepTo: 40 });
    noiseBurst(1.2, { filterFreq: 500, filterType: 'lowpass', gain: 0.28, sweepTo: 120, q: 0.6 });
  }
  function levelUp() { tone(500, 0.25, { type: 'triangle', gain: 0.2, sweepTo: 900 }); }
  function uiClick() { tone(660, 0.08, { type: 'triangle', gain: 0.15, sweepTo: 880 }); }

  /* ---- background music: real audio file (looped) ---- */
  const bgMusicEl = document.getElementById('bgMusic');
  if (bgMusicEl) bgMusicEl.volume = 0.45; // adjust 0.0 - 1.0 to taste

  function startMusic() {
    if (!bgMusicEl) return;
    bgMusicEl.loop = true;
    bgMusicEl.currentTime = 0;
    bgMusicEl.play().catch(() => {}); // ignored if blocked before user gesture
  }
  function stopMusic() {
    if (!bgMusicEl) return;
    bgMusicEl.pause();
    bgMusicEl.currentTime = 0;
  }
  function pauseMusic() { if (bgMusicEl) bgMusicEl.pause(); }
  function resumeMusic() { if (bgMusicEl && !muted) bgMusicEl.play().catch(() => {}); }
  function toggleMute() {
    muted = !muted;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.9;
    if (bgMusicEl) bgMusicEl.muted = muted;
    return muted;
  }

  return {
    init, resume, suspend, blast, lightning, fire, explosion, hit, ultimate,
    bossRoar, levelUp, uiClick, startMusic, stopMusic, pauseMusic, resumeMusic, toggleMute, isMuted: () => muted,
  };
})();

/* ---------------------------------------------------------
   PLAYER
--------------------------------------------------------- */
class Player {
  constructor() {
    this.x = 0; this.y = 0;
    this.r = 20;
    this.maxHp = 100; this.hp = 100;
    this.speed = 4.6;
    this.facing = 0;
    this.invuln = 0;
    this.hitFlash = 0;
    this.trail = [];
    this.animT = 0;
    this.dashCharge = 1;
    this.alive = true;
  }
  update(dt) {
    let mx = 0, my = 0;
    if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) my += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
    if (joystick.active) { mx = joystick.dx; my = joystick.dy; }

    const mlen = Math.hypot(mx, my);
    if (mlen > 0.05) {
      if (mlen > 1) { mx /= mlen; my /= mlen; }
      this.x += mx * this.speed * (dt / 16.6);
      this.y += my * this.speed * (dt / 16.6);
      this.animT += dt * 0.02;
      this.trail.push({ x: this.x, y: this.y, life: 1 });
    }
    this.x = clamp(this.x, -worldBound, worldBound);
    this.y = clamp(this.y, -worldBound, worldBound);

    // facing: mouse on desktop, movement/nearest enemy on mobile
    if (!isMobile) {
      const wm = screenToWorld(mouse.x, mouse.y);
      this.facing = angleTo(this.x, this.y, wm.x, wm.y);
    } else {
      const target = findNearestEnemy(this.x, this.y);
      if (target) this.facing = angleTo(this.x, this.y, target.x, target.y);
      else if (mlen > 0.05) this.facing = Math.atan2(my, mx);
    }

    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.trail = this.trail.filter(t => (t.life -= dt * 0.006) > 0);

    // passive ultimate power regen
    if (ultimatePower < ULTIMATE_MAX) {
      ultimatePower = clamp(ultimatePower + dt * 0.0022, 0, ULTIMATE_MAX);
    }
  }
  takeDamage(amount) {
    if (this.invuln > 0 || !this.alive) return;
    this.hp -= amount;
    this.hitFlash = 200;
    this.invuln = 500;
    combo = 0;
    updateComboUI();
    screenFlash();
    shakeCamera(10, 250);
    burst(this.x, this.y, '#ff4d6d', 16, { minSpd: 2, maxSpd: 5 });
    SFX.hit();
    if (this.hp <= 0) { this.hp = 0; this.alive = false; onPlayerDeath(); }
  }
  draw(c) {
    const sx = this.x - camera.worldX, sy = this.y - camera.worldY;

    // trail
    for (const t of this.trail) {
      c.save();
      c.globalAlpha = t.life * 0.35;
      c.fillStyle = '#00ffff';
      c.beginPath();
      c.arc(t.x - camera.worldX, t.y - camera.worldY, 10 * t.life, 0, TAU);
      c.fill();
      c.restore();
    }

    c.save();
    c.translate(sx, sy);

    // ground glow
    const grd = c.createRadialGradient(0, 8, 2, 0, 8, 34);
    grd.addColorStop(0, 'rgba(0,255,255,0.35)');
    grd.addColorStop(1, 'rgba(0,255,255,0)');
    c.fillStyle = grd;
    c.beginPath(); c.ellipse(0, 8, 34, 14, 0, 0, TAU); c.fill();

    if (this.invuln > 0 && Math.floor(this.invuln / 60) % 2 === 0) c.globalAlpha = 0.4;

    c.rotate(this.facing + Math.PI / 2);

    const bob = Math.sin(this.animT) * 2;
    c.translate(0, bob);

    // outer energy ring
    c.strokeStyle = this.hitFlash > 0 ? '#ff4d6d' : '#00ffff';
    c.shadowColor = c.strokeStyle; c.shadowBlur = (18) * SHADOW_SCALE;
    c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, this.r + 6, 0, TAU); c.stroke();

    // body (cyber warrior silhouette)
    c.shadowBlur = (14) * SHADOW_SCALE;
    c.fillStyle = this.hitFlash > 0 ? '#ffb3c0' : '#0d1b2a';
    c.strokeStyle = '#00ffff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -this.r);
    c.lineTo(this.r * 0.7, this.r * 0.5);
    c.lineTo(0, this.r * 0.9);
    c.lineTo(-this.r * 0.7, this.r * 0.5);
    c.closePath();
    c.fill(); c.stroke();

    // core
    c.fillStyle = '#bffcff';
    c.shadowBlur = (20) * SHADOW_SCALE;
    c.beginPath(); c.arc(0, -2, 5, 0, TAU); c.fill();

    // shoulder blades
    c.strokeStyle = 'rgba(0,255,255,0.8)';
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-this.r * 0.7, this.r * 0.5); c.lineTo(-this.r * 1.1, this.r * 0.1); c.stroke();
    c.beginPath(); c.moveTo(this.r * 0.7, this.r * 0.5); c.lineTo(this.r * 1.1, this.r * 0.1); c.stroke();

    c.restore();
  }
}

/* ---------------------------------------------------------
   ENEMIES
--------------------------------------------------------- */
let enemyIdCounter = 0;
class Enemy {
  constructor(x, y, tier = 1) {
    this.id = enemyIdCounter++;
    this.x = x; this.y = y;
    this.tier = tier;
    this.isBoss = false;
    const scale = 1 + (wave - 1) * 0.12;
    this.maxHp = Math.round((30 + tier * 18) * scale);
    this.hp = this.maxHp;
    this.speed = rand(1.3, 1.9) + (wave * 0.03);
    this.r = 14 + tier * 2;
    this.damage = 8 + tier * 2;
    this.attackCd = 0;
    this.attackRate = rand(900, 1400);
    this.hitFlash = 0;
    this.color = tier === 2 ? '#ff2e88' : '#ff2e4d';
    this.state = 'chase';
    this.telegraph = 0;
    this.knockX = 0; this.knockY = 0;
    this.spawnT = 400; // spawn-in animation
    this.deathT = 0;
    this.dead = false;
  }
  get name() { return this.tier >= 2 ? 'Enforcer Drone' : 'Grid Wraith'; }
  update(dt, player) {
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    if (this.hitFlash > 0) this.hitFlash -= dt;

    const d = dist(this.x, this.y, player.x, player.y);
    const ang = angleTo(this.x, this.y, player.x, player.y);

    if (this.attackCd > 0) this.attackCd -= dt;

    if (d > this.r + player.r + 6) {
      this.x += Math.cos(ang) * this.speed * (dt / 16.6);
      this.y += Math.sin(ang) * this.speed * (dt / 16.6);
    } else if (this.attackCd <= 0) {
      player.takeDamage(this.damage);
      this.attackCd = this.attackRate;
      burst(player.x, player.y, this.color, 6, { minSpd: 1, maxSpd: 3 });
    }

    // knockback decay
    if (Math.abs(this.knockX) > 0.05 || Math.abs(this.knockY) > 0.05) {
      this.x += this.knockX; this.y += this.knockY;
      this.knockX *= 0.85; this.knockY *= 0.85;
    }

    // ambient particles
    if (Math.random() < 0.05) {
      spawnParticles([new Particle(this.x + rand(-8, 8), this.y + rand(-8, 8), {
        vx: rand(-0.2, 0.2), vy: rand(-0.6, -0.1), size: rand(1, 2.5),
        color: this.color, life: 1, type: 'dot', glow: true,
      })]);
    }
  }
  takeDamage(amount, kx = 0, ky = 0) {
    this.hp -= amount;
    this.hitFlash = 140;
    this.knockX += kx; this.knockY += ky;
    burst(this.x, this.y, this.color, 8, { minSpd: 1, maxSpd: 3 });
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      onEnemyKilled(this);
    }
  }
  draw(c) {
    const sx = this.x - camera.worldX, sy = this.y - camera.worldY;
    let scale = 1;
    if (this.spawnT > 0) scale = 1 - this.spawnT / 400;
    c.save();
    c.translate(sx, sy);
    c.scale(scale, scale);

    const grd = c.createRadialGradient(0, 6, 2, 0, 6, this.r * 2);
    grd.addColorStop(0, `${this.color}55`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd;
    c.beginPath(); c.ellipse(0, 6, this.r * 1.6, this.r * 0.7, 0, 0, TAU); c.fill();

    c.shadowColor = this.hitFlash > 0 ? '#fff' : this.color;
    c.shadowBlur = (16) * SHADOW_SCALE;
    c.fillStyle = this.hitFlash > 0 ? '#fff' : '#170510';
    c.strokeStyle = this.color;
    c.lineWidth = 2;

    const spikes = this.tier >= 2 ? 5 : 4;
    c.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * TAU + frameCount * 0.02;
      const rr = i % 2 === 0 ? this.r : this.r * 0.5;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fill(); c.stroke();

    c.fillStyle = '#fff';
    c.shadowBlur = (10) * SHADOW_SCALE;
    c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fill();

    c.restore();

    // hp bar
    if (this.hp < this.maxHp && this.hp > 0) {
      const bw = this.r * 2.2;
      c.save();
      c.translate(sx - bw / 2, sy - this.r - 14);
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(0, 0, bw, 4);
      c.fillStyle = this.color;
      c.shadowColor = this.color; c.shadowBlur = (6) * SHADOW_SCALE;
      c.fillRect(0, 0, bw * (this.hp / this.maxHp), 4);
      c.restore();
    }
  }
}

class Boss extends Enemy {
  constructor(x, y) {
    super(x, y, 3);
    this.isBoss = true;
    this.maxHp = 500 + wave * 40;
    this.hp = this.maxHp;
    this.r = 42;
    this.speed = 1.1;
    this.damage = 16;
    this.color = '#ff2e4d';
    this.phase = 0;
    this.attackRate = 1600;
    this.specialCd = 3000;
    this.chargeTelegraph = 0;
    this.name_ = 'SENTINEL PRIME';
  }
  get name() { return this.name_; }
  update(dt, player) {
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.specialCd > 0) this.specialCd -= dt;

    const d = dist(this.x, this.y, player.x, player.y);
    const ang = angleTo(this.x, this.y, player.x, player.y);

    if (this.chargeTelegraph > 0) {
      this.chargeTelegraph -= dt;
      if (this.chargeTelegraph <= 0) this.dashSlam(player);
      return;
    }

    if (d > 120) {
      this.x += Math.cos(ang) * this.speed * (dt / 16.6);
      this.y += Math.sin(ang) * this.speed * (dt / 16.6);
    }

    if (this.attackCd > 0) this.attackCd -= dt;
    else if (d < 140) {
      player.takeDamage(this.damage);
      this.attackCd = this.attackRate;
      shakeCamera(6, 150);
    }

    if (this.specialCd <= 0) {
      this.specialCd = rand(3500, 5200);
      this.chargeTelegraph = 650;
      this.telegraphTarget = { x: player.x, y: player.y };
      shakeCamera(4, 200);
    }

    if (Math.random() < 0.1) {
      spawnParticles([new Particle(this.x + rand(-30, 30), this.y + rand(-30, 30), {
        vx: rand(-0.3, 0.3), vy: rand(-1, -0.3), size: rand(2, 4),
        color: this.color, life: 1, type: 'spark', glow: true,
      })]);
    }
  }
  dashSlam(player) {
    const ang = angleTo(this.x, this.y, this.telegraphTarget.x, this.telegraphTarget.y);
    this.x += Math.cos(ang) * 160;
    this.y += Math.sin(ang) * 160;
    explosion(this.x, this.y, '#ff2e4d', true);
    if (dist(this.x, this.y, player.x, player.y) < 90) player.takeDamage(24);
  }
  draw(c) {
    const sx = this.x - camera.worldX, sy = this.y - camera.worldY;

    if (this.chargeTelegraph > 0 && this.telegraphTarget) {
      const tx = this.telegraphTarget.x - camera.worldX, ty = this.telegraphTarget.y - camera.worldY;
      c.save();
      c.strokeStyle = '#ff2e4d'; c.lineWidth = 3; c.setLineDash([8, 6]);
      c.globalAlpha = 0.6 + Math.sin(frameCount * 0.3) * 0.3;
      c.shadowColor = '#ff2e4d'; c.shadowBlur = (12) * SHADOW_SCALE;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(tx, ty); c.stroke();
      c.beginPath(); c.arc(tx, ty, 50, 0, TAU); c.stroke();
      c.restore();
    }

    let scale = 1;
    if (this.spawnT > 0) scale = 1 - this.spawnT / 400;
    c.save();
    c.translate(sx, sy);
    c.scale(scale, scale);

    const grd = c.createRadialGradient(0, 10, 4, 0, 10, this.r * 2.2);
    grd.addColorStop(0, 'rgba(255,46,77,0.4)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grd;
    c.beginPath(); c.ellipse(0, 10, this.r * 1.8, this.r * 0.8, 0, 0, TAU); c.fill();

    c.shadowColor = this.hitFlash > 0 ? '#fff' : '#ff2e4d';
    c.shadowBlur = (26) * SHADOW_SCALE;
    c.fillStyle = this.hitFlash > 0 ? '#fff' : '#1a0509';
    c.strokeStyle = '#ff2e4d';
    c.lineWidth = 3;

    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + frameCount * 0.008;
      const rr = i % 2 === 0 ? this.r : this.r * 0.62;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fill(); c.stroke();

    c.fillStyle = '#ffdfe6';
    c.shadowBlur = (18) * SHADOW_SCALE;
    c.beginPath(); c.arc(0, 0, 8, 0, TAU); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(0, 0, 14 + Math.sin(frameCount * 0.05) * 3, 0, TAU); c.stroke();

    c.restore();
  }
}

/* ---------------------------------------------------------
   WORLD / ENTITIES
--------------------------------------------------------- */
const worldBound = 2000;
let player = new Player();
let enemies = [];
let projectiles = []; // for visual traveling energy shots

camera.worldX = 0; camera.worldY = 0;
function screenToWorld(sx, sy) {
  // Entities render as: screen = world - camera.worldX  (see enemy/player draw code)
  // so the inverse is simply: world = screen + camera.worldX — NOT screen - W/2 + camera.worldX.
  // That extra "- W/2" was a leftover offset that threw off every mouse-aim calculation,
  // most severely for enemies close to the player (exactly what caused shots to miss nearby targets).
  return { x: sx + camera.worldX, y: sy + camera.worldY };
}

function findNearestEnemy(x, y) {
  let best = null, bd = Infinity;
  for (const e of enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const d = dist(x, y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/* ---------------------------------------------------------
   SPAWNING
--------------------------------------------------------- */
function spawnEnemy() {
  const a = rand(0, TAU);
  const r = rand(520, 700);
  const x = player.x + Math.cos(a) * r;
  const y = player.y + Math.sin(a) * r;
  const tier = Math.random() < clamp(0.15 + wave * 0.02, 0.15, 0.45) ? 2 : 1;
  enemies.push(new Enemy(x, y, tier));
}

function spawnBoss() {
  const a = rand(0, TAU);
  const x = player.x + Math.cos(a) * 480;
  const y = player.y + Math.sin(a) * 480;
  const b = new Boss(x, y);
  enemies.push(b);
  bossActive = true;
  showBossBanner(true);
  killfeedMsg('⚠ SENTINEL PRIME HAS AWAKENED');
  SFX.bossRoar();
}

let spawnTimer = 0;
function updateSpawning(dt) {
  if (bossActive) return;
  spawnTimer -= dt;
  const rate = clamp(1400 - wave * 60, 380, 1400);
  if (spawnTimer <= 0 && enemies.length < clamp(6 + wave, 6, 22)) {
    spawnEnemy();
    spawnTimer = rate;
  }
}

function checkWaveProgress() {
  if (bossActive) return;
  if (waveKills >= waveKillsNeeded) {
    if (wave % 5 === 0 && bossSpawnedForWave !== wave) {
      bossSpawnedForWave = wave;
      enemies = enemies.filter(e => e.dead);
      spawnBoss();
    } else {
      wave++;
      waveKills = 0;
      waveKillsNeeded = 8 + wave * 2;
      showLevelToast(wave);
      SFX.levelUp();
    }
  }
}

/* ---------------------------------------------------------
   COMBAT — ATTACKS
--------------------------------------------------------- */
function tryAttack() {
  if (gameState !== STATE.PLAYING || !player.alive) return;
  if (currentAttack === 'ultimate') return; // handled by dedicated trigger
  const atk = ATTACKS[currentAttack];
  if (cooldowns[currentAttack] > 0) return;
  cooldowns[currentAttack] = atk.cooldown;

  const aimAngle = getAimAngle();
  if (currentAttack === 'blast') fireBlast(aimAngle);
  else if (currentAttack === 'lightning') fireLightning(aimAngle);
  else if (currentAttack === 'fireball') fireFireball(aimAngle);
}

function getAimAngle() {
  if (!isMobile) {
    const wm = screenToWorld(mouse.x, mouse.y);
    return angleTo(player.x, player.y, wm.x, wm.y);
  }
  const target = findNearestEnemy(player.x, player.y);
  if (target) return angleTo(player.x, player.y, target.x, target.y);
  return player.facing;
}

function fireBlast(angle) {
  const speed = 11;
  const px = player.x + Math.cos(angle) * 24, py = player.y + Math.sin(angle) * 24;
  projectiles.push({
    x: px, y: py, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r: 8, color: '#ff2222', damage: ATTACKS.blast.damage, type: 'blast', life: 1400, pierce: 0,
  });
  burst(px, py, '#ff2222', 6, { minSpd: 0.5, maxSpd: 2 });
  shakeCamera(2, 60);
  SFX.blast();
}

function fireLightning(angle) {
  // instant hitscan chain-lightning toward nearest enemies along a cone
  const range = 420;
  const ex = player.x + Math.cos(angle) * range, ey = player.y + Math.sin(angle) * range;
  drawLightningBolt(player.x, player.y, ex, ey, '#c084ff', 4, 260);
  shakeCamera(6, 150);
  chromaGlitch(180);
  SFX.lightning();

  let hitCount = 0;
  let chainFrom = { x: player.x, y: player.y };
  const targets = enemies
    .filter(e => !e.dead && e.spawnT <= 0 && pointNearSegment(e.x, e.y, player.x, player.y, ex, ey, 60))
    .sort((a, b) => dist(player.x, player.y, a.x, a.y) - dist(player.x, player.y, b.x, b.y));

  for (const e of targets.slice(0, 4)) {
    e.takeDamage(ATTACKS.lightning.damage, Math.cos(angle) * 2, Math.sin(angle) * 2);
    drawLightningBolt(chainFrom.x, chainFrom.y, e.x, e.y, '#e0b3ff', 3, 220);
    burst(e.x, e.y, '#c084ff', 10, { minSpd: 1, maxSpd: 4 });
    chainFrom = e;
    hitCount++;
    registerHit();
  }
  if (hitCount === 0) burst(ex, ey, '#c084ff', 8, { minSpd: 1, maxSpd: 3 });
}

function pointNearSegment(px, py, x1, y1, x2, y2, threshold) {
  const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let t = lenSq !== 0 ? dot / lenSq : -1;
  t = clamp(t, 0, 1);
  const xx = x1 + t * C, yy = y1 + t * D;
  return dist(px, py, xx, yy) < threshold;
}

function fireFireball(angle) {
  const speed = 7;
  const px = player.x + Math.cos(angle) * 24, py = player.y + Math.sin(angle) * 24;
  projectiles.push({
    x: px, y: py, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r: 14, color: '#ff8a1f', damage: ATTACKS.fireball.damage, type: 'fireball', life: 1800, pierce: 1,
  });
  shakeCamera(3, 80);
  SFX.fire();
}

function triggerUltimate() {
  if (gameState !== STATE.PLAYING || !player.alive) return;
  if (ultimatePower < ULTIMATE_MAX) return;
  ultimatePower = 0;

  killfeedMsg('★ ULTIMATE POWER UNLEASHED ★');
  shakeCamera(26, 700);
  screenFlash();
  chromaGlitch(600);
  slowMoTimer = 1200;
  SFX.ultimate();

  // radial explosion of energy
  const rings = 3;
  for (let i = 0; i < rings; i++) {
    setTimeout(() => {
      explosion(player.x, player.y, i % 2 === 0 ? '#ff2e88' : '#00f0ff', true);
    }, i * 140);
  }

  burst(player.x, player.y, '#ff2e88', 60, { minSpd: 3, maxSpd: 14, minSize: 2, maxSize: 6 });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    drawLightningBolt(player.x, player.y, player.x + Math.cos(a) * 260, player.y + Math.sin(a) * 260, '#ff8ac2', 3, 500);
  }

  const radius = 320;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = dist(player.x, player.y, e.x, e.y);
    if (d < radius) {
      const ang = angleTo(player.x, player.y, e.x, e.y);
      e.takeDamage(ATTACKS.ultimate.damage, Math.cos(ang) * 14, Math.sin(ang) * 14);
      registerHit();
    }
  }
}

/* ---------------------------------------------------------
   PROJECTILES UPDATE
--------------------------------------------------------- */
function updateProjectiles(dt) {
  for (const p of projectiles) {
    p.x += p.vx * (dt / 16.6);
    p.y += p.vy * (dt / 16.6);
    p.life -= dt;

    // trail particles
    spawnParticles([new Particle(p.x, p.y, {
      vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), size: p.r * 0.4,
      color: p.color, life: 0.6, type: 'dot', drag: 0.9,
    })]);

    for (const e of enemies) {
      if (e.dead || e.spawnT > 0) continue;
      if (dist(p.x, p.y, e.x, e.y) < e.r + p.r) {
        const ang = angleTo(player.x, player.y, e.x, e.y);
        e.takeDamage(p.damage, Math.cos(ang) * 4, Math.sin(ang) * 4);
        registerHit();
        if (p.type === 'fireball') explosion(p.x, p.y, '#ff8a1f', false);
        else burst(p.x, p.y, p.color, 10, { minSpd: 1, maxSpd: 4 });
        if (p.pierce > 0) { p.pierce--; } else { p.life = 0; }
        break;
      }
    }
  }
  projectiles = projectiles.filter(p => p.life > 0 &&
    dist(p.x, p.y, player.x, player.y) < 1400);
}

function drawProjectiles(c) {
  for (const p of projectiles) {
    const sx = p.x - camera.worldX, sy = p.y - camera.worldY;
    c.save();
    c.shadowColor = p.color; c.shadowBlur = (22) * SHADOW_SCALE;
    c.fillStyle = p.color;
    c.beginPath(); c.arc(sx, sy, p.r, 0, TAU); c.fill();
    c.globalAlpha = 0.5;
    c.beginPath(); c.arc(sx, sy, p.r * 1.8, 0, TAU); c.fill();
    c.restore();
  }
}

/* ---------------------------------------------------------
   COMBO / SCORE / HIT REGISTRATION
--------------------------------------------------------- */
function registerHit() {
  combo++;
  comboTimer = 2200;
  bestCombo = Math.max(bestCombo, combo);
  updateComboUI();
}

function onEnemyKilled(e) {
  const base = e.isBoss ? 1000 : (e.tier >= 2 ? 45 : 25);
  const comboMul = 1 + combo * 0.08;
  score += Math.round(base * comboMul);
  updateScoreUI();
  explosion(e.x, e.y, e.color, e.isBoss);
  SFX.explosion(e.isBoss);
  killfeedMsg(e.isBoss ? '★ SENTINEL PRIME DESTROYED ★' : `+${Math.round(base * comboMul)} · ${e.name}`);

  if (e.isBoss) {
    bossActive = false;
    showBossBanner(false);
    score += 500;

    // reward: fully restore player health after defeating the boss
    player.hp = player.maxHp;
    player.hitFlash = 0;
    updateHealthUI();
    screenFlash();
    killfeedMsg('❤ HEALTH FULLY RESTORED ❤');
  } else {
    waveKills++;
  }
}

function onPlayerDeath() {
  explosion(player.x, player.y, '#00ffff', true);
  setTimeout(() => showGameOver(), 500);
}

/* ---------------------------------------------------------
   BACKGROUND — NEON GRID CITYSCAPE
--------------------------------------------------------- */
let bgStars = [];
for (let i = 0; i < 120; i++) {
  bgStars.push({ x: rand(-3000, 3000), y: rand(-3000, 3000), size: rand(0.5, 2), tw: rand(0, TAU) });
}
let bgPortals = [
  { x: 400, y: -300, r: 90, hue: 190 },
  { x: -900, y: 500, r: 130, hue: 300 },
  { x: 1200, y: 800, r: 100, hue: 320 },
  { x: -1400, y: -700, r: 110, hue: 200 },
];

/* ---- Skyline: houses + trees lining the horizon, scrolling with parallax ---- */
let bgSkyline = [];
(function initSkyline() {
  let x = -4200;
  while (x < 4200) {
    if (Math.random() < 0.38) {
      const w = rand(24, 38);
      bgSkyline.push({ type: 'tree', x, w, h: rand(44, 78), sway: rand(0, TAU), hue: 165 + rand(-15, 15) });
      x += w + rand(24, 60);
    } else {
      const w = rand(46, 100);
      bgSkyline.push({
        type: 'house', x, w, h: rand(64, 210),
        hue: rand(180, 320), windows: Math.round(rand(2, 5)),
        winSeed: rand(0, 1000), roof: Math.random() < 0.5,
      });
      x += w + rand(18, 55);
    }
  }
})();

/* ---- Birds: a small flock that actually flies across the world, with parallax depth ---- */
let bgBirds = [];
for (let i = 0; i < 9; i++) {
  bgBirds.push({
    x: rand(-2000, 2000), yOff: rand(-260, -60),
    speed: (Math.random() < 0.5 ? 1 : -1) * rand(28, 60),
    depth: rand(0.55, 0.85), // parallax factor: closer birds move faster across screen
    scale: rand(0.7, 1.3),
    flapPhase: rand(0, TAU), flapSpeed: rand(0.12, 0.2),
    bobPhase: rand(0, TAU),
  });
}
function updateBirds(dt) {
  for (const b of bgBirds) {
    b.x += b.speed * (dt / 16.6);
    b.flapPhase += b.flapSpeed * (dt / 16.6);
  }
}
function drawSkyline(c, horizon) {
  for (const el of bgSkyline) {
    const sx = el.x - camera.worldX * 0.45;
    if (sx < -160 || sx > W + 160) continue;
    if (el.type === 'house') {
      const hx = sx - el.w / 2, hy = horizon - el.h;
      const grd = c.createLinearGradient(0, hy, 0, horizon);
      grd.addColorStop(0, `hsla(${el.hue}, 45%, 16%, 0.95)`);
      grd.addColorStop(1, `hsla(${el.hue}, 40%, 9%, 0.95)`);
      c.fillStyle = grd;
      c.fillRect(hx, hy, el.w, el.h);
      // roof
      if (el.roof) {
        c.beginPath();
        c.moveTo(hx - 4, hy);
        c.lineTo(hx + el.w / 2, hy - el.w * 0.32);
        c.lineTo(hx + el.w + 4, hy);
        c.closePath();
        c.fillStyle = `hsla(${el.hue}, 40%, 8%, 0.95)`;
        c.fill();
      }
      // neon roofline edge
      c.strokeStyle = `hsla(${el.hue}, 100%, 65%, 0.55)`;
      c.lineWidth = 1.2;
      c.shadowColor = `hsla(${el.hue},100%,60%,0.8)`; c.shadowBlur = 6 * SHADOW_SCALE;
      c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx + el.w, hy); c.stroke();
      c.shadowBlur = 0;
      // glowing windows
      const rows = Math.max(1, Math.floor(el.h / 26));
      for (let r = 0; r < rows; r++) {
        for (let wI = 0; wI < el.windows; wI++) {
          const lit = Math.sin(el.winSeed + r * 3.1 + wI * 1.7 + frameCount * 0.004) > -0.2;
          if (!lit) continue;
          const wx = hx + 6 + wI * ((el.w - 12) / el.windows);
          const wy = hy + 10 + r * 24;
          if (wy > horizon - 8) continue;
          c.fillStyle = `hsla(${el.hue}, 100%, 72%, 0.85)`;
          c.shadowColor = `hsla(${el.hue},100%,65%,0.9)`; c.shadowBlur = 5 * SHADOW_SCALE;
          c.fillRect(wx, wy, 5, 7);
        }
      }
      c.shadowBlur = 0;
    } else {
      // tree — trunk + soft foliage clusters, gentle wind sway
      const sway = Math.sin(frameCount * 0.015 + el.sway) * 3;
      const baseX = sx + sway, baseY = horizon;
      c.strokeStyle = 'rgba(20,14,10,0.9)';
      c.lineWidth = el.w * 0.16;
      c.beginPath(); c.moveTo(sx, baseY); c.lineTo(baseX, baseY - el.h * 0.4); c.stroke();
      c.fillStyle = `hsla(${el.hue}, 55%, 12%, 0.95)`;
      c.strokeStyle = `hsla(${el.hue}, 90%, 55%, 0.35)`;
      c.lineWidth = 1;
      c.shadowColor = `hsla(${el.hue},100%,60%,0.5)`; c.shadowBlur = 5 * SHADOW_SCALE;
      const cx = baseX, cy = baseY - el.h * 0.72;
      for (const [ox, oy, r] of [[0, 0, el.w * 0.55], [-el.w * 0.4, el.w * 0.12, el.w * 0.4], [el.w * 0.4, el.w * 0.1, el.w * 0.4]]) {
        c.beginPath(); c.arc(cx + ox, cy + oy, r, 0, TAU); c.fill(); c.stroke();
      }
      c.shadowBlur = 0;
    }
  }
}
function drawBirds(c) {
  for (const b of bgBirds) {
    const sx = b.x - camera.worldX * b.depth;
    if (sx < -60 || sx > W + 60) continue;
    const sy = H * 0.32 + b.yOff + Math.sin(frameCount * 0.02 + b.bobPhase) * 6 - camera.worldY * b.depth * 0.2;
    if (sy < -20 || sy > H * 0.6) continue;
    const flap = Math.sin(b.flapPhase) * 6 * b.scale;
    c.save();
    c.strokeStyle = 'rgba(180,210,230,0.55)';
    c.lineWidth = 1.6 * b.scale;
    c.lineCap = 'round';
    c.shadowColor = 'rgba(150,220,255,0.4)'; c.shadowBlur = 3 * SHADOW_SCALE;
    c.beginPath();
    c.moveTo(sx - 8 * b.scale, sy - flap);
    c.quadraticCurveTo(sx - 3 * b.scale, sy + 2 * b.scale, sx, sy);
    c.quadraticCurveTo(sx + 3 * b.scale, sy + 2 * b.scale, sx + 8 * b.scale, sy - flap);
    c.stroke();
    c.restore();
  }
}

function drawBackground(c) {
  c.save();
  // deep gradient
  const grd = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
  grd.addColorStop(0, '#10142c');
  grd.addColorStop(1, '#03040a');
  c.fillStyle = grd;
  c.fillRect(0, 0, W, H);

  // stars
  for (const s of bgStars) {
    const sx = s.x - camera.worldX * 0.3, sy = s.y - camera.worldY * 0.3;
    const screenX = ((sx % W) + W) % W, screenY = ((sy % H) + H) % H;
    const tw = 0.4 + Math.sin(frameCount * 0.02 + s.tw) * 0.3;
    c.globalAlpha = tw;
    c.fillStyle = '#bde8ff';
    c.beginPath(); c.arc(screenX, screenY, s.size, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;

  // portals (parallax)
  for (const p of bgPortals) {
    const sx = p.x - camera.worldX * 0.5, sy = p.y - camera.worldY * 0.5;
    if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) continue;
    const pulse = 1 + Math.sin(frameCount * 0.03 + p.x) * 0.08;
    const pgrd = c.createRadialGradient(sx, sy, 0, sx, sy, p.r * pulse);
    pgrd.addColorStop(0, `hsla(${p.hue},100%,70%,0.35)`);
    pgrd.addColorStop(0.6, `hsla(${p.hue},100%,55%,0.12)`);
    pgrd.addColorStop(1, 'transparent');
    c.fillStyle = pgrd;
    c.beginPath(); c.arc(sx, sy, p.r * pulse, 0, TAU); c.fill();
    c.strokeStyle = `hsla(${p.hue},100%,75%,0.5)`;
    c.lineWidth = 2;
    c.beginPath(); c.arc(sx, sy, p.r * 0.55 * pulse, 0, TAU); c.stroke();
  }

  // perspective grid floor
  const horizon = H * 0.62;

  // birds flying across the sky (independent flight + parallax depth)
  drawBirds(c);

  // skyline — houses & trees standing right at the horizon line
  drawSkyline(c, horizon);

  c.strokeStyle = 'rgba(0,240,255,0.18)';
  c.lineWidth = 1;
  const gridOffsetX = -camera.worldX % 80;
  for (let x = -10; x < 30; x++) {
    const gx = x * 80 + gridOffsetX;
    c.beginPath();
    c.moveTo(W / 2 + gx * 0.15, horizon);
    c.lineTo(W / 2 + gx * 3, H);
    c.stroke();
  }
  const gridOffsetY = (-camera.worldY * 0.5) % 60;
  for (let y = 0; y < 12; y++) {
    const t = y / 12;
    const gy = horizon + t * t * (H - horizon) + gridOffsetY * t;
    c.globalAlpha = t;
    c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke();
  }
  c.globalAlpha = 1;

  // horizon glow
  const hgrd = c.createLinearGradient(0, horizon - 60, 0, horizon + 20);
  hgrd.addColorStop(0, 'rgba(255,46,136,0)');
  hgrd.addColorStop(1, 'rgba(0,240,255,0.15)');
  c.fillStyle = hgrd;
  c.fillRect(0, horizon - 60, W, 80);

  c.restore();
}

/* ---------------------------------------------------------
   UI HELPERS
--------------------------------------------------------- */
const el = (id) => document.getElementById(id);
function updateScoreUI() { el('scoreValue').textContent = score.toLocaleString(); }
function updateComboUI() {
  el('comboValue').textContent = `x${combo}`;
  const wrap = el('comboWrap');
  wrap.classList.remove('pop'); void wrap.offsetWidth; wrap.classList.add('pop');
}
function updateHealthUI() {
  const pf = el('playerHpFill'), pt = el('playerHpText');
  pf.style.width = `${clamp((player.hp / player.maxHp) * 100, 0, 100)}%`;
  pt.textContent = `${Math.max(0, Math.round(player.hp))} / ${player.maxHp}`;
  if (player.hp / player.maxHp < 0.3) pf.style.background = 'linear-gradient(90deg,#a90c2c,#ff2e4d)';
  else pf.style.background = '';

  const nearest = enemies.filter(e => !e.dead).sort((a, b) => dist(player.x, player.y, a.x, a.y) - dist(player.x, player.y, b.x, b.y))[0];
  const ef = el('enemyHpFill'), et = el('enemyHpText'), en = el('enemyName');
  if (nearest) {
    ef.style.width = `${clamp((nearest.hp / nearest.maxHp) * 100, 0, 100)}%`;
    et.textContent = `${Math.max(0, Math.round(nearest.hp))} / ${nearest.maxHp}`;
    en.textContent = nearest.name.toUpperCase();
  } else {
    ef.style.width = '0%'; et.textContent = '— / —'; en.textContent = '';
  }
}
function updatePowerUI() {
  el('powerFill').style.width = `${ultimatePower}%`;
  el('powerText').textContent = ultimatePower >= 100 ? 'ULTIMATE READY' : `ULTIMATE ${Math.floor(ultimatePower)}%`;
  el('powerFill').style.filter = ultimatePower >= 100 ? 'brightness(1.4) saturate(1.3)' : 'none';
  document.querySelector('.atk-slot.ultimate').classList.toggle('active', ultimatePower >= 100 && currentAttack === 'ultimate');
}
function updateLevelUI() { el('levelValue').textContent = wave; }

function showLevelToast(n) {
  const toast = el('levelToast');
  el('levelToastNum').textContent = n;
  toast.classList.remove('hidden');
  toast.style.animation = 'none'; void toast.offsetWidth; toast.style.animation = '';
  setTimeout(() => toast.classList.add('hidden'), 1600);
}
function showBossBanner(show) { el('bossBanner').classList.toggle('hidden', !show); }

function killfeedMsg(text) {
  const kf = el('killfeed');
  const item = document.createElement('div');
  item.className = 'kf-item';
  item.textContent = text;
  kf.appendChild(item);
  setTimeout(() => item.remove(), 3300);
  while (kf.children.length > 5) kf.removeChild(kf.firstChild);
}

function updateCooldownUI() {
  document.querySelectorAll('.atk-slot').forEach(slot => {
    const key = slot.dataset.atk;
    if (key === 'ultimate') return;
    slot.classList.toggle('on-cooldown', cooldowns[key] > 0);
  });
}

/* ---------------------------------------------------------
   GAME LOOP
--------------------------------------------------------- */
let lastTime = performance.now();

function update(rawDt) {
  frameCount++;
  // slow motion handling
  if (slowMoTimer > 0) {
    slowMoTimer -= rawDt;
    timeScale = 0.28;
  } else {
    timeScale = 1;
  }
  const dt = rawDt * timeScale;
  elapsed += dt;

  player.update(dt);
  camera.worldX = player.x - W / 2; camera.worldY = player.y - H / 2;
  updateCamera(dt);

  updateSpawning(dt);
  for (const e of enemies) e.update(dt, player);
  enemies = enemies.filter(e => !e.dead || (e.deathT += dt) < 1);

  updateProjectiles(dt);

  for (const key in cooldowns) if (cooldowns[key] > 0) cooldowns[key] -= rawDt;

  if (comboTimer > 0) { comboTimer -= rawDt; if (comboTimer <= 0) { combo = 0; updateComboUI(); } }

  // particles (capped for consistent frame time / smoothness)
  for (const p of particles) p.update(dt);
  particles = particles.filter(p => p.life > 0);
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);

  updateBirds(dt);

  // lightning bolts decay
  for (const b of lightningBolts) b.life -= rawDt;
  lightningBolts = lightningBolts.filter(b => b.life > 0);

  checkWaveProgress();

  updateHealthUI();
  updatePowerUI();
  updateLevelUI();
  updateCooldownUI();

  // continuous fire on mouse-hold / spacebar hold for blast only (feels good)
  if ((mouse.down || keys['Space'] || mobileAttackHeld) && currentAttack === 'blast') tryAttack();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  fxCtx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.translate(camera.x, camera.y);

  drawBackground(ctx);

  drawProjectiles(ctx);

  const drawList = [...enemies].sort((a, b) => a.y - b.y);
  for (const e of drawList) e.draw(ctx);

  player.draw(ctx);

  // particles
  for (const p of particles) p.draw(ctx);

  // lightning bolts
  for (const b of lightningBolts) {
    ctx.save();
    ctx.globalAlpha = clamp(b.life / b.maxLife, 0, 1);
    ctx.strokeStyle = b.color;
    ctx.shadowColor = b.color; ctx.shadowBlur = (16) * SHADOW_SCALE;
    ctx.lineWidth = b.width;
    ctx.beginPath();
    b.pts.forEach((pt, i) => {
      const sx = pt.x - camera.worldX, sy = pt.y - camera.worldY;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function loop(now) {
  const rawDt = Math.min(now - lastTime, 40);
  lastTime = now;
  if (gameState === STATE.PLAYING) {
    update(rawDt);
    draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------------------------------------------------------
   SCREEN / STATE MANAGEMENT
--------------------------------------------------------- */
function resetGame() {
  player = new Player();
  enemies = [];
  particles = [];
  projectiles = [];
  lightningBolts = [];
  score = 0; combo = 0; bestCombo = 0; comboTimer = 0;
  wave = 1; waveKills = 0; waveKillsNeeded = 8;
  bossActive = false; bossSpawnedForWave = -1;
  ultimatePower = 0;
  cooldowns = { blast: 0, lightning: 0, fireball: 0 };
  currentAttack = 'blast';
  setAttack('blast');
  spawnTimer = 400;
  elapsed = 0; frameCount = 0;
  camera.shakeMag = 0; camera.shakeT = 0;
  updateScoreUI(); updateComboUI(); updateLevelUI();
  showBossBanner(false);
}

function startGame() {
  resetGame();
  gameState = STATE.PLAYING;
  el('startScreen').classList.add('hidden');
  el('gameOverScreen').classList.add('hidden');
  el('pauseScreen').classList.add('hidden');
  el('hud').classList.remove('hidden');
  el('pauseBtn').classList.remove('hidden');
  if (isMobile) el('mobileControls').classList.remove('hidden');
  lastTime = performance.now();

  // Audio must be started/resumed from a user gesture (this click) per browser autoplay policy
  SFX.init();
  SFX.resume();
  SFX.stopMusic();
  SFX.startMusic();
}

function togglePause() {
  if (gameState === STATE.PLAYING) {
    gameState = STATE.PAUSED;
    el('pauseScreen').classList.remove('hidden');
    SFX.suspend();
    SFX.pauseMusic();
  } else if (gameState === STATE.PAUSED) {
    gameState = STATE.PLAYING;
    el('pauseScreen').classList.add('hidden');
    lastTime = performance.now();
    SFX.resume();
    SFX.resumeMusic();
  }
}

function showGameOver() {
  gameState = STATE.OVER;
  el('finalScore').textContent = score.toLocaleString();
  el('finalLevel').textContent = wave;
  el('finalCombo').textContent = `x${bestCombo}`;
  el('gameOverScreen').classList.remove('hidden');
  el('hud').classList.add('hidden');
  el('pauseBtn').classList.add('hidden');
  el('mobileControls').classList.add('hidden');
  SFX.stopMusic();
}

/* Button wiring */
el('startBtn').addEventListener('click', startGame);
el('restartBtn').addEventListener('click', startGame);
el('restartFromPauseBtn').addEventListener('click', startGame);
el('resumeBtn').addEventListener('click', togglePause);
el('pauseBtn').addEventListener('click', togglePause);

const muteBtnEl = el('muteBtn');
if (muteBtnEl) {
  muteBtnEl.addEventListener('click', () => {
    const isMuted = SFX.toggleMute();
    muteBtnEl.textContent = isMuted ? '🔇' : '🔊';
    muteBtnEl.classList.toggle('muted', isMuted);
  });
}

document.querySelectorAll('.atk-slot').forEach(slot => {
  slot.addEventListener('click', () => {
    if (slot.dataset.atk === 'ultimate') { triggerUltimate(); return; }
    setAttack(slot.dataset.atk);
  });
});
document.querySelectorAll('.mbtn[data-atk="ultimate"]').forEach(b => {
  b.addEventListener('touchstart', (e) => { e.preventDefault(); triggerUltimate(); }, { passive: false });
});
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Digit4' || e.code === 'KeyF') && gameState === STATE.PLAYING) triggerUltimate();
});

})();