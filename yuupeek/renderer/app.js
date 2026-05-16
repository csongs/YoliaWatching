const canvas   = document.getElementById('char-canvas');
const ctx      = canvas.getContext('2d');
const charEl   = document.getElementById('character');
const hudEl    = document.getElementById('hud');
const valEl    = document.getElementById('yolia-see-val');
const barFill  = document.getElementById('bar-fill');
const speechEl = document.getElementById('speech-bubble');

let isDragging      = false;
let wasDragged      = false;
let dragStartX, dragStartY, dragStartRight, dragStartBottom;

const char = createCharacter({
  canvas, ctx, charEl, valEl, barFill, speechEl,
  assetBase:    '../assets/sprites/frames',
  onUpdateHud({ posRight, posBottom, jumpOffset, canvasH }) {
    hudEl.style.right  = posRight + 'px';
    hudEl.style.bottom = (posBottom + jumpOffset + canvasH + 8) + 'px';
  },
  getIsDragging: () => isDragging,
});

yuuApi.getConfig().then(cfg => {
  if (cfg?.greetingAnimations?.length) char.setWaveVariants(cfg.greetingAnimations);
  if (cfg?.animations) char.setAnimations(cfg.animations);
});
yuuApi.onAnimationsUpdate(cfg => char.setAnimations(cfg));

// ── Drag ──────────────────────────────────────────────────────────────────────
charEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging      = true;
  wasDragged      = false;
  dragStartX      = e.screenX;
  dragStartY      = e.screenY;
  ({ posRight: dragStartRight, posBottom: dragStartBottom } = char.getPos());
  charEl.classList.add('dragging');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = dragStartX - e.screenX;
  const dy = e.screenY - dragStartY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragged = true;
  char.setPos(
    Math.max(0, dragStartRight  + dx),
    Math.max(0, dragStartBottom - dy),
  );
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  charEl.classList.remove('dragging');
  char.setTargetRight(char.getPos().posRight);
});

document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && char.getManualRun()) char.stopManualRun();
});

charEl.addEventListener('click',       () => { wasDragged = false; });
charEl.addEventListener('mouseenter',  () => window.yuuApi.setClickThrough(false));
charEl.addEventListener('mouseleave',  () => { if (!isDragging) window.yuuApi.setClickThrough(true); });
charEl.addEventListener('contextmenu', (e) => e.preventDefault());

// ── HUD buttons ───────────────────────────────────────────────────────────────
const feedBtn     = document.getElementById('feed-btn');
const runLeftBtn  = document.getElementById('run-left-btn');
const runRightBtn = document.getElementById('run-right-btn');
const jumpBtn     = document.getElementById('jump-btn');
const cheerBtn    = document.getElementById('cheer-btn');
const cryBtn      = document.getElementById('cry-btn');
const quitBtn     = document.getElementById('quit-btn');

char.setManualRunButtons(runLeftBtn, runRightBtn);

feedBtn.addEventListener('click', () => {
  if (char.getManualRun()) char.stopManualRun();
  char.setState('eat');
  window.yuuApi.feed();
});

runLeftBtn.addEventListener('click', () => {
  if (char.getManualRun() === 'left') { char.stopManualRun(); return; }
  char.setManualRun('left');
  runLeftBtn.classList.add('active');
  runRightBtn.classList.remove('active');
});

runRightBtn.addEventListener('click', () => {
  if (char.getManualRun() === 'right') { char.stopManualRun(); return; }
  char.setManualRun('right');
  runRightBtn.classList.add('active');
  runLeftBtn.classList.remove('active');
});

jumpBtn.addEventListener('click', () => {
  if (char.getManualRun()) char.stopManualRun();
  char.setState('jump');
  char.triggerJump();
});

cheerBtn.addEventListener('click', () => window.yuuApi.setYoliaSee(80));
cryBtn.addEventListener('click',   () => window.yuuApi.punish());
quitBtn.addEventListener('click',  () => window.yuuApi.quit());

[feedBtn, runLeftBtn, runRightBtn, jumpBtn, cheerBtn, cryBtn, quitBtn].forEach(btn => {
  btn.addEventListener('mouseenter', () => window.yuuApi.setClickThrough(false));
  btn.addEventListener('mouseleave', () => window.yuuApi.setClickThrough(true));
});

// ── IPC ───────────────────────────────────────────────────────────────────────
window.yuuApi.onUpdate(char.applyUpdate);

window.yuuApi.onBaron(() => {
  const prev = char.getCurrentState();
  char.setState('jump');
  charEl.className = 'state-jump';
  setTimeout(() => {
    charEl.className = `state-${prev}`;
    char.setState(prev);
  }, 3000);
});

char.scheduleWander();
