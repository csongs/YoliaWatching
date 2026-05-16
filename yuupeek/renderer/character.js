// Shared character engine — used by both Electron overlay (app.js) and OBS Browser Source.
//
// createCharacter(options) → character API
//
// options:
//   canvas, ctx        — <canvas> element and its 2D context
//   charEl             — wrapping element whose CSS right/bottom are animated
//   valEl              — span showing the yolia_see percentage number
//   barFill            — div whose width% reflects yolia_see
//   speechEl           — element for speech bubble (optional)
//   assetBase          — path prefix for sprite frames (no trailing slash)
//   onUpdateHud        — fn({ posRight, posBottom, jumpOffset, canvasW, canvasH })
//                        called whenever position changes — caller positions the HUD
//   getIsDragging      — () => bool — when true, movement loop is paused (optional, default false)

function createCharacter({
  canvas, ctx, charEl, valEl, barFill,
  speechEl = null,
  assetBase,
  onUpdateHud,
  getIsDragging = () => false,
  waveVariants = null,
}) {
  function frames(state, n) {
    const indices = Array.isArray(n) ? n : Array.from({ length: n }, (_, i) => i);
    return indices.map(i => `${assetBase}/${state}/${String(i).padStart(2, '0')}.png`);
  }

  const ANIMATIONS = {
    idle:      { srcs: frames('idle',          [0, 2, 4, 5, 4, 2, 0, 0, 1, 0]), loop: false },
    peek:      { srcs: frames('review',        [2,2,2,2, 4,2,2,2, 3, 3, 3]), loop: false, ms: 250 },
    cheer:     { srcs: frames('cheer',         [0,2,3,5,0,5]), loop: false },
    cry:       { srcs: frames('cry',           [0,7,7,7,0,1,1,1,0,0]), loop: false },
    eat:       { srcs: frames('cilantro',      [0,1,2,3,4,5,6,7,7]), loop: false, ms: 250 },
    jump:      { srcs: frames('jumping',       [0,1,2,3]), loop: false , ms: 250},
    wave:      { srcs: frames('waving',        [0,1,2,3,2,1,0]), loop: false, ms: 200 },
    run_left:  { srcs: frames('running-left',  [0, 3, 4, 5, 7]), loop: true },
    run_right: { srcs: frames('running-right', [0, 3, 4, 5, 7]), loop: true },
  };

  const RUN_STATES = new Set(['run_left', 'run_right']);

  const FRAME_MS   = 150;
  const DISPLAY_W  = 128;
  const DISPLAY_H  = 139;
  const POSBOT     = 60;

  const REST_RIGHT   = 40;
  const PEEK_RIGHT   = 240;
  const ANGRY_RIGHT  = 380;
  const MANUAL_SPEED = 4;

  const JUMP_BASE     = 120;
  const JUMP_ADD      = 50;
  const JUMP_MAX      = 500;
  const JUMP_COMBO_MS = 1200;

  const cache = {};
  function cacheFrames(srcs) {
    srcs.forEach(src => {
      if (cache[src]) return;
      const img = new Image(); img.src = src; cache[src] = img;
    });
  }
  Object.values(ANIMATIONS).forEach(a => cacheFrames(a.srcs));

  let _waveVariants = waveVariants;
  if (_waveVariants) _waveVariants.forEach(v => cacheFrames(frames('waving', v.frames)));

  function pickWaveVariant() {
    if (!_waveVariants?.length) return null;
    const total = _waveVariants.reduce((s, v) => s + (v.weight ?? 1), 0);
    let r = Math.random() * total;
    for (const v of _waveVariants) {
      r -= (v.weight ?? 1);
      if (r <= 0) return v;
    }
    return _waveVariants[_waveVariants.length - 1];
  }

  canvas.width  = DISPLAY_W;
  canvas.height = DISPLAY_H;

  let posRight     = REST_RIGHT;
  let posBottom    = POSBOT;
  let targetRight  = REST_RIGHT;
  let dragOffsetX  = 0;
  let naturalRight = REST_RIGHT;

  let jumpOffset       = 0;
  let jumpOffsetTarget = 0;
  let jumpHeight       = JUMP_BASE;
  let lastJumpAt       = 0;
  let jumpTimer1       = null;
  let jumpTimer2       = null;

  charEl.style.right  = posRight + 'px';
  charEl.style.bottom = posBottom + 'px';

  function updateHud() {
    onUpdateHud({ posRight, posBottom, jumpOffset, canvasW: canvas.width, canvasH: canvas.height });
  }
  updateHud();

  const RUN_SHIFT = 250;

  function setTargetForState(state) {
    if (state === 'cheer')                       naturalRight = ANGRY_RIGHT;
    else if (state === 'peek')                   naturalRight = PEEK_RIGHT;
    else if (state === 'cry' || state === 'eat') { /* stay */ }
    else                                         naturalRight = REST_RIGHT;
    targetRight = naturalRight + dragOffsetX;
  }

  let isMovingForRun = null; // 'run_left' | 'run_right' while a run command is in progress

  let manualRun         = null;
  let manualRunLeftBtn  = null;
  let manualRunRightBtn = null;

  function stopManualRun() {
    manualRun = null;
    manualRunLeftBtn?.classList.remove('active');
    manualRunRightBtn?.classList.remove('active');
    targetRight = posRight;
    setState(baseState);
  }

  setInterval(() => {
    if (getIsDragging()) return;

    if (manualRun) {
      const maxRight = window.innerWidth - canvas.width;
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
      const isAirborne = jumpOffsetTarget > 0 || jumpOffset > 1;
      if (Math.abs(diff) > 5 && !isAirborne && !playOnce) {
        setState(diff > 0 ? 'run_left' : 'run_right');
      }
    } else {
      if (isMovingForRun) isMovingForRun = null;
      if (!playOnce && RUN_STATES.has(currentState)) setState(baseState);
    }

    const jd = jumpOffsetTarget - jumpOffset;
    if (Math.abs(jd) > 0.5) jumpOffset += jd * 0.15;
    else jumpOffset = jumpOffsetTarget;

    charEl.style.right  = posRight + 'px';
    charEl.style.bottom = (posBottom + jumpOffset) + 'px';
    updateHud();
  }, 30);

  let baseState    = 'idle';
  let currentState = 'idle';
  let frameIdx     = 0;
  let animDone     = false;
  let lastFrameAt  = 0;
  let playOnce     = false; // true = animOnly command: play once even if loop:true, then revert

  function drawFrame() {
    const { srcs } = ANIMATIONS[currentState] ?? ANIMATIONS.idle;
    const img = cache[srcs[frameIdx]];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img?.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  setInterval(() => {
    if (animDone) return;
    const anim = ANIMATIONS[currentState] ?? ANIMATIONS.idle;
    const ms   = anim.ms ?? FRAME_MS;
    const now  = performance.now();
    if (now - lastFrameAt < ms) return;
    lastFrameAt = now;
    const next         = frameIdx + 1;
    const effectiveLoop = playOnce ? false : anim.loop;
    if (next >= anim.srcs.length) {
      if (!effectiveLoop) {
        playOnce = false;
        animDone = true;
        if (currentState !== baseState) setState(baseState);
        else { frameIdx = 0; animDone = false; lastFrameAt = performance.now(); drawFrame(); } // same state: restart
        return;
      }
      frameIdx = 0;
    } else {
      frameIdx = next;
    }
    drawFrame();
  }, 16);

  function setState(state, once = false) {
    if (currentState === state && !once) return;
    currentState = state;
    frameIdx     = 0;
    animDone     = false;
    lastFrameAt  = performance.now();
    playOnce     = once;
    drawFrame();
  }

  function triggerJump() {
    const now = Date.now();
    if (now - lastJumpAt < JUMP_COMBO_MS && jumpOffsetTarget > 0) {
      jumpHeight = Math.min(JUMP_MAX, jumpHeight + JUMP_ADD);
    } else {
      jumpHeight = JUMP_BASE;
    }
    lastJumpAt = now;
    clearTimeout(jumpTimer1);
    clearTimeout(jumpTimer2);
    jumpOffsetTarget = jumpHeight;
    const airTime = Math.round(jumpHeight * 800 / JUMP_BASE);
    jumpTimer1 = setTimeout(() => { jumpOffsetTarget = 0; }, airTime / 2);
    jumpTimer2 = setTimeout(() => { jumpOffset = 0; jumpOffsetTarget = 0; }, airTime + 50);
  }

  let speechTimer = null;
  function showSpeech(text) {
    if (!speechEl) return;
    speechEl.textContent = text;
    speechEl.classList.add('show');
    clearTimeout(speechTimer);
    speechTimer = setTimeout(() => speechEl.classList.remove('show'), 5000);
  }

  // animOnly: true = chat command, skip position change (animation at current spot)
  function applyUpdate({ value, state, animOnly = false, speech = null }) {
    valEl.textContent   = value;
    barFill.style.width = value + '%';
    barFill.className   = value >= 80 ? 'angry' : value >= 40 ? 'peek' : '';
    charEl.className    = `state-${state}`;
    if (speech) showSpeech(speech);

    if (RUN_STATES.has(state)) {
      const shift = state === 'run_left' ? RUN_SHIFT : -RUN_SHIFT;
      const maxRight = window.innerWidth - canvas.width;
      dragOffsetX = Math.max(-naturalRight, Math.min(maxRight - naturalRight, dragOffsetX + shift));
      targetRight = naturalRight + dragOffsetX;
      isMovingForRun = state;
      return;
    }

    if (!animOnly) {
      baseState = state;
      setTargetForState(state);
      isMovingForRun = null;
    }
    const canPlay = animOnly || (!RUN_STATES.has(currentState) && !playOnce);
    if (canPlay) {
      if (state === 'wave') {
        const v = pickWaveVariant();
        if (v) ANIMATIONS.wave = { srcs: frames('waving', v.frames), loop: false, ms: v.ms ?? 200 };
      }
      setState(state, animOnly);
    }
    if (state === 'jump') triggerJump();
  }

  function scheduleWander() {
    const delay = 10000 + Math.random() * 20000;
    setTimeout(() => {
      if (baseState !== 'idle') { scheduleWander(); return; }
      const dist = 60 + Math.random() * 120;
      targetRight = naturalRight + dragOffsetX + dist;
      const linger = 1500 + Math.random() * 2500;
      setTimeout(() => {
        if (baseState === 'idle') targetRight = naturalRight + dragOffsetX;
        scheduleWander();
      }, linger);
    }, delay);
  }

  function setScale(s) {
    canvas.width  = Math.round(DISPLAY_W * s);
    canvas.height = Math.round(DISPLAY_H * s);
    drawFrame();
    updateHud();
  }

  window.addEventListener('load', drawFrame);

  return {
    applyUpdate,
    showSpeech,
    triggerJump,
    setState,
    drawFrame,
    setScale,
    scheduleWander,
    getBaseState:    () => baseState,
    getCurrentState: () => currentState,
    getPos:          () => ({ posRight, posBottom }),
    getDragOffsetX:  () => dragOffsetX,
    getNaturalRight: () => naturalRight,
    getManualRun:    () => manualRun,
    setManualRun(dir) { manualRun = dir; },
    stopManualRun,
    setManualRunButtons(leftBtn, rightBtn) {
      manualRunLeftBtn  = leftBtn;
      manualRunRightBtn = rightBtn;
    },
    setPos(right, bottom) {
      posRight  = right;
      posBottom = bottom;
      charEl.style.right  = posRight + 'px';
      charEl.style.bottom = posBottom + 'px';
      updateHud();
    },
    setTargetRight(t) { targetRight = t; },
    setDragOffset(dx) { dragOffsetX = dx; },
    setWaveVariants(v) {
      _waveVariants = v;
      if (v) v.forEach(variant => cacheFrames(frames('waving', variant.frames)));
    },
    setAnimations(cfg) {
      Object.entries(cfg).forEach(([state, def]) => {
        if (!def?.folder || !Array.isArray(def.frames)) return;
        const srcs = def.frames.map(
          i => `${assetBase}/${def.folder}/${String(i).padStart(2, '0')}.png`
        );
        ANIMATIONS[state] = { srcs, loop: !!def.loop, ms: def.ms };
        cacheFrames(srcs);
      });
    },
    DISPLAY_W,
    DISPLAY_H,
    POSBOT,
  };
}
