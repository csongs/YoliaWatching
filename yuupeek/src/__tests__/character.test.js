/**
 * @jest-environment jsdom
 */

// Suppress image load errors from jsdom trying to fetch sprite files
global.Image = class {
  constructor() { this.complete = false; this.naturalWidth = 0; }
  set src(_) {}
};

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
