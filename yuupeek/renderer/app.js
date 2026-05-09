// State → animation config  (loop:false = play once, hold last frame)
const ANIMATIONS = {
  idle:      { srcs: frames('idle',          [0, 2, 4, 5, 4, 2, 0, 0, 1, 0]), loop: true },
  peek:      { srcs: frames('review',        [2,2,2,2, 4,2,2,2, 3, 3, 3]), loop: true, ms: 250   },
  cheer:     { srcs: frames('cheer',        [0,2,3,5,0,5]), loop: true  },
  cry:       { srcs: frames('failed',        8), loop: true  },
  eat:       { srcs: frames('cilantro',      8), loop: false, ms: 250 },
  shocked:   { srcs: frames('jumping',       5), loop: false },
  run_left:  { srcs: frames('running-left',  [0, 3, 4, 5, 7]), loop: true  },
  run_right: { srcs: frames('running-right', [0, 3, 4, 5, 7]), loop: true  },
};

const RUN_STATES = new Set(['run_left', 'run_right']);

function frames(state, n) {
  const indices = Array.isArray(n) ? n : Array.from({ length: n }, (_, i) => i);
  return indices.map(i => `../assets/sprites/frames/${state}/${String(i).padStart(2, '0')}.png`);
}

const FRAME_MS  = 150;
const DISPLAY_W = 128;
const DISPLAY_H = 139;

// Pre-load all images
const cache = {};
Object.values(ANIMATIONS).flatMap(a => a.srcs).forEach(src => {
  if (cache[src]) return;
  const img = new Image();
  img.src = src;
  cache[src] = img;
});

const charEl  = document.getElementById('character');
const canvas  = document.getElementById('char-canvas');
const ctx     = canvas.getContext('2d');
const hudEl   = document.getElementById('hud');
const valEl   = document.getElementById('yuushi-val');
const barFill = document.getElementById('bar-fill');

canvas.width  = DISPLAY_W;
canvas.height = DISPLAY_H;

// ── Position ──────────────────────────────────────────────────────────────────
const REST_RIGHT   = 40;
const PEEK_RIGHT   = 240;
const ANGRY_RIGHT  = 380;
const MANUAL_SPEED = 4; // px per 30ms

let posRight    = REST_RIGHT;
let posBottom   = 60;
let targetRight = REST_RIGHT;

let jumpOffset       = 0;
let jumpOffsetTarget = 0;

charEl.style.right  = posRight  + 'px';
charEl.style.bottom = posBottom + 'px';

function updateHud() {
  hudEl.style.right  = posRight + 'px';
  hudEl.style.bottom = (posBottom + jumpOffset + DISPLAY_H + 8) + 'px';
}
updateHud();

function setTargetForState(state) {
  if (state === 'cheer')                       targetRight = ANGRY_RIGHT;
  else if (state === 'peek')                   targetRight = PEEK_RIGHT;
  else if (state === 'cry' || state === 'eat') { /* stay */ }
  else                                         targetRight = REST_RIGHT;
}

let manualRun = null; // 'left' | 'right' | null

function stopManualRun() {
  manualRun = null;
  runLeftBtn.classList.remove('active');
  runRightBtn.classList.remove('active');
  targetRight = posRight;
  setState(baseState);
}

setInterval(() => {
  if (isDragging) return;

  if (manualRun) {
    const maxRight = window.innerWidth - DISPLAY_W;
    if (manualRun === 'left') {
      posRight = Math.min(maxRight, posRight + MANUAL_SPEED);
      if (currentState !== 'run_left') setState('run_left');
    } else {
      posRight = Math.max(0, posRight - MANUAL_SPEED);
      if (currentState !== 'run_right') setState('run_right');
    }
    charEl.style.right = posRight + 'px';
    updateHud();
    return;
  }

  const diff = targetRight - posRight;
  if (Math.abs(diff) > 0.5) {
    posRight += diff * 0.04;
    charEl.style.right = posRight + 'px';
    updateHud();
    if (Math.abs(diff) > 5 && !animDone) {
      setState(diff > 0 ? 'run_left' : 'run_right');
    }
  } else if (RUN_STATES.has(currentState)) {
    setState(baseState);
  }

  // 跳躍垂直位移插值
  const jd = jumpOffsetTarget - jumpOffset;
  if (Math.abs(jd) > 0.5) {
    jumpOffset += jd * 0.15;
    charEl.style.bottom = (posBottom + jumpOffset) + 'px';
    updateHud();
  } else if (jumpOffset !== jumpOffsetTarget) {
    jumpOffset = jumpOffsetTarget;
    charEl.style.bottom = (posBottom + jumpOffset) + 'px';
    updateHud();
  }
}, 30);

// ── Animation loop ─────────────────────────────────────────────────────────────
let baseState    = 'idle';  // 從 stateMachine 來的真實狀態
let currentState = 'idle';  // 實際播放的動畫狀態
let frameIdx = 0;
let animDone  = false;

function drawFrame() {
  const { srcs } = ANIMATIONS[currentState] ?? ANIMATIONS.idle;
  const img = cache[srcs[frameIdx]];
  ctx.clearRect(0, 0, DISPLAY_W, DISPLAY_H);
  if (img?.complete && img.naturalWidth) {
    ctx.drawImage(img, 0, 0, DISPLAY_W, DISPLAY_H);
  }
}

let lastFrameAt = 0;
setInterval(() => {
  if (animDone) return;
  const anim = ANIMATIONS[currentState] ?? ANIMATIONS.idle;
  const ms = anim.ms ?? FRAME_MS;
  const now = performance.now();
  if (now - lastFrameAt < ms) return;
  lastFrameAt = now;
  const next = frameIdx + 1;
  if (next >= anim.srcs.length) {
    if (!anim.loop) { animDone = true; return; }
    frameIdx = 0;
  } else {
    frameIdx = next;
  }
  drawFrame();
}, 16);

function setState(state) {
  if (currentState === state) return;
  currentState = state;
  frameIdx = 0;
  animDone  = false;
  lastFrameAt = 0;
  drawFrame();
}

function applyUpdate({ value, state }) {
  valEl.textContent   = value;
  barFill.style.width = value + '%';
  barFill.className   = value >= 80 ? 'angry' : value >= 40 ? 'peek' : '';
  charEl.className    = `state-${state}`;
  baseState = state;
  setTargetForState(state);
  // 移動中，或一次性動畫還在播時，不打斷
  const playingOneShot = !(ANIMATIONS[currentState]?.loop ?? true) && !animDone;
  if (!RUN_STATES.has(currentState) && !playingOneShot) setState(state);
}

// ── Drag (X + Y) ──────────────────────────────────────────────────────────────
let isDragging  = false;
let wasDragged  = false;
let dragStartX, dragStartY, dragStartRight, dragStartBottom;

charEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging      = true;
  wasDragged      = false;
  dragStartX      = e.screenX;
  dragStartY      = e.screenY;
  dragStartRight  = posRight;
  dragStartBottom = posBottom;
  charEl.classList.add('dragging');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = dragStartX - e.screenX;
  const dy = e.screenY - dragStartY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragged = true;
  posRight  = Math.max(0, dragStartRight  + dx);
  posBottom = Math.max(0, dragStartBottom - dy);
  charEl.style.right  = posRight  + 'px';
  charEl.style.bottom = posBottom + 'px';
  updateHud();
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  charEl.classList.remove('dragging');
  targetRight = posRight;
});

document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && manualRun) stopManualRun();
});

charEl.addEventListener('click', () => {
  wasDragged = false;
});

charEl.addEventListener('mouseenter', () => window.yuuApi.setClickThrough(false));
charEl.addEventListener('mouseleave', () => {
  if (!isDragging) window.yuuApi.setClickThrough(true);
});

charEl.addEventListener('contextmenu', (e) => e.preventDefault());

// ── HUD buttons ───────────────────────────────────────────────────────────────
const feedBtn     = document.getElementById('feed-btn');
const runLeftBtn  = document.getElementById('run-left-btn');
const runRightBtn = document.getElementById('run-right-btn');
const jumpBtn     = document.getElementById('jump-btn');
const cheerBtn    = document.getElementById('cheer-btn');

feedBtn.addEventListener('click', () => {
  if (manualRun) stopManualRun();
  setState('eat');
  window.yuuApi.feed();
});

runLeftBtn.addEventListener('click', () => {
  if (manualRun === 'left') { stopManualRun(); return; }
  manualRun = 'left';
  runLeftBtn.classList.add('active');
  runRightBtn.classList.remove('active');
});

runRightBtn.addEventListener('click', () => {
  if (manualRun === 'right') { stopManualRun(); return; }
  manualRun = 'right';
  runRightBtn.classList.add('active');
  runLeftBtn.classList.remove('active');
});

jumpBtn.addEventListener('click', () => {
  if (manualRun) stopManualRun();
  const restore = baseState;
  setState('shocked');
  jumpOffsetTarget = 60;                                          // 起跳往上
  setTimeout(() => { jumpOffsetTarget = 0; }, 5 * 150 / 2);     // 落下
  setTimeout(() => {
    if (currentState === 'shocked') setState(restore);
    jumpOffsetTarget = 0;
    jumpOffset = 0;
    charEl.style.bottom = posBottom + 'px';
    updateHud();
  }, 5 * 150 + 50);
});

cheerBtn.addEventListener('click', () => window.yuuApi.setYuushi(80));

[feedBtn, runLeftBtn, runRightBtn, jumpBtn, cheerBtn].forEach(btn => {
  btn.addEventListener('mouseenter', () => window.yuuApi.setClickThrough(false));
  btn.addEventListener('mouseleave', () => window.yuuApi.setClickThrough(true));
});

// ── IPC ───────────────────────────────────────────────────────────────────────
window.yuuApi.onUpdate(applyUpdate);

window.yuuApi.onBaron(() => {
  const prev = currentState;
  setState('shocked');
  charEl.className = 'state-shocked';
  setTimeout(() => {
    charEl.className = `state-${prev}`;
    setState(prev);
  }, 3000);
});

window.addEventListener('load', drawFrame);
