/**
 * @jest-environment jsdom
 */

// Suppress image load errors from jsdom trying to fetch sprite files
global.Image = class {
  constructor() { this.complete = false; this.naturalWidth = 0; }
  set src(_) {}
};

const { DEFAULT_ANIMATIONS } = require('../defaultAnimations');

const createCharacter = (() => {
  const script = require('fs').readFileSync(
    require('path').join(__dirname, '../../renderer/character.js'), 'utf8'
  );
  // eslint-disable-next-line no-new-func
  return new Function('return ' + script.match(/function createCharacter[\s\S]+^\}/m)?.[0])();
})();

function makeChar(overrides = {}) {
  const ctx = { clearRect: jest.fn(), drawImage: jest.fn() };
  const canvas = { width: 0, height: 0 };
  const charEl = document.createElement('div');
  const valEl  = document.createElement('span');
  const barFill = document.createElement('div');

  return createCharacter({
    canvas, ctx, charEl, valEl, barFill,
    speechEl: null,
    assetBase: '/assets',
    defaultAnimations: DEFAULT_ANIMATIONS,
    onUpdateHud: jest.fn(),
    ...overrides,
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// ── run animation triggers ─────────────────────────────────────────────────────

describe('run animation', () => {
  test('triggers run_left when moving to higher right value', () => {
    const char = makeChar();
    char.setPos(40, 60);
    char.setTargetRight(240); // diff = +200

    jest.advanceTimersByTime(60); // 2 movement ticks

    expect(char.getCurrentState()).toBe('run_left');
  });

  test('triggers run_right when moving to lower right value', () => {
    const char = makeChar();
    char.setPos(240, 60);
    char.setTargetRight(40); // diff = -200

    jest.advanceTimersByTime(60);

    expect(char.getCurrentState()).toBe('run_right');
  });

  test('triggers on state transition without explicit run command', () => {
    const char = makeChar();
    // Simulate idle→peek: applyUpdate moves character to PEEK_RIGHT
    char.applyUpdate({ value: 50, state: 'peek', animOnly: false });

    jest.advanceTimersByTime(60);

    expect(char.getCurrentState()).toBe('run_left');
  });

  test('reverts to baseState on arrival', () => {
    const char = makeChar();
    char.applyUpdate({ value: 50, state: 'peek', animOnly: false }); // baseState = 'peek'

    jest.advanceTimersByTime(60);
    expect(char.getCurrentState()).toBe('run_left');

    // Snap to target
    char.setPos(240, 60);
    char.setTargetRight(240);
    jest.advanceTimersByTime(60);

    expect(char.getCurrentState()).toBe('peek');
  });

  test('does not trigger when playOnce animation is active', () => {
    const char = makeChar();
    // Play a command animation (animOnly → playOnce = true)
    char.applyUpdate({ value: 50, state: 'cry', animOnly: true });

    char.setPos(40, 60);
    char.setTargetRight(240);
    jest.advanceTimersByTime(60);

    expect(char.getCurrentState()).toBe('cry');
  });

  test('does not trigger for small movements (≤5px)', () => {
    const char = makeChar();
    char.setState('idle');
    char.setPos(40, 60);
    char.setTargetRight(43); // diff = 3

    jest.advanceTimersByTime(60);

    expect(char.getCurrentState()).toBe('idle');
  });
});

// ── setAnimations srcs support(規格 §4)────────────────────────────────────

describe('setAnimations srcs support', () => {
  test('接受 srcs 陣列並可播放自訂狀態至結束回 baseState', () => {
    const char = makeChar();
    char.setAnimations({ hurt: { srcs: ['data:image/png;base64,AAA'], ms: 50, loop: false } });
    char.applyUpdate({ value: 0, state: 'hurt', animOnly: true });
    expect(char.getCurrentState()).toBe('hurt');

    jest.advanceTimersByTime(300); // 1 幀 × 50ms 播畢 → 回 baseState(idle)
    expect(char.getCurrentState()).toBe('idle');
  });

  test('無 srcs 也無 folder 的項目靜默跳過,不炸', () => {
    const char = makeChar();
    expect(() => char.setAnimations({ bad: { frames: 3 }, worse: null })).not.toThrow();
  });

  test('folder 格式(舊路徑)行為不變', () => {
    const char = makeChar();
    char.setAnimations({ hurt: { folder: 'hurt', frames: [0, 1], ms: 50, loop: false } });
    char.applyUpdate({ value: 0, state: 'hurt', animOnly: true });
    expect(char.getCurrentState()).toBe('hurt');
  });

  test('def 為 null 時移除該狀態(停用角色包清殘留)', () => {
    const char = makeChar();
    char.setAnimations({ hurt: { srcs: ['data:image/png;base64,AAA'], ms: 50, loop: false } });
    char.setAnimations({ hurt: null });
    // 移除後播放 hurt:引擎查無此狀態,幀來源回退 idle;300ms(僅 1 幀時足以播畢)不會結束
    // idle 的 10 幀序列,狀態應停留在 hurt(與「未知狀態」行為一致,不炸)
    expect(() => char.applyUpdate({ value: 0, state: 'hurt', animOnly: true })).not.toThrow();
    jest.advanceTimersByTime(300);
    expect(char.getCurrentState()).toBe('hurt');
  });

  test('移除不存在的狀態不炸', () => {
    const char = makeChar();
    expect(() => char.setAnimations({ ghost: null })).not.toThrow();
  });
});
