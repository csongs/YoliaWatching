const { createStateMachine } = require('../stateMachine');

describe('initial state', () => {
  test('starts with yolia_see=0 and state=idle', () => {
    const sm = createStateMachine();
    expect(sm.yolia_see).toBe(0);
    expect(sm.state).toBe('idle');
  });
});

describe('computeState - default thresholds', () => {
  let sm;
  beforeEach(() => { sm = createStateMachine(); });

  test('0–39 → idle', () => {
    sm.yolia_see = 0;  expect(sm.computeState()).toBe('idle');
    sm.yolia_see = 39; expect(sm.computeState()).toBe('idle');
  });

  test('40–79 → peek', () => {
    sm.yolia_see = 40; expect(sm.computeState()).toBe('peek');
    sm.yolia_see = 79; expect(sm.computeState()).toBe('peek');
  });

  test('80–100 → cheer', () => {
    sm.yolia_see = 80;  expect(sm.computeState()).toBe('cheer');
    sm.yolia_see = 100; expect(sm.computeState()).toBe('cheer');
  });
});

describe('computeState - custom yoliaStates', () => {
  test('respects custom thresholds', () => {
    const sm = createStateMachine({
      yoliaStates: [
        { min: 90, state: 'cheer' },
        { min: 50, state: 'peek'  },
        { min: 0,  state: 'idle'  },
      ],
    });
    sm.yolia_see = 49; expect(sm.computeState()).toBe('idle');
    sm.yolia_see = 50; expect(sm.computeState()).toBe('peek');
    sm.yolia_see = 89; expect(sm.computeState()).toBe('peek');
    sm.yolia_see = 90; expect(sm.computeState()).toBe('cheer');
  });
});

describe('punish', () => {
  test('drops yolia_see by 20 and sets cry', () => {
    const sm = createStateMachine();
    sm.yolia_see = 60;
    sm.punish();
    expect(sm.yolia_see).toBe(40);
    expect(sm.state).toBe('cry');
  });

  test('clamps yolia_see to 0', () => {
    const sm = createStateMachine();
    sm.yolia_see = 10;
    sm.punish();
    expect(sm.yolia_see).toBe(0);
  });
});
