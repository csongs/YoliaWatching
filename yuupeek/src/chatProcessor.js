(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ChatProcessor = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // 舊格式(trigger:'keyword'/'command', match, animation, yolia_see, cost, response)
  // 轉成新格式(eventTypes, matchMode, match, minEnergy, energyDelta, speech, action)——
  // 2026-08-16 收斂:互動規則改成事件類型導向(對齊 chat-monitor 的 event_type/category
  // 詞彙),不再限定只有聊天文字能觸發。已經是新格式(有 eventTypes)的規則原樣放行,
  // 讓舊的 config.json(使用者本機可能還沒存過新格式)讀進來時自動正規化,不用手動遷移。
  function normalizeInteraction(rule) {
    if (rule.eventTypes) return rule;
    if (rule.trigger === 'keyword' || rule.trigger === 'command') {
      return {
        id: rule.id,
        eventTypes: ['chat'],
        matchMode: rule.trigger === 'keyword' ? 'contains' : 'prefix',
        match: rule.match,
        minEnergy: rule.cost ?? null,
        energyDelta: rule.yolia_see ?? null,
        speech: rule.response ?? null,
        action: rule.animation ?? null,
      };
    }
    return rule; // threshold 等其他型態,呼叫端(chatMonitorClient.js)自己先濾掉,不會走到這裡
  }

  // 門檻(threshold)規則不算在這裡面——面板目前不開放編輯,呼叫端另外用
  // (interactions ?? []).filter(i => i.trigger === 'threshold') 抽出來餵給 computeState。
  function buildEventHandlers(interactions) {
    const rules = (interactions ?? [])
      .filter((i) => i.trigger !== 'threshold')
      .map(normalizeInteraction);
    return { rules };
  }

  function computeState(yolia_see, thresholds) {
    const sorted = [...(thresholds ?? [])].sort((a, b) => b.min - a.min);
    for (const s of sorted) {
      if (yolia_see >= s.min) return s.state;
    }
    return 'idle';
  }

  // 一條規則要不要吃某個事件:eventTypes 可以混「粗略分類」(chat/donation/system)跟
  // 「細類」(cheer/superchat/raid...),對到 evt.eventType 或 evt.category 任一個就算;
  // 沒填 match 的規則代表「這個類型的事件一發生就算觸發」(例如捐款類事件通常沒有要比對
  // 的文字);match 比對只吃得到 evt.message,沒有文字內容(null/空字串)的事件一律不會被
  // 「有填 match」的規則命中。回傳命中的 word 給 {word} 佔位符用,沒有文字比對就回 null。
  function matchRule(evt, rule) {
    const types = rule.eventTypes ?? ['chat'];
    if (!types.includes(evt.eventType) && !types.includes(evt.category)) return null;
    const matchList = rule.match == null ? [] : (Array.isArray(rule.match) ? rule.match : [rule.match]);
    if (!matchList.length) return { word: null };
    const text = (evt.message ?? '').trim();
    if (!text) return null;
    if (rule.matchMode === 'prefix') {
      const word = text.split(' ')[0];
      return matchList.includes(word) ? { word } : null;
    }
    const word = matchList.find((w) => text.includes(w));
    return word ? { word } : null;
  }

  // 依規則清單順序找第一個命中的(陣列順序=優先權;越前面的越先檢查,方便把「特定觸發」
  // 排在「不填 match 的通用規則」前面)。找不到就回 null,呼叫端什麼都不做。
  function findMatchingRule(evt, rules) {
    for (const rule of rules) {
      const hit = matchRule(evt, rule);
      if (hit) return { rule, word: hit.word };
    }
    return null;
  }

  // Pure: evt = { eventType, category, message, username }。
  // 回傳 { yolia_see, state, animOnly, speech, costDenied, resetState } 或 null(沒有規則命中,
  // 呼叫端不用做任何事——這是跟舊版 processMessage 最大的差異:舊版任何聊天訊息都至少
  // +1,新版完全交給規則決定,連「每則訊息 +1」都要靠一條 match 留空的 eventTypes:['chat']
  // 規則自己設定,見 default.config.json)。
  function processEvent(evt, handlers, yolia_see, thresholds) {
    const found = findMatchingRule(evt, handlers.rules);
    if (!found) return null;
    const { rule, word } = found;
    const username = evt.username ?? '';

    if (rule.minEnergy != null && yolia_see < rule.minEnergy) {
      return {
        yolia_see, costDenied: true, resetState: null, animOnly: false,
        state:  computeState(yolia_see, thresholds),
        speech: `${username} 幽視值不足，需要 ${rule.minEnergy}！`,
      };
    }

    if (rule.energyDelta) yolia_see = Math.max(0, Math.min(100, yolia_see + rule.energyDelta));
    const computed = computeState(yolia_see, thresholds);
    const speech = rule.speech
      ? rule.speech.replace('{user}', username).replace('{word}', word ?? '')
      : null;

    return {
      yolia_see, costDenied: false, animOnly: !!rule.action,
      state:      rule.action ?? computed,
      speech,
      resetState: rule.action ? computed : null,
    };
  }

  // 純函數:規劃 processEvent 結果「何時套用什麼」,呼叫端(chatMonitorClient.js)只負責
  // 把 patch 餵給 broadcast,不必自己重刻這段時序決策。
  // costDenied:立即顯示提示,3 秒後回復原狀(不含 speech)。
  // 一般事件:立即套用;若 resetState 不為 null(播完要回的狀態),3 秒後回復成該狀態。
  function planMessageEffects(r, yolia_see) {
    if (r.costDenied) {
      return {
        immediate: { value: yolia_see, state: r.state, speech: r.speech },
        delayed:   { delayMs: 3000, patch: { value: yolia_see, state: r.state } },
      };
    }
    return {
      immediate: { value: yolia_see, state: r.state, animOnly: r.animOnly, speech: r.speech },
      delayed: r.resetState !== null
        ? { delayMs: 3000, patch: { value: yolia_see, state: r.resetState } }
        : null,
    };
  }

  return { normalizeInteraction, buildEventHandlers, computeState, processEvent, planMessageEffects };
});
