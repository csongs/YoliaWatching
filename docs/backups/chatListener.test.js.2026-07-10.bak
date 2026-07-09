const { applyCommand, buildGreetRe } = require('../chatListener');

const commands = {
  '!加油': { state: 'cheer', yolia_see: 10  },
  '!哭':   { state: 'cry',   yolia_see: -15 },
  '!跳':   { state: 'jump'                  },
};

function makeSm(yolia_see = 50) {
  return {
    yolia_see,
    state: 'idle',
    computeState() {
      if (this.yolia_see >= 80) return 'cheer';
      if (this.yolia_see >= 40) return 'peek';
      return 'idle';
    },
  };
}

// ── non-command messages ───────────────────────────────────────────────────────

describe('non-command messages', () => {
  test('increments yolia_see by 1', () => {
    const sm = makeSm(50);
    applyCommand(sm, commands, jest.fn(), 'hello');
    expect(sm.yolia_see).toBe(51);
  });

  test('broadcasts computed state (no animOnly)', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, 'hello');
    expect(broadcast).toHaveBeenCalledWith({ value: 51, state: 'peek' });
  });

  test('clamps yolia_see at 100', () => {
    const sm = makeSm(100);
    applyCommand(sm, commands, jest.fn(), 'hello');
    expect(sm.yolia_see).toBe(100);
  });
});

// ── commands with state ────────────────────────────────────────────────────────

describe('commands with state', () => {
  test('broadcasts animOnly:true', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, '!加油');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ animOnly: true }));
  });

  test('broadcast state is the command state, not computeState', () => {
    const sm = makeSm(50); // computeState → peek
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, '!加油');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ state: 'cheer' }));
  });

  test('sm.state reverts to computeState() immediately after broadcast', () => {
    const sm = makeSm(50); // peek range
    applyCommand(sm, commands, jest.fn(), '!加油');
    expect(sm.state).toBe('peek');
  });

  test('includes speech with username', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, '!加油', 'Twitch', 'viewer123');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ speech: 'viewer123: !加油' }));
  });

  test('includes speech without username', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, '!加油');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ speech: '!加油' }));
  });

  test('applies yolia_see delta', () => {
    const sm = makeSm(50);
    applyCommand(sm, commands, jest.fn(), '!加油');
    expect(sm.yolia_see).toBe(60);
  });

  test('clamps yolia_see at 100', () => {
    const sm = makeSm(95);
    applyCommand(sm, commands, jest.fn(), '!加油');
    expect(sm.yolia_see).toBe(100);
  });

  test('clamps yolia_see at 0', () => {
    const sm = makeSm(5);
    applyCommand(sm, commands, jest.fn(), '!哭');
    expect(sm.yolia_see).toBe(0);
  });

  test('command without yolia_see delta does not change value', () => {
    const sm = makeSm(50);
    applyCommand(sm, commands, jest.fn(), '!跳');
    expect(sm.yolia_see).toBe(50);
  });
});

// ── greeting detection ────────────────────────────────────────────────────────

const greetRe = buildGreetRe(['安安', '午安', '早安', '晚安']);

describe('greeting messages', () => {
  test.each(['安安', '早安', '午安', '晚安'])('%s triggers wave animOnly broadcast', (greeting) => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, greeting, 'Twitch', 'viewer', greetRe);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ state: 'wave', animOnly: true }));
  });

  test('speech uses greetResponse template: {user} {word}', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, '安安~', 'Twitch', 'viewer123', greetRe, '{user} {word}');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ speech: 'viewer123 安安' }));
  });

  test('custom greetResponse template', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, '早安你好', 'Twitch', 'alice', greetRe, '{user}！{word}～');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ speech: 'alice！早安～' }));
  });

  test('speech without username shows only matched word', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, '安安大家', 'Chat', '', greetRe, '{user} {word}');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ speech: '安安' }));
  });

  test('greeting still increments yolia_see', () => {
    const sm = makeSm(50);
    applyCommand(sm, commands, jest.fn(), '安安', 'Chat', '', greetRe);
    expect(sm.yolia_see).toBe(51);
  });

  test('non-greeting chat does not trigger wave', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, 'hello', 'Chat', '', greetRe);
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'wave' }));
  });

  test('greetings disabled when greetRe is null', () => {
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, '安安', 'Chat', 'viewer', null);
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'wave' }));
  });

  test('custom greetings list', () => {
    const custom = buildGreetRe(['hello', 'hi']);
    const sm = makeSm(50);
    const broadcast = jest.fn();
    applyCommand(sm, commands, broadcast, 'hello world', 'Chat', 'viewer', custom);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ state: 'wave', animOnly: true }));
  });
});

// ── text matching ──────────────────────────────────────────────────────────────

describe('text matching', () => {
  test('only first word matched (ignores trailing text)', () => {
    const sm = makeSm(50);
    applyCommand(sm, commands, jest.fn(), '!加油 一起加油！');
    expect(sm.yolia_see).toBe(60);
  });

  test('leading/trailing whitespace trimmed', () => {
    const sm = makeSm(50);
    applyCommand(sm, commands, jest.fn(), '  !加油  ');
    expect(sm.yolia_see).toBe(60);
  });

  test('unknown command treated as non-command chat (+1)', () => {
    const sm = makeSm(50);
    applyCommand(sm, commands, jest.fn(), '!unknown');
    expect(sm.yolia_see).toBe(51);
  });
});
