const { DEFAULT_ANIMATIONS } = require('../defaultAnimations');

test('十個內建狀態都有 folder/frames/ms/loop', () => {
  const states = Object.keys(DEFAULT_ANIMATIONS);
  expect(states.sort()).toEqual([
    'cheer', 'cry', 'eat', 'idle', 'jump', 'peek', 'run_left', 'run_right', 'wave', 'watch_excited',
  ].sort());
  for (const [name, a] of Object.entries(DEFAULT_ANIMATIONS)) {
    expect(typeof a.folder).toBe('string');
    expect(Array.isArray(a.frames)).toBe(true);
    expect(a.frames.length).toBeGreaterThan(0);
    expect(typeof a.ms).toBe('number');
    expect(typeof a.loop).toBe('boolean');
  }
});

test('動畫名≠資料夾名的兩個特例(peek→review、eat→cilantro)', () => {
  expect(DEFAULT_ANIMATIONS.peek.folder).toBe('review');
  expect(DEFAULT_ANIMATIONS.eat.folder).toBe('cilantro');
});
