(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ChatProcessor = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function buildHandlers(interactions) {
    const commandMap = {};
    for (const i of (interactions ?? []).filter(i => i.trigger === 'command')) {
      const keys = Array.isArray(i.match) ? i.match : (i.match ? [i.match] : []);
      for (const k of keys) commandMap[k] = i;
    }
    const kwInteractions = (interactions ?? []).filter(i => i.trigger === 'keyword');
    let keywordRe = null;
    if (kwInteractions.length) {
      const words   = kwInteractions.flatMap(i => Array.isArray(i.match) ? i.match : [i.match]);
      const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      keywordRe = new RegExp(escaped.join('|'));
    }
    return { commandMap, kwInteractions, keywordRe };
  }

  function computeState(yolia_see, thresholds) {
    const sorted = [...(thresholds ?? [])].sort((a, b) => b.min - a.min);
    for (const s of sorted) {
      if (yolia_see >= s.min) return s.state;
    }
    return 'idle';
  }

  // Pure: returns { yolia_see, state, animOnly, speech, costDenied, resetState }
  // resetState: state to restore after animation (null = no reset needed)
  function processMessage(text, username, handlers, yolia_see, thresholds) {
    const { commandMap, kwInteractions, keywordRe } = handlers;
    const trimmed = text.trim();
    const word    = trimmed.split(' ')[0];
    const cmd     = commandMap[word];

    if (cmd) {
      if (cmd.cost !== undefined && yolia_see < cmd.cost) {
        return {
          yolia_see, costDenied: true, resetState: null, animOnly: false,
          state:  computeState(yolia_see, thresholds),
          speech: `${username} 幽視值不足，需要 ${cmd.cost}！`,
        };
      }
      if (cmd.cost      !== undefined) yolia_see = Math.max(0, yolia_see - cmd.cost);
      if (cmd.yolia_see !== undefined) yolia_see = Math.max(0, Math.min(100, yolia_see + cmd.yolia_see));
      const computed = computeState(yolia_see, thresholds);
      return {
        yolia_see, costDenied: false, animOnly: !!cmd.animation,
        state:      cmd.animation ?? computed,
        speech:     cmd.response ? cmd.response.replace('{user}', username) : `${username}: ${word}`,
        resetState: cmd.animation ? computed : null,
      };
    }

    yolia_see = Math.min(100, yolia_see + 1);
    const computed = computeState(yolia_see, thresholds);
    const matched  = keywordRe ? trimmed.match(keywordRe)?.[0] : null;

    if (matched) {
      const kw = kwInteractions.find(i => (Array.isArray(i.match) ? i.match : [i.match]).includes(matched));
      if (kw?.yolia_see) yolia_see = Math.max(0, Math.min(100, yolia_see + kw.yolia_see));
      const speech = (kw?.response ?? '')
        .replace('{user}', username)
        .replace('{word}', matched)
        || `${username} ${matched}`;
      return { yolia_see, state: kw?.animation ?? 'wave', animOnly: true, speech, costDenied: false, resetState: null };
    }

    return { yolia_see, state: computed, animOnly: false, speech: null, costDenied: false, resetState: null };
  }

  return { buildHandlers, computeState, processMessage };
});
