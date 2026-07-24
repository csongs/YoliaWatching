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

  // 匯入精靈的 ms 預設(規格 §7):來源 A(spritesheet)fps 8=125、來源 B(逐幀圖,引擎預設)150
  const DEFAULT_MS_SPRITESHEET = 125;
  const DEFAULT_MS_PER_FRAME_FILES = 150;

  // 來源 B(逐幀圖)按檔名自然排序(數字視為數值比較,而非逐字元比較,如 "2.png" < "10.png")
  function compareNatural(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
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

  // 多包同時啟用(2026-07-11 勾選制):把勾選中的包合併成單一動畫集。
  // 順序規約(呼叫端只要照勾選順序傳,排序在這裡統一做):
  //   換角包排最前(packToAnimations 會填滿所有已知狀態,墊底當新基底),
  //   擴充包依勾選順序疊後(後蓋前)——確保擴充動作永遠蓋得到換角包。
  // 壞包(轉換丟例外)跳過並回報,不拖垮其他包。空清單回 animations:null(=只用內建)。
  function mergeActivePacks(packList) {
    const list = (packList ?? []).filter(Boolean);
    const ordered = [...list.filter(p => p.base !== 'builtin'), ...list.filter(p => p.base === 'builtin')];
    let animations = null;
    const errors = [];
    for (const p of ordered) {
      try { animations = { ...(animations ?? {}), ...packToAnimations(p) }; }
      catch (e) { errors.push({ id: p?.id, message: e?.message ?? String(e) }); }
    }
    return { animations, errors };
  }

  // 供 UI 層即時驗證狀態名(與 validatePack 用同一條 STATE_RE,避免規則分岔)
  function isValidStateName(name) {
    return typeof name === 'string' && STATE_RE.test(name);
  }

  // ── 幀編輯器的三個操作(動畫編輯器規格 §3;v1 不做拖拽排序)────────────────────
  // 純函數:吃 srcs 陣列吐新陣列,不動原陣列。ok:false 且無 error=邊界外靜默略過
  // (呼叫端不提示,如移動已在陣列頭/尾);ok:false 且有 error=違反上下限,呼叫端提示。

  function moveFrame(srcs, index, dir) {
    const j = index + dir;
    if (j < 0 || j >= srcs.length) return { ok: false };
    const next = srcs.slice();
    [next[index], next[j]] = [next[j], next[index]];
    return { ok: true, srcs: next, index: j };
  }

  function duplicateFrame(srcs, index) {
    if (srcs.length >= MAX_FRAMES_PER_ANIM) {
      return { ok: false, error: '已達單一動畫 ' + MAX_FRAMES_PER_ANIM + ' 幀上限' };
    }
    const next = srcs.slice();
    next.splice(index + 1, 0, next[index]);   // data URL 字串共享,無額外成本
    return { ok: true, srcs: next, index };
  }

  function deleteFrame(srcs, index) {
    if (srcs.length <= 1) return { ok: false, error: '至少要留一幀' };
    const next = srcs.slice();
    next.splice(index, 1);
    return { ok: true, srcs: next, index: Math.min(index, next.length - 1) };
  }

  // pack id 含「.」(作者.包名),RTDB 路徑/檔案 key 不能有「.」,一律轉底線存取
  function packKeyOf(id) {
    return String(id).replace(/\./g, '_');
  }

  // 讀 activePackIds/activePackId 相容折算(勾選制 2026-07-11 前只有單包欄位 activePackId):
  // 一律回傳陣列;cfg 兩個欄位都沒有就回傳空陣列。呼叫端(main.js/obsServer.js/panel.html
  // 兩個 DataAdapter/index.html 的 config 訂閱)原本各自手刻同一段折算,統一收在這裡。
  function resolveActivePackIds(cfg) {
    const ids = cfg?.activePackIds;
    if (Array.isArray(ids)) return ids.filter((x) => typeof x === 'string' && x);
    return (typeof cfg?.activePackId === 'string' && cfg.activePackId) ? [cfg.activePackId] : [];
  }

  // resolveActivePackIds 的反向:把陣列寫回新+舊兩個相容欄位,供呼叫端存回自己的媒介
  // (RTDB update()/本機 config.json/HTTP 回應——空值該存 null 還是刪 key 由呼叫端決定)。
  function packIdsCompatFields(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && x);
    return { activePackIds: list.length ? list : null, activePackId: list[0] ?? null };
  }

  // 換角包(base !== 'builtin')一次只能啟用一個,擴充包可疊加不限數量(規格 §5)。
  // currentIds=目前已勾選的陣列;packsByKey=id 轉 packKeyOf 後可查到 pack 物件的 map
  // (workshop.js 的 packs、market.js 的 installed 兩個呼叫端各自維護,形狀相同);
  // on=true 時把 id 加入陣列並套用互斥規則,on=false 時只是移除。
  // 回傳新的 ids 陣列,replacedWhole 標記是否因為互斥規則頂掉了先前的換角包(UI 決定要不要提示)。
  function selectPack(currentIds, packsByKey, id, on) {
    const isWhole = (pid) => { const p = packsByKey?.[packKeyOf(pid)]; return !!p && p.base !== 'builtin'; };
    let ids = (currentIds ?? []).filter((x) => x !== id);
    let replacedWhole = false;
    if (on) {
      if (isWhole(id) && ids.some(isWhole)) {
        ids = ids.filter((x) => !isWhole(x));
        replacedWhole = true;
      }
      ids.push(id);
    }
    return { ids, replacedWhole };
  }

  // ── 市集 index 格式相容(ADR-005;呼叫端 market.js 只留 fetch/DOM,規則收在這裡)────────

  // 使用者貼的市集位址→候選 index.json URL(不發請求,呼叫端依序嘗試):
  //   1. 已經是 .../index.json(可帶查詢字串,如 RTDB emulator 的 ?ns=)→ 原樣使用
  //   2. 其他網址 → 補 /index.json(查詢字串原樣保留,不遺失 ?ns=)
  // normalizedInput 供呼叫端在猜測失敗時取 origin,做第 3 步(firebase-config.js)探測用。
  function guessIndexUrl(input) {
    let u = String(input).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    if (/\/index\.json(\?|$)/.test(u)) return { url: u, isLiteral: true, normalizedInput: u };
    const qi = u.indexOf('?');
    const url = qi === -1 ? u + '/index.json'
      : u.slice(0, qi).replace(/\/+$/, '') + '/index.json' + u.slice(qi);
    return { url, isLiteral: false, normalizedInput: u };
  }

  // 貼的是平台網站網址(而非 Registry URL 本身)時,從該站部署的 firebase-config.js
  // 原始碼挖 databaseURL,組出對應資料庫的 index.json 位址;挖不到回 null。
  function extractIndexUrlFromFirebaseConfig(text) {
    const m = String(text ?? '').match(/databaseURL:\s*["']([^"']+)["']/);
    return m ? m[1].replace(/\/+$/, '') + '/index.json' : null;
  }

  // 兩種 index 格式都收(ADR-005):
  //   陣列 = GitHub registry(每項自帶 packUrl)
  //   物件 = 中央平台 RTDB REST 的 /index.json(key→條目;packUrl 由 registry 根組出
  //          `<根>/packs/<key>.json`,即平台 /packs 節點的 REST 端點)
  // 查詢字串要原樣帶到 packUrl——RTDB emulator 靠 ?ns=<namespace> 選資料庫,丟掉就 404
  function normalizeIndex(data, url) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    const m = String(url).match(/^(.*?)\/index\.json(\?.*)?$/);
    const base = m ? m[1] : String(url).replace(/\/index\.json.*$/, '');
    const qs = (m && m[2]) || '';
    return Object.entries(data).map(([key, it]) => ({
      ...it,
      packUrl: it.packUrl ?? (base + '/packs/' + key + '.json' + qs),
    }));
  }

  // semver 欄位比較(市集更新判斷用):回傳 <0 / 0 / >0;缺段補 0,非數字段當 0
  function compareVersions(a, b) {
    const parse = (v) => String(v ?? '').split('.').map(n => parseInt(n, 10) || 0);
    const pa = parse(a), pb = parse(b);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  }

  return {
    validatePack, packToAnimations, sliceGeometry, defaultLoop, applyDefaultInteractions,
    buildAnimationsUpdate, mergeActivePacks, isValidStateName, compareVersions, KNOWN_STATES,
    packKeyOf, resolveActivePackIds, packIdsCompatFields, selectPack,
    guessIndexUrl, extractIndexUrlFromFirebaseConfig, normalizeIndex,
    moveFrame, duplicateFrame, deleteFrame, MAX_FRAMES_PER_ANIM,
    DEFAULT_MS_SPRITESHEET, DEFAULT_MS_PER_FRAME_FILES, compareNatural,
  };
});
