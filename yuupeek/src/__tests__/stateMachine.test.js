const { createStateMachine } = require('../stateMachine');

test('starts idle with yuushi 0', () => {
  const sm = createStateMachine();
  expect(sm.state).toBe('idle');
  expect(sm.yuushi).toBe(0);
});

test('tick with stream increases yuushi', () => {
  const sm = createStateMachine();
  sm.tick(true);
  expect(sm.yuushi).toBeGreaterThan(0);
  expect(sm.yuushi).toBeLessThanOrEqual(100);
});

test('tick without stream decreases yuushi', () => {
  const sm = createStateMachine();
  sm.yuushi = 50;
  sm.tick(false);
  expect(sm.yuushi).toBeLessThan(50);
});

test('punish drops yuushi by 20 and sets cry state', () => {
  const sm = createStateMachine();
  sm.yuushi = 60;
  sm.punish();
  expect(sm.yuushi).toBe(40);
  expect(sm.state).toBe('cry');
});

test('state transitions at thresholds', () => {
  const sm = createStateMachine();
  sm.yuushi = 0;  expect(sm.computeState()).toBe('idle');
  sm.yuushi = 40; expect(sm.computeState()).toBe('peek');
  sm.yuushi = 80; expect(sm.computeState()).toBe('angry');
});

test('yuushi clamps between 0 and 100', () => {
  const sm = createStateMachine();
  sm.yuushi = 99; sm.tick(true);  expect(sm.yuushi).toBeLessThanOrEqual(100);
  sm.yuushi = 1;  sm.tick(false); expect(sm.yuushi).toBeGreaterThanOrEqual(0);
});
