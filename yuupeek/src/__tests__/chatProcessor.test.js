const { buildHandlers, computeState, processMessage } = require('../chatProcessor');

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

describe('buildHandlers', () => {
  test('command match 字串與陣列都進 commandMap', () => {
    const h = buildHandlers([
      { trigger: 'command', match: '!a', animation: 'jump' },
      { trigger: 'command', match: ['!b', '!c'], animation: 'cry' },
    ]);
    expect(Object.keys(h.commandMap).sort()).toEqual(['!a', '!b', '!c']);
  });
  test('keyword regex 跳脫特殊字元', () => {
    const h = buildHandlers([{ trigger: 'keyword', match: 'a.b(c)' }]);
    expect(h.keywordRe.test('xa.b(c)x')).toBe(true);
    expect(h.keywordRe.test('aXb(c)')).toBe(false);
  });
  test('未知 trigger 靜默忽略(格式演進規則)', () => {
    const h = buildHandlers([{ trigger: 'future_thing', match: 'x' }]);
    expect(h.commandMap).toEqual({});
    expect(h.keywordRe).toBeNull();
  });
});

describe('processMessage — command', () => {
  const thresholds = [{ trigger: 'threshold', min: 50, state: 'peek' }];
  const handlers = buildHandlers([
    { trigger: 'command', match: '!跳', animation: 'jump', cost: 10, response: '{user} 跳!' },
    { trigger: 'command', match: '!加', yolia_see: 200 },
  ]);

  test('cost 不足 → costDenied 且值不變', () => {
    const r = processMessage('!跳', '阿明', handlers, 5, thresholds);
    expect(r.costDenied).toBe(true);
    expect(r.yolia_see).toBe(5);
    expect(r.speech).toContain('阿明');
    expect(r.speech).toContain('10');
  });

  test('cost 扣除+animation → animOnly+resetState', () => {
    const r = processMessage('!跳', '阿明', handlers, 60, thresholds);
    expect(r.yolia_see).toBe(50);
    expect(r.state).toBe('jump');
    expect(r.animOnly).toBe(true);
    expect(r.resetState).toBe('peek');
    expect(r.speech).toBe('阿明 跳!');
  });

  test('yolia_see 增加封頂 100', () => {
    const r = processMessage('!加', 'x', handlers, 90, thresholds);
    expect(r.yolia_see).toBe(100);
  });
});

describe('processMessage — keyword 與一般訊息', () => {
  const handlers = buildHandlers([
    { trigger: 'keyword', match: ['可愛'], animation: 'cheer', yolia_see: 5, response: '{user} 說 {word}' },
    { trigger: 'keyword', match: '安安' },
  ]);

  test('關鍵詞:先 +1 再疊 yolia_see,{user}/{word} 替換', () => {
    const r = processMessage('好可愛喔', '小美', handlers, 10, []);
    expect(r.yolia_see).toBe(16); // 10+1+5
    expect(r.state).toBe('cheer');
    expect(r.animOnly).toBe(true);
    expect(r.speech).toBe('小美 說 可愛');
  });

  test('關鍵詞未指定 animation → wave', () => {
    const r = processMessage('安安', 'x', handlers, 0, []);
    expect(r.state).toBe('wave');
  });

  test('一般訊息:+1、封頂 100、speech null', () => {
    expect(processMessage('隨便聊', 'x', handlers, 100, []).yolia_see).toBe(100);
    const r = processMessage('隨便聊', 'x', handlers, 42, []);
    expect(r.yolia_see).toBe(43);
    expect(r.speech).toBeNull();
    expect(r.animOnly).toBe(false);
  });
});
