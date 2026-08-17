const {
  normalizeInteraction, buildEventHandlers, computeState, processEvent, planMessageEffects,
} = require('../chatProcessor');

describe('computeState', () => {
  const thresholds = [
    { trigger: 'threshold', min: 30, state: 'peek' },
    { trigger: 'threshold', min: 70, state: 'cheer' },
  ];
  test('取最高符合門檻', () => {
    expect(computeState(75, thresholds)).toBe('cheer');
    expect(computeState(69, thresholds)).toBe('peek');
    expect(computeState(30, thresholds)).toBe('peek'); // 恰好等於 min
    expect(computeState(10, thresholds)).toBe('idle');
  });
  test('無門檻回 idle', () => {
    expect(computeState(99, [])).toBe('idle');
    expect(computeState(99, undefined)).toBe('idle');
  });
});

describe('normalizeInteraction(舊格式 keyword/command 轉新格式)', () => {
  test('keyword → eventTypes:[chat] + matchMode:contains', () => {
    const r = normalizeInteraction({ id: 'k1', trigger: 'keyword', match: '安安', animation: 'wave', yolia_see: 5, response: 'hi' });
    expect(r).toEqual({ id: 'k1', eventTypes: ['chat'], matchMode: 'contains', match: '安安', minEnergy: null, energyDelta: 5, speech: 'hi', action: 'wave' });
  });
  test('command → matchMode:prefix,cost 轉 minEnergy', () => {
    const r = normalizeInteraction({ id: 'c1', trigger: 'command', match: '!跳', animation: 'jump', cost: 10 });
    expect(r.matchMode).toBe('prefix');
    expect(r.minEnergy).toBe(10);
    expect(r.energyDelta).toBeNull();
  });
  test('已經是新格式(有 eventTypes)原樣放行', () => {
    const rule = { id: 'r1', eventTypes: ['donation'], action: 'cheer' };
    expect(normalizeInteraction(rule)).toBe(rule);
  });
});

describe('buildEventHandlers', () => {
  test('threshold 規則被濾掉,不進 rules', () => {
    const h = buildEventHandlers([
      { trigger: 'threshold', min: 50, state: 'peek' },
      { trigger: 'keyword', match: '安安' },
    ]);
    expect(h.rules).toHaveLength(1);
    expect(h.rules[0].eventTypes).toEqual(['chat']);
  });
});

describe('processEvent — 沒有規則命中', () => {
  test('回傳 null,呼叫端什麼都不做', () => {
    const handlers = buildEventHandlers([{ trigger: 'keyword', match: '安安', animation: 'wave' }]);
    expect(processEvent({ eventType: 'chat', category: 'chat', message: '隨便聊', username: 'x' }, handlers, 10, [])).toBeNull();
  });
  test('eventTypes 對不到 evt 也回 null', () => {
    const handlers = buildEventHandlers([{ id: 'r1', eventTypes: ['cheer'], action: 'cheer' }]);
    expect(processEvent({ eventType: 'chat', category: 'chat', message: 'x', username: 'x' }, handlers, 10, [])).toBeNull();
  });
});

describe('processEvent — 文字比對(prefix/contains)', () => {
  const handlers = buildEventHandlers([
    { id: 'c1', eventTypes: ['chat'], matchMode: 'prefix', match: ['!跳'], action: 'jump', minEnergy: 10, speech: '{user} 跳!' },
    { id: 'k1', eventTypes: ['chat'], matchMode: 'contains', match: ['可愛'], action: 'cheer', energyDelta: 5, speech: '{user} 說 {word}' },
  ]);
  const thresholds = [{ trigger: 'threshold', min: 50, state: 'peek' }];

  test('門檻不足 → costDenied 且值不變', () => {
    const r = processEvent({ eventType: 'chat', category: 'chat', message: '!跳', username: '阿明' }, handlers, 5, thresholds);
    expect(r.costDenied).toBe(true);
    expect(r.yolia_see).toBe(5);
    expect(r.speech).toContain('阿明');
    expect(r.speech).toContain('10');
  });

  test('門檻足夠 → animOnly+resetState+speech 代換 {user}', () => {
    const r = processEvent({ eventType: 'chat', category: 'chat', message: '!跳', username: '阿明' }, handlers, 60, thresholds);
    expect(r.state).toBe('jump');
    expect(r.animOnly).toBe(true);
    expect(r.resetState).toBe('peek');
    expect(r.speech).toBe('阿明 跳!');
  });

  test('prefix 模式:文字不在句首不算', () => {
    const r = processEvent({ eventType: 'chat', category: 'chat', message: '哈囉!跳', username: 'x' }, handlers, 60, []);
    expect(r).toBeNull();
  });

  test('contains 模式:句子任何地方出現都算,{word} 代換命中詞', () => {
    const r = processEvent({ eventType: 'chat', category: 'chat', message: '好可愛喔', username: '小美' }, handlers, 10, []);
    expect(r.yolia_see).toBe(15); // 10+5
    expect(r.state).toBe('cheer');
    expect(r.speech).toBe('小美 說 可愛');
  });

  test('energyDelta 封頂 100 / 下限 0', () => {
    const high = processEvent({ eventType: 'chat', category: 'chat', message: '好可愛', username: 'x' }, handlers, 98, []);
    expect(high.yolia_see).toBe(100);
  });
});

describe('processEvent — 不填 match 的規則(任何該類事件都算,含非 chat 事件)', () => {
  test('donation 分類規則,不比對文字,細類 cheer 命中', () => {
    const handlers = buildEventHandlers([
      { id: 'r1', eventTypes: ['donation'], action: 'cheer', energyDelta: 10 },
    ]);
    const r = processEvent({ eventType: 'cheer', category: 'donation', message: null, username: 'x' }, handlers, 0, []);
    expect(r.state).toBe('cheer');
    expect(r.yolia_see).toBe(10);
  });
  test('細類直接列 eventType 也能命中(不靠 category)', () => {
    const handlers = buildEventHandlers([{ id: 'r1', eventTypes: ['raid'], action: 'watch_excited' }]);
    const r = processEvent({ eventType: 'raid', category: 'system', message: null, username: 'x' }, handlers, 0, []);
    expect(r.state).toBe('watch_excited');
  });
  test('多個 eventTypes(粗略+細類混用),命中其一即可', () => {
    const handlers = buildEventHandlers([{ id: 'r1', eventTypes: ['donation', 'raid'], action: 'cheer' }]);
    expect(processEvent({ eventType: 'raid', category: 'system', message: null, username: 'x' }, handlers, 0, [])).not.toBeNull();
    expect(processEvent({ eventType: 'superchat', category: 'donation', message: null, username: 'x' }, handlers, 0, [])).not.toBeNull();
  });
  test('規則有填 match 但事件沒有文字內容 → 不命中', () => {
    const handlers = buildEventHandlers([{ id: 'r1', eventTypes: ['chat'], match: ['安安'] }]);
    expect(processEvent({ eventType: 'chat', category: 'chat', message: null, username: 'x' }, handlers, 0, [])).toBeNull();
  });
});

describe('processEvent — 沒有 action 的規則(只影響幽視值,不切動畫)', () => {
  test('animOnly false、resetState null、state 為當前門檻計算值', () => {
    const handlers = buildEventHandlers([{ id: 'c_base', eventTypes: ['chat'] }]);
    const thresholds = [{ trigger: 'threshold', min: 40, state: 'peek' }];
    const r = processEvent({ eventType: 'chat', category: 'chat', message: '隨便聊', username: 'x' }, handlers, 42, thresholds);
    expect(r.animOnly).toBe(false);
    expect(r.resetState).toBeNull();
    expect(r.state).toBe('peek');
    expect(r.speech).toBeNull();
  });
});

describe('planMessageEffects(chatMonitorClient.js 用的套用時機決策)', () => {
  test('costDenied:立即顯示提示(不含 animOnly),3 秒後回復(不含 speech)', () => {
    const r = { costDenied: true, resetState: null, animOnly: false, state: 'idle', speech: '幽視值不足' };
    const plan = planMessageEffects(r, 10);
    expect(plan.immediate).toEqual({ value: 10, state: 'idle', speech: '幽視值不足' });
    expect(plan.delayed).toEqual({ delayMs: 3000, patch: { value: 10, state: 'idle' } });
  });

  test('一般事件 + resetState:立即套用,3 秒後回復成 resetState', () => {
    const r = { costDenied: false, resetState: 'idle', animOnly: true, state: 'jump', speech: null };
    const plan = planMessageEffects(r, 20);
    expect(plan.immediate).toEqual({ value: 20, state: 'jump', animOnly: true, speech: null });
    expect(plan.delayed).toEqual({ delayMs: 3000, patch: { value: 20, state: 'idle' } });
  });

  test('一般事件 + resetState 為 null:沒有延遲效果', () => {
    const r = { costDenied: false, resetState: null, animOnly: false, state: 'peek', speech: null };
    const plan = planMessageEffects(r, 30);
    expect(plan.delayed).toBeNull();
  });
});
