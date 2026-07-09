// Character Pack v1 格式邏輯(規格:docs/specs/character-pack-format.md)。
// isomorphic UMD:panel/overlay 以 <script src> 載入(global PackFormat),測試以 require 載入。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PackFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const MAX_PACK_BYTES      = 4 * 1024 * 1024;
  const MAX_FRAMES_PER_ANIM = 32;
  const MAX_ANIMATIONS      = 32;

  const ID_RE    = /^[a-z0-9-]+\.[a-z0-9-]+$/;
  const STATE_RE = /^[a-z][a-z0-9_]*$/;

  // 引擎與預設設定會主動用到的狀態(規格 §5;新增預設互動時記得回來更新)
  const KNOWN_STATES = [
    'idle', 'peek', 'cheer', 'cry', 'eat', 'jump', 'wave',
    'run_left', 'run_right', 'watch_excited',
  ];

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

  // 規格 §8。回傳 { ok, errors },errors 為繁中人話,直接可顯示於 UI。
  function validatePack(pack) {
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
      return { ok: false, errors: ['角色包不是有效的 JSON 物件'] };
    }
    const errors = [];

    if (pack.yoliaPack !== 1) errors.push('此角色包需要新版本的 YoliaWatching(yoliaPack 版本不符)');
    if (!isNonEmptyString(pack.id) || !ID_RE.test(pack.id)) {
      errors.push('id 格式錯誤(需為「作者.包名」,全小寫英數與連字號)');
    }
    for (const f of ['name', 'version', 'author', 'license']) {
      if (!isNonEmptyString(pack[f])) errors.push(f + ' 為必填欄位');
    }
    if (pack.license === 'custom' && !isNonEmptyString(pack.licenseText)) {
      errors.push('license 為 custom 時必須填 licenseText');
    }
    if (pack.base !== undefined && pack.base !== 'builtin') {
      errors.push('此角色包需要新版本的 YoliaWatching(不認識的 base 值)');
    }

    const anims = pack.animations;
    if (!anims || typeof anims !== 'object' || Array.isArray(anims) || !Object.keys(anims).length) {
      errors.push('animations 至少要有一個動畫');
    } else {
      if (pack.base === undefined && !anims.idle) errors.push('角色包必須包含 idle 動畫');
      const names = Object.keys(anims);
      if (names.length > MAX_ANIMATIONS) errors.push('動畫總數 ' + names.length + ' 超過上限 ' + MAX_ANIMATIONS);
      for (const name of names) {
        if (!STATE_RE.test(name)) errors.push('動畫名稱「' + name + '」不合法(小寫英文開頭,限小寫英數與底線)');
        const a = anims[name] ?? {};
        if (!Array.isArray(a.srcs) || !a.srcs.length) { errors.push('動畫「' + name + '」缺少幀圖(srcs)'); continue; }
        if (a.srcs.length > MAX_FRAMES_PER_ANIM) errors.push('動畫「' + name + '」有 ' + a.srcs.length + ' 幀,超過上限 ' + MAX_FRAMES_PER_ANIM);
        if (!a.srcs.every(s => typeof s === 'string' && (s.startsWith('data:image/') || s.startsWith('https://')))) {
          errors.push('動畫「' + name + '」的幀圖必須是 data:image/ 或 https:// 開頭');
        }
        if (a.srcs.some(s => typeof s === 'string' && /[\s"'<>\\]/.test(s))) {
          errors.push('動畫「' + name + '」的幀圖網址含空白或引號等非法字元');
        }
        if (a.ms !== undefined && !(typeof a.ms === 'number' && a.ms >= 1 && a.ms <= 10000)) {
          errors.push('動畫「' + name + '」的 ms 必須是 1–10000 的數字');
        }
        if (a.loop !== undefined && typeof a.loop !== 'boolean') errors.push('動畫「' + name + '」的 loop 必須是布林值');
      }
    }

    if (pack.defaultInteractions !== undefined) {
      if (!Array.isArray(pack.defaultInteractions)) {
        errors.push('defaultInteractions 必須是陣列');
      } else {
        pack.defaultInteractions.forEach((it, i) => {
          if (!it || !['threshold', 'keyword', 'command'].includes(it.trigger)) {
            errors.push('defaultInteractions 第 ' + (i + 1) + ' 項的 trigger 不合法');
          }
          if (it && it.id !== undefined) errors.push('defaultInteractions 第 ' + (i + 1) + ' 項不可含 id(匯入時自動生成)');
        });
      }
    }

    try {
      // 以 UTF-8 位元組計(TextEncoder 為 Node≥11 與所有現代瀏覽器的全域)
      if (new TextEncoder().encode(JSON.stringify(pack)).length > MAX_PACK_BYTES) {
        errors.push('角色包超過上限 4 MB,請減少幀數或縮小圖片');
      }
    } catch (e) {
      errors.push('角色包無法序列化為 JSON');
    }

    return { ok: !errors.length, errors };
  }

  // 規格 §5:擴充包(base:"builtin")原樣輸出(overlay 疊在內建之上);
  // 換角包=引擎已知狀態缺漏一律映射到包的 idle(不混搭內建圖)。
  function packToAnimations(pack) {
    const out = {};
    for (const [name, a] of Object.entries(pack.animations ?? {})) {
      out[name] = { srcs: a.srcs, ms: a.ms, loop: !!a.loop };
    }
    if (pack.base === 'builtin') return out;
    for (const s of KNOWN_STATES) {
      if (!out[s]) out[s] = { srcs: out.idle.srcs, ms: out.idle.ms, loop: out.idle.loop };
    }
    return out;
  }

  // 規格 §7 步驟 1–3 的純幾何部分(canvas 切圖在 UI 層,規格 §9)
  function sliceGeometry(imageWidth, imageHeight, frameWidth) {
    const frameW = frameWidth ?? imageHeight;
    if (!Number.isInteger(frameW) || frameW <= 0) return { ok: false, error: '幀寬必須是正整數' };
    if (imageWidth % frameW !== 0) {
      return { ok: false, error: '圖寬 ' + imageWidth + ' 不能被幀寬 ' + frameW + ' 整除,請確認幀寬' };
    }
    const count = imageWidth / frameW;
    return {
      ok: true, frameW, count,
      rects: Array.from({ length: count }, (_, i) => ({ x: i * frameW, y: 0, w: frameW, h: imageHeight })),
    };
  }

  // 規格 §7:loop 依名稱慣例給預設,編輯器一律可改
  function defaultLoop(name) {
    return name === 'idle' || name.startsWith('run_') || name.startsWith('walk');
  }

  // 規格 §2 defaultInteractions:同 match 已存在則跳過並回報;id 由呼叫端 generateId 現生成
  function applyDefaultInteractions(packInteractions, existing, generateId) {
    const existingMatches = new Set();
    for (const it of existing ?? []) {
      const m = Array.isArray(it.match) ? it.match : (it.match ? [it.match] : []);
      m.forEach(x => existingMatches.add(x));
    }
    const merged = [...(existing ?? [])];
    const added = [], skipped = [];
    for (const it of packInteractions ?? []) {
      const m = Array.isArray(it.match) ? it.match : (it.match ? [it.match] : []);
      if (m.some(x => existingMatches.has(x))) { skipped.push(it); continue; }
      const withId = { ...it, id: generateId(it.trigger) };
      merged.push(withId);
      added.push(withId);
      m.forEach(x => existingMatches.add(x));
    }
    return { merged, added, skipped };
  }

  // ADR-004:桌面版(或任何呼叫端)的動畫合併與殘留清除。
  // snapshot=無 null 的目前有效集合(給快照類讀取);broadcast=snapshot 加上
  // 「上一包引入、新集合蓋不掉」的鍵設 null(給引擎 setAnimations 做刪除)。
  function buildAnimationsUpdate(base, packAnims, prevPackStates) {
    const snapshot = { ...base, ...(packAnims ?? {}) };
    const packStates = packAnims ? Object.keys(packAnims) : [];
    const broadcast = { ...snapshot };
    for (const s of prevPackStates ?? []) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, s)) broadcast[s] = null;
    }
    return { snapshot, broadcast, packStates };
  }

  // 供 UI 層即時驗證狀態名(與 validatePack 用同一條 STATE_RE,避免規則分岔)
  function isValidStateName(name) {
    return typeof name === 'string' && STATE_RE.test(name);
  }

  return { validatePack, packToAnimations, sliceGeometry, defaultLoop, applyDefaultInteractions, buildAnimationsUpdate, isValidStateName, KNOWN_STATES };
});
