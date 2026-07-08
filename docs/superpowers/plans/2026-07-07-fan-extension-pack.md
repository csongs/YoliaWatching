# 角色工坊 Phase 1 + 擴充包 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實況主能在 panel 匯入粉絲提供的 spritesheet(如 `yuupeek/assets/sprites/sample/00_hurt_sheet.png`),存成角色包(含 `base:"builtin"` 擴充包)到 RTDB `/packs`,overlay 即時套用。

**Architecture:** 格式邏輯集中在新 isomorphic 模組 `packFormat.js`(UMD,仿 chatProcessor.js);panel 的 DOM 接線放新檔 `workshop.js`(僅雲端版載入);引擎只加 `srcs` 直通路徑;overlay 在 config 訂閱內處理 `activePackId`,以 `once` 讀 `/packs`。規格=docs/specs/character-pack-format.md(2026-07-07 修訂版),設計=docs/designs/fan-extension-pack.md + docs/designs/animation-editor.md,決策=ADR-003。

**Tech Stack:** 原生 JS(無框架)、Firebase RTDB(compat SDK 10.12.0)、jest@30(測試在 `yuupeek/src/__tests__/`)。

## Global Constraints

- **絕不 `git push`**——push main 會真部署到維護者的 Firebase(PLAYBOOK §6)。
- **commit 政策**:僅在維護者已授權「本機 commit」時執行各任務的 Commit 步驟;未授權則跳過 Commit 步驟,改在最終回報列出建議 commit 切分。
- **不准直接改 `web/public/` 下的 character.js / chatProcessor.js / panel.html / assets/**——它們是 sync.js 產物(源頭在 `yuupeek/`)。`web/public/index.html` 是雲端專屬檔,可直接改。
- 格式演進規則(PLAYBOOK §3):既有欄位不改;新欄位一律 optional+讀取端容錯;新頂層節點同次改 rules;舊程式讀新資料必須靜默忽略。
- 測試基線:`cd yuupeek && npm test` 中 `chatListener.test.js` 整個 suite 載入失敗是**已知基線**,其餘 4 suite(22 tests)必須全綠,不得新增紅字。
- 改了共用檔(character.js / panel.html)→ 跑 `cd yuupeek && npm run test-ui` 開 http://localhost:3001 確認角色會動(該沙盒必有兩種已知紅字:WS 3001 重連、pet-config 404,不算失敗)。
- packFormat.js 與 character.js 內**禁止出現「spritecook」等外部工具字樣**(規格 §10)。
- UI 錯誤訊息一律繁中人話;RTDB 寫入失敗顯示 Firebase 錯誤原文。

---

### Task 1: packFormat.js 骨架 + validatePack

**Files:**
- Create: `yuupeek/src/packFormat.js`
- Test: `yuupeek/src/__tests__/packFormat.test.js`

**Interfaces:**
- Produces: UMD 模組 `PackFormat`(browser global)/ `module.exports`(node),本任務輸出
  `validatePack(pack) → { ok: boolean, errors: string[] }` 與常數 `KNOWN_STATES: string[]`。
  後續任務會往同一 factory return 物件加函數。

- [ ] **Step 1: 寫失敗測試**

建立 `yuupeek/src/__tests__/packFormat.test.js`:

```js
const { validatePack } = require('../packFormat');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function extPack(overrides = {}) {
  return {
    yoliaPack: 1,
    id: 'fans.yolia-extras',
    name: '粉絲動作集',
    version: '1.0.0',
    author: 'fan',
    license: 'CC-BY-4.0',
    base: 'builtin',
    animations: { hurt: { srcs: [PNG, PNG], ms: 125, loop: false } },
    ...overrides,
  };
}

function fullPack(overrides = {}) {
  const p = extPack(overrides);
  delete p.base;
  if (!overrides.animations) p.animations = { idle: { srcs: [PNG], ms: 150, loop: true } };
  return p;
}

describe('validatePack', () => {
  test('擴充包(base:builtin)不含 idle 也通過', () => {
    expect(validatePack(extPack())).toEqual({ ok: true, errors: [] });
  });

  test('換角包(無 base)必含 idle', () => {
    const r = validatePack(fullPack({ animations: { hurt: { srcs: [PNG] } } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/idle/);
  });

  test('換角包含 idle 通過', () => {
    expect(validatePack(fullPack()).ok).toBe(true);
  });

  test('base 是不認識的值 → 拒絕並提示升級', () => {
    const r = validatePack(extPack({ base: 'v2' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/新版本/);
  });

  test('yoliaPack 版本 >1 → 拒絕並提示升級', () => {
    const r = validatePack(extPack({ yoliaPack: 2 }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/新版本/);
  });

  test('id 不合 作者.包名 格式 → 錯誤', () => {
    expect(validatePack(extPack({ id: 'NoDots' })).ok).toBe(false);
    expect(validatePack(extPack({ id: 'Upper.Case' })).ok).toBe(false);
  });

  test('必填字串欄位缺一即錯', () => {
    for (const f of ['name', 'version', 'author', 'license']) {
      expect(validatePack(extPack({ [f]: '' })).ok).toBe(false);
    }
  });

  test('license=custom 時 licenseText 必填', () => {
    expect(validatePack(extPack({ license: 'custom' })).ok).toBe(false);
    expect(validatePack(extPack({ license: 'custom', licenseText: '僅限本頻道' })).ok).toBe(true);
  });

  test('srcs 空陣列或非 data/https 開頭 → 錯誤', () => {
    expect(validatePack(extPack({ animations: { hurt: { srcs: [] } } })).ok).toBe(false);
    expect(validatePack(extPack({ animations: { hurt: { srcs: ['http://x/y.png'] } } })).ok).toBe(false);
    expect(validatePack(extPack({ animations: { hurt: { srcs: ['https://x/y.png'] } } })).ok).toBe(true);
  });

  test('ms 超界或 loop 非布林 → 錯誤', () => {
    expect(validatePack(extPack({ animations: { hurt: { srcs: [PNG], ms: 0 } } })).ok).toBe(false);
    expect(validatePack(extPack({ animations: { hurt: { srcs: [PNG], ms: 20000 } } })).ok).toBe(false);
    expect(validatePack(extPack({ animations: { hurt: { srcs: [PNG], loop: 'yes' } } })).ok).toBe(false);
  });

  test('狀態名不合 ^[a-z][a-z0-9_]*$ → 錯誤', () => {
    expect(validatePack(extPack({ animations: { 'Bad-Name': { srcs: [PNG] } } })).ok).toBe(false);
  });

  test('動畫總數 >32 → 錯誤', () => {
    const anims = {};
    for (let i = 0; i < 33; i++) anims['a' + i] = { srcs: [PNG] };
    expect(validatePack(extPack({ animations: anims })).ok).toBe(false);
  });

  test('單一動畫 >32 幀 → 錯誤', () => {
    expect(validatePack(extPack({ animations: { hurt: { srcs: Array(33).fill(PNG) } } })).ok).toBe(false);
  });

  test('defaultInteractions 含 id → 錯誤;合法項通過', () => {
    const it = { trigger: 'command', match: ['!痛'], animation: 'hurt', yolia_see: 0, response: '好痛!' };
    expect(validatePack(extPack({ defaultInteractions: [it] })).ok).toBe(true);
    expect(validatePack(extPack({ defaultInteractions: [{ ...it, id: 'c_abcd' }] })).ok).toBe(false);
    expect(validatePack(extPack({ defaultInteractions: [{ trigger: 'weird' }] })).ok).toBe(false);
  });

  test('未知欄位忽略不報錯(向前相容)', () => {
    expect(validatePack(extPack({ meta: { x: 1 }, futureField: true })).ok).toBe(true);
  });

  test('非物件輸入不炸', () => {
    expect(validatePack(null).ok).toBe(false);
    expect(validatePack('{}').ok).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd yuupeek && npx jest src/__tests__/packFormat.test.js`
Expected: FAIL — `Cannot find module '../packFormat'`

- [ ] **Step 3: 最小實作**

建立 `yuupeek/src/packFormat.js`:

```js
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
      if (JSON.stringify(pack).length > MAX_PACK_BYTES) {
        errors.push('角色包超過上限 4 MB,請減少幀數或縮小圖片');
      }
    } catch (e) {
      errors.push('角色包無法序列化為 JSON');
    }

    return { ok: !errors.length, errors };
  }

  return { validatePack, KNOWN_STATES };
});
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd yuupeek && npx jest src/__tests__/packFormat.test.js`
Expected: PASS(全部 validatePack 案例綠)

- [ ] **Step 5: Commit(若已授權)**

```bash
git add yuupeek/src/packFormat.js yuupeek/src/__tests__/packFormat.test.js
git commit -m "feat: packFormat.js validatePack(角色包驗證,含 base:builtin 擴充包規則)"
```

---

### Task 2: packToAnimations(兩種包型)

**Files:**
- Modify: `yuupeek/src/packFormat.js`(factory return 前加函數)
- Test: `yuupeek/src/__tests__/packFormat.test.js`(追加 describe)

**Interfaces:**
- Consumes: Task 1 的 `KNOWN_STATES`。
- Produces: `packToAnimations(pack) → { [state]: { srcs: string[], ms?: number, loop: boolean } }`。
  overlay(Task 6)與測試依賴此簽名。

- [ ] **Step 1: 寫失敗測試**(追加到 packFormat.test.js,並把頂部 require 改為
  `const { validatePack, packToAnimations } = require('../packFormat');`)

```js
describe('packToAnimations', () => {
  test('擴充包:原樣輸出,不補 idle、不映射已知狀態', () => {
    const r = packToAnimations(extPack());
    expect(Object.keys(r)).toEqual(['hurt']);
    expect(r.hurt).toEqual({ srcs: [PNG, PNG], ms: 125, loop: false });
  });

  test('換角包:已知狀態缺漏一律映射到包的 idle', () => {
    const r = packToAnimations(fullPack());
    for (const s of ['idle', 'peek', 'cheer', 'cry', 'eat', 'jump', 'wave', 'run_left', 'run_right', 'watch_excited']) {
      expect(r[s].srcs).toEqual([PNG]);
    }
  });

  test('換角包:自有動畫保留,全新狀態名直接註冊', () => {
    const p = fullPack();
    p.animations.attack = { srcs: [PNG, PNG], ms: 100, loop: false };
    const r = packToAnimations(p);
    expect(r.attack.srcs).toHaveLength(2);
    expect(r.peek.srcs).toEqual(p.animations.idle.srcs); // 映射
  });

  test('loop 缺省時輸出 false(布林化)', () => {
    const p = extPack({ animations: { hurt: { srcs: [PNG] } } });
    expect(packToAnimations(p).hurt.loop).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd yuupeek && npx jest src/__tests__/packFormat.test.js`
Expected: FAIL — `packToAnimations is not a function`

- [ ] **Step 3: 實作**(packFormat.js 中,`return { ... }` 前加;並把 return 改為
  `return { validatePack, packToAnimations, KNOWN_STATES };`)

```js
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd yuupeek && npx jest src/__tests__/packFormat.test.js`
Expected: PASS

- [ ] **Step 5: Commit(若已授權)**

```bash
git add yuupeek/src/packFormat.js yuupeek/src/__tests__/packFormat.test.js
git commit -m "feat: packToAnimations(擴充包直通/換角包 idle 映射)"
```

---

### Task 3: sliceGeometry + defaultLoop + applyDefaultInteractions

**Files:**
- Modify: `yuupeek/src/packFormat.js`
- Test: `yuupeek/src/__tests__/packFormat.test.js`(追加)

**Interfaces:**
- Produces(workshop.js Task 8/9 依賴):
  - `sliceGeometry(imageWidth, imageHeight, frameWidth?) → { ok:true, frameW, count, rects:[{x,y,w,h}] } | { ok:false, error }`
  - `defaultLoop(name) → boolean`(規格 §7 名稱慣例)
  - `applyDefaultInteractions(packInteractions, existing, generateId) → { merged, added, skipped }`

- [ ] **Step 1: 寫失敗測試**(追加;require 改為解構全部五個函數)

```js
describe('sliceGeometry(規格 §7)', () => {
  test('省略幀寬 → 猜圖高;1712×214 切 8 幀', () => {
    const r = sliceGeometry(1712, 214);
    expect(r).toMatchObject({ ok: true, frameW: 214, count: 8 });
    expect(r.rects[0]).toEqual({ x: 0, y: 0, w: 214, h: 214 });
    expect(r.rects[7]).toEqual({ x: 1498, y: 0, w: 214, h: 214 });
  });

  test('不整除 → 報錯訊息含兩個數字', () => {
    const r = sliceGeometry(1712, 200);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/1712/);
    expect(r.error).toMatch(/200/);
  });

  test('手動指定幀寬覆蓋猜測', () => {
    expect(sliceGeometry(1712, 214, 856)).toMatchObject({ ok: true, count: 2 });
  });

  test('幀寬非正整數 → 錯誤', () => {
    expect(sliceGeometry(100, 0).ok).toBe(false);
    expect(sliceGeometry(100, 50, -2).ok).toBe(false);
  });
});

describe('defaultLoop(規格 §7 名稱慣例)', () => {
  test('idle/run_*/walk* 預設循環,其餘單次', () => {
    expect(defaultLoop('idle')).toBe(true);
    expect(defaultLoop('run_left')).toBe(true);
    expect(defaultLoop('walking')).toBe(true);
    expect(defaultLoop('hurt')).toBe(false);
    expect(defaultLoop('wave')).toBe(false);
  });
});

describe('applyDefaultInteractions', () => {
  const genId = (t) => (t === 'command' ? 'c' : t === 'keyword' ? 'k' : 't') + '_test';

  test('新互動取得現生成的 id 並加入', () => {
    const pack = [{ trigger: 'command', match: ['!痛'], animation: 'hurt', yolia_see: 0, response: '好痛!' }];
    const { merged, added, skipped } = applyDefaultInteractions(pack, [], genId);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('c_test');
    expect(merged).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  test('同 match 已存在 → 跳過並回報', () => {
    const existing = [{ id: 'c_old', trigger: 'command', match: '!痛', animation: 'cry' }];
    const pack = [{ trigger: 'command', match: ['!痛'], animation: 'hurt' }];
    const { merged, added, skipped } = applyDefaultInteractions(pack, existing, genId);
    expect(added).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(merged).toEqual(existing);
  });

  test('threshold(無 match)一律加入', () => {
    const pack = [{ trigger: 'threshold', min: 50, state: 'hurt' }];
    const { added } = applyDefaultInteractions(pack, [], genId);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('t_test');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd yuupeek && npx jest src/__tests__/packFormat.test.js`
Expected: FAIL — `sliceGeometry is not a function`

- [ ] **Step 3: 實作**(packFormat.js;return 改為
  `return { validatePack, packToAnimations, sliceGeometry, defaultLoop, applyDefaultInteractions, KNOWN_STATES };`)

```js
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd yuupeek && npx jest src/__tests__/packFormat.test.js`
Expected: PASS(全 suite)

- [ ] **Step 5: Commit(若已授權)**

```bash
git add yuupeek/src/packFormat.js yuupeek/src/__tests__/packFormat.test.js
git commit -m "feat: 切片幾何/loop 慣例/建議綁定合併(packFormat 純函數)"
```

---

### Task 4: character.js setAnimations 支援 srcs

**Files:**
- Modify: `yuupeek/renderer/character.js:329-338`(setAnimations)
- Test: `yuupeek/src/__tests__/character.test.js`(追加 describe)

**Interfaces:**
- Produces: `setAnimations(cfg)` 額外接受 `{ 狀態: { srcs: string[], ms?, loop? } }`(規格 §4)。
  舊 `{ folder, frames[] }` 路徑一字不動。overlay(Task 6)依賴。

- [ ] **Step 1: 寫失敗測試**(追加到 character.test.js 末尾)

```js
// ── setAnimations srcs support(規格 §4)────────────────────────────────────

describe('setAnimations srcs support', () => {
  test('接受 srcs 陣列並可播放自訂狀態至結束回 baseState', () => {
    const char = makeChar();
    char.setAnimations({ hurt: { srcs: ['data:image/png;base64,AAA'], ms: 50, loop: false } });
    char.applyUpdate({ value: 0, state: 'hurt', animOnly: true });
    expect(char.getCurrentState()).toBe('hurt');

    jest.advanceTimersByTime(300); // 1 幀 × 50ms 播畢 → 回 baseState(idle)
    expect(char.getCurrentState()).toBe('idle');
  });

  test('無 srcs 也無 folder 的項目靜默跳過,不炸', () => {
    const char = makeChar();
    expect(() => char.setAnimations({ bad: { frames: 3 }, worse: null })).not.toThrow();
  });

  test('folder 格式(舊路徑)行為不變', () => {
    const char = makeChar();
    char.setAnimations({ hurt: { folder: 'hurt', frames: [0, 1], ms: 50, loop: false } });
    char.applyUpdate({ value: 0, state: 'hurt', animOnly: true });
    expect(char.getCurrentState()).toBe('hurt');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd yuupeek && npx jest src/__tests__/character.test.js`
Expected: 第一個新測試 FAIL(hurt 沒有 srcs 定義 → drawFrame 回退 idle 的 10 幀,
300ms 內播不完 → getCurrentState 仍是 'hurt' 而非 'idle';或依實際輸出)。
若失敗原因不同(例如 fake timers 沒推進 performance.now),先照
superpowers:systematic-debugging 查明,不要直接改斷言遷就。

- [ ] **Step 3: 實作**(character.js L329-338 改為)

```js
    setAnimations(cfg) {
      Object.entries(cfg).forEach(([state, def]) => {
        if (Array.isArray(def?.srcs)) {                        // 完整 URL(data URL 或 https)直通
          ANIMATIONS[state] = { srcs: def.srcs, loop: !!def.loop, ms: def.ms };
          cacheFrames(def.srcs);
          return;
        }
        if (!def?.folder || !Array.isArray(def.frames)) return;
        const srcs = def.frames.map(
          i => `${assetBase}/${def.folder}/${String(i).padStart(2, '0')}.png`
        );
        ANIMATIONS[state] = { srcs, loop: !!def.loop, ms: def.ms };
        cacheFrames(srcs);
      });
    },
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd yuupeek && npx jest src/__tests__/character.test.js`
Expected: PASS(既有 run animation 6 案例+新 3 案例全綠)

- [ ] **Step 5: 沙盒驗證(共用檔改動,PLAYBOOK DoD)**

Run: `cd yuupeek && npm run test-ui` → 開 http://localhost:3001
Expected: 頁面載入、內建動畫照常播放;console 紅字僅限兩種已知例外(WS 3001 重連、pet-config 404)。

- [ ] **Step 6: Commit(若已授權)**

```bash
git add yuupeek/renderer/character.js yuupeek/src/__tests__/character.test.js
git commit -m "feat: setAnimations 接受 srcs 完整 URL 陣列(規格 §4,舊 folder 路徑不變)"
```

---

### Task 5: RTDB rules 加 /packs

**Files:**
- Modify: `web/database.rules.json`

**Interfaces:**
- Produces: `/packs` 節點讀公開、寫 admin。Task 6/7 的讀寫依賴此規則部署後生效。

- [ ] **Step 1: 修改 rules**(整檔改為)

```json
{
  "rules": {
    "state":  { ".read": true,  ".write": false },
    "config": { ".read": true,  ".write": "auth != null && auth.token.email == 'REPLACE_WITH_YOUR_EMAIL'" },
    "packs":  { ".read": true,  ".write": "auth != null && auth.token.email == 'REPLACE_WITH_YOUR_EMAIL'" },
    "$other": { ".read": false, ".write": false }
  }
}
```

(佔位字串會被 `web/gen-database-rules.js` 以 `/g` 全域取代,兩處都會換——已查證。)

- [ ] **Step 2: 驗證 JSON 合法**

Run: `node -e "JSON.parse(require('fs').readFileSync('web/database.rules.json','utf8')); console.log('rules JSON OK')"`
Expected: `rules JSON OK`

- [ ] **Step 3: Commit(若已授權)**

```bash
git add web/database.rules.json
git commit -m "feat: RTDB rules 新增 /packs(讀公開/寫 admin)"
```

---

### Task 6: overlay 套用 activePackId + sync.js 同步清單

**Files:**
- Modify: `web/public/index.html`(L49-53 script 區、L351-383 config 訂閱)
- Modify: `web/sync.js:8-12`(FILES)

**Interfaces:**
- Consumes: `PackFormat.packToAnimations`(Task 2)、`char.setAnimations` srcs(Task 4)、
  RTDB `/packs/<key>`(key=id 的「.」換「_」)與 `config/activePackId`(Task 7 的 panel 寫入)。

- [ ] **Step 1: sync.js FILES 加兩行**(workshop.js 於 Task 8 建立,先一併登記)

```js
const FILES = [
  ['yuupeek/renderer/character.js', 'web/public/character.js'],
  ['yuupeek/renderer/panel.html',   'web/public/panel.html'],
  ['yuupeek/src/chatProcessor.js',  'web/public/chatProcessor.js'],
  ['yuupeek/src/packFormat.js',     'web/public/packFormat.js'],
  ['yuupeek/renderer/workshop.js',  'web/public/workshop.js'],
];
```

- [ ] **Step 2: index.html 載入 packFormat**(L50 `chatProcessor.js` 之後插入)

```html
  <script src="./packFormat.js"></script>
```

- [ ] **Step 3: config 訂閱處理 activePackId**——把現有 L351-356:

```js
    db.ref('config').on('value', (snap) => {
      const config = snap.val() ?? {};

      thresholds = (config.interactions ?? []).filter(i => i.trigger === 'threshold');
      handlers   = ChatProcessor.buildHandlers(config.interactions ?? []);
      char.setAnimations({ ...DEFAULT_ANIMATIONS, ...(config.animations ?? {}) });
```

改為:

```js
    let currentPackKey = null;   // 啟用中角色包的 RTDB key(id 的「.」換「_」);null=無
    let packAnimations = null;   // packToAnimations 結果;null=無啟用包

    // 套用順序:內建 DEFAULT + config/animations 打底,啟用中的包疊上去
    // (擴充包=只疊自己的動作;換角包=packToAnimations 已把已知狀態映射到包的 idle)
    function applyAllAnimations(config) {
      char.setAnimations({ ...DEFAULT_ANIMATIONS, ...(config.animations ?? {}) });
      if (packAnimations) char.setAnimations(packAnimations);
    }

    db.ref('config').on('value', (snap) => {
      const config = snap.val() ?? {};

      thresholds = (config.interactions ?? []).filter(i => i.trigger === 'threshold');
      handlers   = ChatProcessor.buildHandlers(config.interactions ?? []);

      const packKey = config.activePackId ? String(config.activePackId).replace(/\./g, '_') : null;
      if (packKey !== currentPackKey) {
        currentPackKey = packKey;
        packAnimations = null;                       // 停用/切換:先回打底狀態
        if (packKey) {
          db.ref('packs/' + packKey).once('value').then((ps) => {
            if (currentPackKey !== packKey) return;  // 載入期間又切換了,丟棄
            const pack = ps.val();
            if (!pack) { console.warn('[pack] 找不到角色包:', packKey); return; }
            packAnimations = PackFormat.packToAnimations(pack);
            applyAllAnimations(config);
          }).catch((e) => console.warn('[pack] 載入失敗,維持現狀:', e));
        }
      }
      applyAllAnimations(config);
```

(其後 `if (config.obs?.scale)` 起照舊,不動。)

- [ ] **Step 4: 驗證 sync 與頁面**

先建佔位檔(Task 8 會填入內容;沒有它 sync.js 會因來源檔不存在而 throw):

```powershell
if (-not (Test-Path yuupeek/renderer/workshop.js)) { New-Item -ItemType File yuupeek/renderer/workshop.js | Out-Null }
```

Run: `cd web && node sync.js`
Expected: 印出 5 個 `synced:` 無錯。
再開 `web/public/index.html` 檢查 script 標籤順序:character → chatProcessor → packFormat → firebase-config。

- [ ] **Step 5: 舊資料相容檢查(人工推演,寫進回報)**

- 無 `activePackId` 的舊資料庫:`packKey=null`、`currentPackKey=null`,永不進讀包分支 → 行為與升級前一致。
- 舊 overlay(無此段程式)讀到新資料:不訂閱 /packs、`activePackId` 是 config 內它不讀的欄位 → 靜默忽略。

- [ ] **Step 6: Commit(若已授權)**

```bash
git add web/public/index.html web/sync.js
git commit -m "feat: overlay 依 activePackId 載入角色包並疊加動畫(失敗維持現狀)"
```

---

### Task 7: panel.html 角色工房分頁骨架 + DataAdapter

**Files:**
- Modify: `yuupeek/renderer/panel.html`(L110-114 tab 列、L225 後加 panel div、L340-354 環境偵測、
  L390 TAB_IDS、L393-406 showTab、L816-874 web adapter、L892-911 desktop adapter)

**Interfaces:**
- Produces(workshop.js Task 8/9 依賴,全域 `api` 上):
  - `api.getPacks() → Promise<{ [key]: pack }>`
  - `api.savePack(pack) → Promise<{ok}>`(key=pack.id 的「.」換「_」)
  - `api.deletePack(key) → Promise<{ok}>`
  - `api.getActivePackId() → Promise<string|null>`
  - `api.setActivePack(idOrNull) → Promise<{ok}>`
  - DOM:`#workshop-root`(workshop.js 的掛載點)、`window.Workshop.load()`(切分頁時呼叫)
- Consumes: 既有 `showToast`、`generateId`、`loadScript`、`IS_WEB`。

- [ ] **Step 1: tab 列**(L110-114 改為;workshop 放 pet 與 settings 之間)

```html
<div class="tabs">
  <div class="tab active" onclick="showTab('guide')">安裝說明</div>
  <div class="tab local-only" onclick="showTab('status')">模組狀態</div>
  <div class="tab" onclick="showTab('pet')">桌寵設定</div>
  <div class="tab" onclick="showTab('workshop')">角色工房</div>
  <div class="tab" onclick="showTab('settings')">設定</div>
</div>
```

- [ ] **Step 2: panel div**(L225 `</div>`(#pet 結尾)之後、`<!-- ── 模組狀態 ── -->` 之前插入)

```html
<!-- ── 角色工房 ── -->
<div id="workshop" class="panel">
  <div class="card" id="workshop-desktop-note" style="display:none">
    <h3>角色工房</h3>
    <p style="color:#64748b">此功能目前僅雲端版支援。</p>
  </div>
  <div id="workshop-root"></div>
</div>
```

- [ ] **Step 3: 桌面模式顯示降級提示**(L348-354 的 `if (IS_WEB) {...}` 區塊後加)

```js
  if (!IS_WEB) {
    document.getElementById('workshop-desktop-note').style.display = '';
  }
```

- [ ] **Step 4: TAB_IDS 與 showTab**——L390 改為(**順序必須與 tab 列 DOM 一致**,
showTab 是用索引對應):

```js
  const TAB_IDS = ['guide', 'status', 'pet', 'workshop', 'settings'];
```

showTab 內(L398 `if (id === 'pet') ...` 之後)加:

```js
    if (id === 'workshop') window.Workshop?.load?.();
```

- [ ] **Step 5: web adapter 加方法**(L851 `getAnimations:` 整行替換+其後插入;
getAnimations 改為合併啟用中包的動畫,讓互動綁定下拉出現 pack 狀態——設計稿 §2 地雷)

```js
        getAnimations: () => Promise.all([
          db.ref('config/animations').once('value'),
          db.ref('config/activePackId').once('value'),
        ]).then(([animSnap, idSnap]) => {
          const animations = { ...(animSnap.val() ?? {}) };
          const id = idSnap.val();
          if (!id) return { animations };
          return db.ref('packs/' + String(id).replace(/\./g, '_')).once('value').then(ps => {
            Object.assign(animations, ps.val()?.animations ?? {});
            return { animations };
          });
        }),
        getPacks:        () => db.ref('packs').once('value').then(s => s.val() ?? {}),
        savePack:        (pack) => db.ref('packs/' + String(pack.id).replace(/\./g, '_')).set(pack).then(() => ({ ok: true })),
        deletePack:      (key) => db.ref('packs/' + key).remove().then(() => ({ ok: true })),
        getActivePackId: () => db.ref('config/activePackId').once('value').then(s => s.val() ?? null),
        setActivePack:   (idOrNull) => db.ref('config/activePackId').set(idOrNull).then(() => ({ ok: true })),
```

- [ ] **Step 6: desktop adapter 加 stub**(L910 `getDefaultPetConfig:` 之後加;
桌面版分頁已隱藏在降級提示後,stub 只防禦誤呼叫)

```js
        getPacks:        () => Promise.resolve({}),
        savePack:        () => Promise.reject(new Error('僅雲端版支援')),
        deletePack:      () => Promise.reject(new Error('僅雲端版支援')),
        getActivePackId: () => Promise.resolve(null),
        setActivePack:   () => Promise.reject(new Error('僅雲端版支援')),
```

- [ ] **Step 7: IS_WEB init 載入 workshop 腳本**(L821 auth-compat loadScript 之後加)

```js
      await loadScript('/packFormat.js');
      await loadScript('/workshop.js');
```

- [ ] **Step 8: 桌面驗證(共用檔改動)**

Run: `cd yuupeek && npm start` → 開 http://localhost:3000/panel
Expected: 五個分頁;「角色工房」分頁只顯示「此功能目前僅雲端版支援」;其餘分頁功能照舊
(桌寵設定可載入、可存)。console 無新紅字。
(Task 8 前 workshop.js 尚無內容——桌面模式本來就不載入它,不影響本驗證。)

Run: `cd yuupeek && npm run test-ui` → http://localhost:3001
Expected: 沙盒照常(panel.html 不影響沙盒,此步是共用檔改動的例行檢查)。

- [ ] **Step 9: Commit(若已授權)**

```bash
git add yuupeek/renderer/panel.html
git commit -m "feat: panel 角色工房分頁骨架+pack DataAdapter(桌面版優雅降級)"
```

---

### Task 8: workshop.js — 包清單 + 匯入精靈(來源 A/B/C)+ 儲存/啟用

**Files:**
- Create: `yuupeek/renderer/workshop.js`
- Modify: `web/sync.js`(若 Task 6 未先加 workshop.js 行,此時加上)

**Interfaces:**
- Consumes: 全域 `api`(Task 7 方法)、`showToast`、`PackFormat`(Tasks 1-3)、`#workshop-root`。
- Produces: `window.Workshop = { load }`;Task 9 在同檔追加幀編輯器與建議綁定。

- [ ] **Step 1: 建立 workshop.js**(完整內容)

```js
// 角色工房(僅雲端版)— DOM 接線層;格式邏輯一律在 packFormat.js(規格 §9,不得重複實作)。
// 由 panel.html initApp 的 IS_WEB 分支以 loadScript 載入。依賴全域:api、showToast、PackFormat。
(function () {
  const root = () => document.getElementById('workshop-root');
  const keyOf = (id) => String(id).replace(/\./g, '_');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let packs = {};          // RTDB /packs 全量:key → pack
  let activePackId = null; // pack.id(含「.」)或 null(=內建 Yolia)
  let working = null;      // 編輯中的包(記憶體工作副本;儲存才寫 RTDB)
  let dirty = false;

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // ── 檔案/圖片工具 ─────────────────────────────────────────────────────────
  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  function loadImage(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = dataUrl;
    });
  }
  function sliceImage(img, geo) {   // 規格 §7 步驟 4:canvas 逐幀切片轉 data URL
    return geo.rects.map((r) => {
      const c = document.createElement('canvas');
      c.width = r.w; c.height = r.h;
      c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      return c.toDataURL('image/png');
    });
  }
  function pickFiles(accept, multiple) {
    return new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
      inp.onchange = () => res([...inp.files]);
      inp.click();
    });
  }

  // ── 進入點 ────────────────────────────────────────────────────────────────
  async function load() {
    if (working) { renderEditor(); return; }   // 編輯到一半切回分頁:維持編輯畫面
    try {
      [packs, activePackId] = await Promise.all([api.getPacks(), api.getActivePackId()]);
    } catch (e) {
      showToast('載入角色包失敗', true);
      return;
    }
    renderPackList();
  }

  // ── ① 包清單 ─────────────────────────────────────────────────────────────
  function renderPackList() {
    const cards = Object.entries(packs).map(([key, p]) => {
      const isActive = p.id === activePackId;
      const type = p.base === 'builtin' ? '擴充包' : '換角包';
      const n = Object.keys(p.animations ?? {}).length;
      return `
        <div style="display:flex;align-items:center;gap:10px;background:#0d111a;border:1px solid ${isActive ? '#f472b6' : '#2d3748'};border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="flex:1">
            <b>${esc(p.name)}</b> <span style="color:#64748b;font-size:12px">v${esc(p.version)} by ${esc(p.author)} · ${type} · ${n} 動畫</span>
          </div>
          ${isActive
            ? '<span style="color:#f472b6;font-size:12px">● 啟用中</span>'
            : `<button class="btn btn-secondary btn-small" onclick="Workshop._activate('${esc(p.id)}')">啟用</button>`}
          <button class="btn btn-secondary btn-small" onclick="Workshop._edit('${key}')">編輯</button>
          <button class="btn btn-secondary btn-small" style="color:#f87171;border-color:#f87171" onclick="Workshop._remove('${key}')">刪除</button>
        </div>`;
    }).join('');

    root().innerHTML = `
      <div class="card">
        <h3>我的角色包</h3>
        <div style="display:flex;align-items:center;gap:10px;background:#0d111a;border:1px solid ${activePackId ? '#2d3748' : '#f472b6'};border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="flex:1"><b>內建 Yolia</b> <span style="color:#64748b;font-size:12px">預設角色,不可刪除</span></div>
          ${activePackId
            ? '<button class="btn btn-secondary btn-small" onclick="Workshop._activate(null)">啟用</button>'
            : '<span style="color:#f472b6;font-size:12px">● 啟用中</span>'}
        </div>
        ${cards}
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-small" onclick="Workshop._create('builtin')">＋新增擴充包(為內建角色加動作)</button>
          <button class="btn btn-secondary btn-small" onclick="Workshop._create(null)">＋新增換角包(整隻新角色)</button>
          <button class="btn btn-secondary btn-small" onclick="Workshop._importJson()">匯入 .yolia.json</button>
        </div>
      </div>`;
  }

  async function activate(idOrNull) {
    try {
      await api.setActivePack(idOrNull);
      activePackId = idOrNull;
      renderPackList();
      showToast(idOrNull ? '已啟用角色包' : '已切回內建 Yolia');
    } catch (e) {
      showToast('啟用失敗:' + (e.message ?? e), true);
    }
  }

  function create(base) {
    working = {
      yoliaPack: 1,
      id: base === 'builtin' ? 'fans.yolia-extras' : 'me.my-character',
      name: base === 'builtin' ? '粉絲動作集' : '我的角色',
      version: '1.0.0',
      author: '',
      license: 'CC-BY-4.0',
      animations: {},
    };
    if (base === 'builtin') working.base = 'builtin';
    dirty = false;
    renderEditor();
  }

  function edit(key) {
    working = JSON.parse(JSON.stringify(packs[key]));   // 深拷貝:儲存前不動原資料
    dirty = false;
    renderEditor();
  }

  // ── 來源 C:.yolia.json 直接入庫 ─────────────────────────────────────────
  async function importJson() {
    const [file] = await pickFiles('.json,application/json', false);
    if (!file) return;
    let pack;
    try {
      pack = JSON.parse(await file.text());
    } catch (e) {
      showToast('不是有效的 JSON 檔', true);
      return;
    }
    const v = PackFormat.validatePack(pack);
    if (!v.ok) { showToast(v.errors[0], true); return; }
    const n = Object.keys(pack.animations).length;
    const kb = Math.round(JSON.stringify(pack).length / 1024);
    if (!confirm(`匯入「${pack.name}」?\n${n} 個動畫,約 ${kb} KB,授權 ${pack.license}`)) return;
    try {
      await api.savePack(pack);
      packs[keyOf(pack.id)] = pack;
      renderPackList();
      showToast('已匯入角色包');
    } catch (e) {
      showToast('儲存失敗:' + (e.message ?? e), true);
    }
  }

  // ── ②③ 編輯器畫面(manifest + 動畫清單;幀編輯器在 Task 9 補上)────────────
  function renderEditor() {
    const w = working;
    const rows = Object.entries(w.animations).map(([name, a]) => `
      <div style="display:flex;align-items:center;gap:10px;background:#0d111a;border:1px solid #2d3748;border-radius:8px;padding:10px;margin-bottom:8px">
        <img src="${a.srcs[0]}" style="width:36px;height:36px;image-rendering:pixelated;background:#1a1d27;border-radius:4px">
        <div style="flex:1"><b>${esc(name)}</b> <span style="color:#64748b;font-size:12px">${a.srcs.length} 幀 · ${a.ms ?? 150}ms · ${a.loop ? '循環' : '單次'}</span></div>
        <button class="btn btn-secondary btn-small" onclick="Workshop._editAnim('${esc(name)}')">編輯</button>
        <button class="btn btn-secondary btn-small" style="color:#f87171;border-color:#f87171" onclick="Workshop._removeAnim('${esc(name)}')">刪除</button>
      </div>`).join('');

    root().innerHTML = `
      <div class="card">
        <h3>${w.base === 'builtin' ? '擴充包(疊加在內建 Yolia 上)' : '換角包(整隻角色,必含 idle)'}</h3>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px">
          <label style="color:#94a3b8;font-size:12px">包 ID(作者.包名,全小寫)<input id="wk-id" value="${esc(w.id)}" style="width:100%"></label>
          <label style="color:#94a3b8;font-size:12px">名稱<input id="wk-name" value="${esc(w.name)}" style="width:100%"></label>
          <label style="color:#94a3b8;font-size:12px">作者<input id="wk-author" value="${esc(w.author)}" style="width:100%"></label>
          <label style="color:#94a3b8;font-size:12px">授權<select id="wk-license" style="width:100%">
            ${['CC0-1.0', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'custom'].map(l => `<option${l === w.license ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label>
        </div>
        <h3>動畫清單</h3>
        ${rows || '<p style="color:#64748b;font-size:13px">尚無動畫,從下方匯入。</p>'}
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-small" onclick="Workshop._importSheet()">＋從 spritesheet 匯入</button>
          <button class="btn btn-secondary btn-small" onclick="Workshop._importFrames()">＋從逐幀圖匯入</button>
        </div>
        <div id="wk-wizard"></div>
        <div id="wk-frame-editor"></div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-small" onclick="Workshop._save()">儲存包</button>
          <button class="btn btn-secondary btn-small" onclick="Workshop._cancel()">返回列表</button>
        </div>
      </div>`;
  }

  function readManifest() {
    working.id      = document.getElementById('wk-id').value.trim();
    working.name    = document.getElementById('wk-name').value.trim();
    working.author  = document.getElementById('wk-author').value.trim();
    working.license = document.getElementById('wk-license').value;
  }

  // ── 匯入精靈:來源 A(spritesheet)──────────────────────────────────────────
  let wizard = null; // { frames: dataURL[], img, sheetUrl } 切片工作區

  async function importSheet() {
    const [file] = await pickFiles('image/png', false);
    if (!file) return;
    if (file.type !== 'image/png') {
      showToast('請提供 PNG spritesheet(不收 webp/gif,生成工具請選 PNG 輸出)', true);
      return;
    }
    const url = await readAsDataURL(file);
    const img = await loadImage(url);
    wizard = { img, sheetUrl: url, frames: [] };
    reslice(img.height);   // 規格 §7 步驟 1:猜幀寬=圖高
  }

  function reslice(frameW) {
    if (!wizard?.img) return;   // 來源 B(逐幀圖)沒有 sheet,幀寬欄不適用
    const geo = PackFormat.sliceGeometry(wizard.img.naturalWidth, wizard.img.naturalHeight, frameW);
    if (!geo.ok) {
      document.getElementById('wk-wizard').innerHTML = `
        <div style="background:#0d111a;border:1px solid #f87171;border-radius:8px;padding:12px;margin-top:12px">
          <p style="color:#f87171;font-size:13px">${esc(geo.error)}</p>
          ${frameWInput(frameW)}
        </div>`;
      return;
    }
    wizard.frames = sliceImage(wizard.img, geo);
    renderWizard(geo.frameW);
  }

  function frameWInput(v) {
    return `<label style="color:#94a3b8;font-size:12px">幀寬(px)
      <input id="wk-framew" type="text" inputmode="numeric" value="${v}" style="width:80px"
             onchange="Workshop._reslice(parseInt(this.value,10))"></label>`;
  }

  function renderWizard(frameW) {
    const thumbs = wizard.frames.map((f, i) =>
      `<img src="${f}" title="幀 ${i}" style="width:48px;height:48px;image-rendering:pixelated;background:#1a1d27;border:1px solid #2d3748;border-radius:4px">`
    ).join('');
    const knownOpts = PackFormat.KNOWN_STATES.map(s => `<option>${s}</option>`).join('');
    document.getElementById('wk-wizard').innerHTML = `
      <div style="background:#0d111a;border:1px solid #2d3748;border-radius:8px;padding:12px;margin-top:12px">
        <p style="color:#94a3b8;font-size:12px;margin-bottom:8px">切片結果(切得不對?改幀寬重切):</p>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${thumbs}</div>
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          ${frameWInput(frameW)}
          <label style="color:#94a3b8;font-size:12px">狀態名
            <input id="wk-anim-name" list="wk-known-states" value="hurt" style="width:120px">
            <datalist id="wk-known-states">${knownOpts}</datalist></label>
          <label style="color:#94a3b8;font-size:12px">每幀 ms
            <input id="wk-anim-ms" type="text" inputmode="numeric" value="125" style="width:60px"></label>
          <label style="color:#94a3b8;font-size:12px;display:flex;align-items:center;gap:4px">
            <input id="wk-anim-loop" type="checkbox"> 循環</label>
          <button class="btn btn-small" onclick="Workshop._addAnim()">加入動畫</button>
        </div>
      </div>`;
    const nameInp = document.getElementById('wk-anim-name');
    nameInp.onchange = () => {
      document.getElementById('wk-anim-loop').checked = PackFormat.defaultLoop(nameInp.value.trim());
    };
  }

  // ── 匯入精靈:來源 B(逐幀圖,按檔名排序)─────────────────────────────────
  async function importFrames() {
    const files = await pickFiles('image/png', true);
    if (!files.length) return;
    if (files.some(f => f.type !== 'image/png')) { showToast('逐幀圖限 PNG', true); return; }
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const frames = [];
    for (const f of files) frames.push(await readAsDataURL(f));
    wizard = { frames };
    renderWizard('—');                                 // 無 sheet,幀寬欄不適用
    document.getElementById('wk-anim-ms').value = '150'; // 來源 B 預設 ms=150(規格 §7)
  }

  function addAnim() {
    const name = document.getElementById('wk-anim-name').value.trim();
    const ms   = parseInt(document.getElementById('wk-anim-ms').value, 10);
    const loop = document.getElementById('wk-anim-loop').checked;
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { showToast('狀態名限小寫英文開頭+小寫英數底線', true); return; }
    if (!wizard?.frames?.length) { showToast('沒有可加入的幀', true); return; }
    if (working.animations[name] && !confirm(`動畫「${name}」已存在,要覆蓋嗎?`)) return;
    working.animations[name] = { srcs: wizard.frames, ms: Number.isFinite(ms) ? ms : 125, loop };
    wizard = null;
    dirty = true;
    renderEditor();
  }

  function removeAnim(name) {
    if (!confirm(`刪除動畫「${name}」?`)) return;
    delete working.animations[name];
    dirty = true;
    renderEditor();
  }

  // ── 儲存/返回/刪除 ────────────────────────────────────────────────────────
  async function save() {
    readManifest();
    const v = PackFormat.validatePack(working);
    if (!v.ok) { showToast(v.errors[0], true); return; }
    try {
      await api.savePack(working);
      packs[keyOf(working.id)] = working;
      dirty = false;
      showToast('已儲存角色包');
      if (working.id !== activePackId && confirm('立即啟用這個角色包?')) await activate(working.id);
      working = null;
      renderPackList();
    } catch (e) {
      showToast('儲存失敗:' + (e.message ?? e), true);
    }
  }

  function cancel() {
    if (dirty && !confirm('有未儲存的變更,確定離開?')) return;
    working = null;
    wizard = null;
    renderPackList();
  }

  async function remove(key) {
    const p = packs[key];
    if (!p) return;
    let hint = '';
    try {
      const cfg = await api.getPetConfig();
      const states = new Set(Object.keys(p.animations ?? {}));
      const bound = (cfg.interactions ?? []).filter(i => states.has(i.animation) || states.has(i.state));
      if (bound.length) hint = `\n注意:有 ${bound.length} 個互動綁定此包的動畫,刪除後將回退未知狀態行為。`;
    } catch (e) { /* 查不到綁定就不提示,不阻擋刪除 */ }
    if (!confirm(`刪除角色包「${p.name}」?${hint}`)) return;
    try {
      await api.deletePack(key);
      if (p.id === activePackId) { await api.setActivePack(null); activePackId = null; }
      delete packs[key];
      renderPackList();
      showToast('已刪除');
    } catch (e) {
      showToast('刪除失敗:' + (e.message ?? e), true);
    }
  }

  window.Workshop = {
    load,
    _activate: activate, _create: create, _edit: edit, _remove: remove,
    _importJson: importJson, _importSheet: importSheet, _importFrames: importFrames,
    _reslice: reslice, _addAnim: addAnim, _removeAnim: removeAnim,
    _save: save, _cancel: cancel,
    _editAnim: () => showToast('幀編輯器尚未就緒(下一任務)', true), // Task 9 覆蓋
  };
})();
```

- [ ] **Step 2: 確認 sync.js 已含 workshop.js 行**(Task 6 已加或此時加),跑同步

Run: `cd web && node sync.js`
Expected: 5 個 `synced:` 無錯,`web/public/workshop.js` 出現。

- [ ] **Step 3: 靜態檢查**

Run: `node --check yuupeek/renderer/workshop.js`
Expected: 無輸出(語法合法)。

- [ ] **Step 4: 桌面迴歸**

Run: `cd yuupeek && npm start` → http://localhost:3000/panel
Expected: 桌面模式不載入 workshop.js,角色工房分頁仍只有降級提示;其餘分頁照舊。

- [ ] **Step 5: Commit(若已授權)**

```bash
git add yuupeek/renderer/workshop.js web/sync.js
git commit -m "feat: 角色工房——包清單/匯入精靈(spritesheet、逐幀圖、.yolia.json)/儲存啟用"
```

---

### Task 9: workshop.js — 幀編輯器 + 建議綁定套用

**Files:**
- Modify: `yuupeek/renderer/workshop.js`

**Interfaces:**
- Consumes: Task 8 的 `working`、`renderEditor`、全域 `api.getPetConfig/savePetConfig`、
  `generateId`(panel 全域)、`PackFormat.applyDefaultInteractions`。
- Produces: `Workshop._editAnim(name)` 開啟幀編輯器(取代 Task 8 的暫置 toast);
  編輯器含預覽播放、ms/loop、幀序左移/右移/複製/刪除;
  `working.defaultInteractions` 存在時編輯器畫面出現「建議綁定」勾選區。

- [ ] **Step 1: 加幀編輯器**——在 workshop.js 的 `// ── 儲存/返回/刪除` 區塊前插入:

```js
  // ── ③ 幀編輯器(animation-editor.md §3:獨立小畫布,不實例化 createCharacter)──
  let editingAnim = null;   // 動畫名
  let selectedFrame = -1;
  let previewTimer = null;

  function editAnim(name) {
    editingAnim = name;
    selectedFrame = -1;
    renderEditor();
    renderFrameEditor();
  }

  function stopPreview() {
    if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
  }

  function renderFrameEditor() {
    const a = working.animations[editingAnim];
    if (!a) { document.getElementById('wk-frame-editor').innerHTML = ''; stopPreview(); return; }
    const thumbs = a.srcs.map((f, i) => `
      <img src="${f}" onclick="Workshop._selectFrame(${i})" title="幀 ${i}"
           style="width:48px;height:48px;image-rendering:pixelated;background:#1a1d27;cursor:pointer;
                  border:2px solid ${i === selectedFrame ? '#f472b6' : '#2d3748'};border-radius:4px">`).join('');
    document.getElementById('wk-frame-editor').innerHTML = `
      <div style="background:#0d111a;border:1px solid #2d3748;border-radius:8px;padding:12px;margin-top:12px">
        <p style="color:#94a3b8;font-size:12px;margin-bottom:8px">幀編輯:<b>${esc(editingAnim)}</b></p>
        <div style="display:flex;gap:16px;align-items:start;flex-wrap:wrap">
          <canvas id="wk-preview" width="96" height="96"
                  style="image-rendering:pixelated;background:#1a1d27;border-radius:6px"></canvas>
          <div style="flex:1;min-width:240px">
            <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
              <label style="color:#94a3b8;font-size:12px">每幀 ms
                <input id="wk-ed-ms" type="text" inputmode="numeric" value="${a.ms ?? 150}" style="width:60px"
                       onchange="Workshop._setMs(parseInt(this.value,10))"></label>
              <label style="color:#94a3b8;font-size:12px;display:flex;align-items:center;gap:4px">
                <input type="checkbox" ${a.loop ? 'checked' : ''} onchange="Workshop._setLoop(this.checked)"> 循環</label>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${thumbs}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-secondary btn-small" onclick="Workshop._moveFrame(-1)">← 左移</button>
              <button class="btn btn-secondary btn-small" onclick="Workshop._moveFrame(1)">右移 →</button>
              <button class="btn btn-secondary btn-small" onclick="Workshop._dupFrame()">複製</button>
              <button class="btn btn-secondary btn-small" style="color:#f87171;border-color:#f87171" onclick="Workshop._delFrame()">刪幀</button>
              <button class="btn btn-secondary btn-small" style="margin-left:auto" onclick="Workshop._closeEditor()">關閉</button>
            </div>
          </div>
        </div>
      </div>`;
    startPreview();
  }

  function startPreview() {
    stopPreview();
    const canvas = document.getElementById('wk-preview');
    const ctx = canvas.getContext('2d');
    let i = 0;
    const tick = () => {
      const a = working.animations[editingAnim];
      if (!a?.srcs.length) return;
      const img = new Image();
      img.onload = () => { ctx.clearRect(0, 0, 96, 96); ctx.drawImage(img, 0, 0, 96, 96); };
      img.src = a.srcs[i % a.srcs.length];
      i++;
    };
    tick();
    previewTimer = setInterval(tick, working.animations[editingAnim]?.ms ?? 150);
  }

  function selectFrame(i) { selectedFrame = i; renderFrameEditor(); }
  function setMs(ms) {
    if (!Number.isFinite(ms) || ms < 1 || ms > 10000) { showToast('ms 需為 1–10000', true); return; }
    working.animations[editingAnim].ms = ms;
    dirty = true;
    startPreview();
  }
  function setLoop(v) { working.animations[editingAnim].loop = v; dirty = true; }
  function withSel(fn) {
    const a = working.animations[editingAnim];
    if (selectedFrame < 0 || selectedFrame >= a.srcs.length) { showToast('先點選一個幀', true); return; }
    fn(a.srcs);
    dirty = true;
    renderEditor();
    renderFrameEditor();
  }
  function moveFrame(dir) {
    withSel((srcs) => {
      const j = selectedFrame + dir;
      if (j < 0 || j >= srcs.length) return;
      [srcs[selectedFrame], srcs[j]] = [srcs[j], srcs[selectedFrame]];
      selectedFrame = j;
    });
  }
  function dupFrame() {
    withSel((srcs) => {
      if (srcs.length >= 32) { showToast('已達單一動畫 32 幀上限', true); return; }
      srcs.splice(selectedFrame + 1, 0, srcs[selectedFrame]); // data URL 字串共享,無額外成本
    });
  }
  function delFrame() {
    withSel((srcs) => {
      if (srcs.length <= 1) { showToast('至少要留一幀', true); return; }
      srcs.splice(selectedFrame, 1);
      selectedFrame = Math.min(selectedFrame, srcs.length - 1);
    });
  }
  function closeEditor() { editingAnim = null; stopPreview(); renderEditor(); }
```

- [ ] **Step 2: 建議綁定區**——`renderEditor()` 內,`<div id="wk-frame-editor"></div>` 之後、
儲存按鈕列之前插入:

```js
        ${(w.defaultInteractions?.length) ? `
        <h3 style="margin-top:14px">建議綁定</h3>
        <p style="color:#64748b;font-size:12px">套用後到「桌寵設定」分頁管理。</p>
        ${w.defaultInteractions.map((it, i) => `
          <label style="display:block;color:#94a3b8;font-size:13px;margin-bottom:4px">
            <input type="checkbox" class="wk-di" data-i="${i}" checked>
            ${esc(it.trigger)} ${esc(Array.isArray(it.match) ? it.match.join('、') : (it.match ?? `幽視值≥${it.min}`))}
            → ${esc(it.animation ?? it.state ?? '')}
          </label>`).join('')}
        <button class="btn btn-secondary btn-small" onclick="Workshop._applyBindings()">套用勾選項</button>` : ''}
```

並在 workshop.js 加:

```js
  // ── ④ 建議綁定套用(寫 config.interactions;不重造第二套互動編輯器)────────
  async function applyBindings() {
    const picked = [...document.querySelectorAll('.wk-di:checked')]
      .map(el => working.defaultInteractions[+el.dataset.i]);
    if (!picked.length) { showToast('沒有勾選任何項目', true); return; }
    try {
      const cfg = await api.getPetConfig();
      const { merged, added, skipped } =
        PackFormat.applyDefaultInteractions(picked, cfg.interactions ?? [], generateId);
      await api.savePetConfig({ interactions: merged });
      showToast(`已套用 ${added.length} 項` + (skipped.length ? `,${skipped.length} 項與現有互動重複已跳過` : ''));
    } catch (e) {
      showToast('套用失敗:' + (e.message ?? e), true);
    }
  }
```

- [ ] **Step 3: 更新 Workshop 匯出表**——Task 8 的 `window.Workshop = {...}` 改為:

```js
  window.Workshop = {
    load,
    _activate: activate, _create: create, _edit: edit, _remove: remove,
    _importJson: importJson, _importSheet: importSheet, _importFrames: importFrames,
    _reslice: reslice, _addAnim: addAnim, _removeAnim: removeAnim,
    _save: save, _cancel: cancel,
    _editAnim: editAnim, _selectFrame: selectFrame, _setMs: setMs, _setLoop: setLoop,
    _moveFrame: moveFrame, _dupFrame: dupFrame, _delFrame: delFrame, _closeEditor: closeEditor,
    _applyBindings: applyBindings,
  };
```

(同時刪除 Task 8 暫置的 `_editAnim: () => showToast(...)` 行。)

- [ ] **Step 4: 語法檢查+同步**

Run: `node --check yuupeek/renderer/workshop.js; cd web; node sync.js`
Expected: 語法合法;5 個 `synced:`。

- [ ] **Step 5: Commit(若已授權)**

```bash
git add yuupeek/renderer/workshop.js
git commit -m "feat: 角色工房——幀編輯器(預覽/移動/複製/刪幀)與建議綁定套用"
```

---

### Task 10: 文件——粉絲投稿指南 + README 連結 + ARCHITECTURE/HANDOFF

**Files:**
- Create: `docs/fan-submission-guide.md`
- Modify: `README.md`(文件末尾加章節)
- Modify: `docs/ARCHITECTURE.md`(§5 已知限制行、§6 schema)
- Modify: `docs/HANDOFF.md`(狀態補記)

- [ ] **Step 1: 建立 `docs/fan-submission-guide.md`**

```markdown
# 粉絲投稿指南——幫 Yolia 畫新動作

想讓你畫的動作出現在實況主的直播上?照這份格式做,把檔案傳給實況主(Discord、
噗浪、信箱都行——系統沒有上傳入口,一律由實況主在控制面板匯入)。

## 檔案格式(必守)

1. **PNG spritesheet**:所有幀橫向排成一列,由左到右=播放順序。不收 webp/gif。
2. **透明背景**。
3. **每幀等寬**,且圖總寬=幀寬×幀數(要整除)。幀接近正方形最保險
   (匯入器會用「幀寬=圖高」自動切,切錯實況主也能手動改幀寬)。
4. 幀尺寸建議 **64×64 到 256×256**;幀數建議 **4–16**(上限 32)。
5. 角色臉朝左、佔滿畫格(角色會被拉伸到 128×139 畫布,過多留白會顯得小)。

## 標準範例

`yuupeek/assets/sprites/sample/00_hurt_sheet.png`:1712×214、單列 8 幀、每幀 214×214。
照這個規格做就對了。

## 建議附上的資訊

- 動作名稱(小寫英文,如 `hurt`、`dance`)
- 建議每幀毫秒數(預設 125)與是否循環
- 你希望的觸發指令(如 `!痛`)——由實況主決定是否採用
- 授權聲明(你同意實況主怎麼用這張圖)

## 實況主怎麼匯入

控制面板 → 角色工房 → 「＋新增擴充包(為內建角色加動作)」或編輯既有擴充包 →
「＋從 spritesheet 匯入」→ 確認切片 → 取狀態名 → 儲存並啟用 →
到「桌寵設定」綁定指令。
```

- [ ] **Step 2: README.md 末尾加章節**

```markdown
## 粉絲投稿:幫角色加新動作

粉絲可以畫 spritesheet 投稿新動作(透過任何場外管道交給實況主),實況主在
控制面板「角色工房」匯入並綁定指令。格式要求見
[docs/fan-submission-guide.md](docs/fan-submission-guide.md)。
```

- [ ] **Step 3: ARCHITECTURE.md 更新**(只改受影響的行)

§5 的已知限制行:

```markdown
- `setAnimations` 支援兩種格式:`{folder, frames[]}`(assetBase 相對路徑)與
  `{srcs[]}`(完整 URL/data URL,2026-07-07 加,角色包用;規格見
  docs/specs/character-pack-format.md)。
```

§6 schema 的 `└─ greetingAnimations` 行之後、`/state` 之前加:

```markdown
├─ activePackId: string|null    （啟用中角色包 id;null/缺省=內建角色）

/packs/<packId 的「.」換「_」>    .read: 公開   .write: 僅 ADMIN_EMAIL
    = 完整 .yolia.json 內容（Character Pack v1,規格 docs/specs/character-pack-format.md）
```

- [ ] **Step 4: HANDOFF.md 補記**(在「目前狀態」區塊頂部加,日期用實作當天)

```markdown
- 角色工坊 Phase 1 + 擴充包(base:"builtin")已實作:packFormat.js(含測試)、
  character.js srcs、/packs rules、overlay activePackId、panel 角色工房分頁+workshop.js、
  粉絲投稿指南。已驗證:npm test(packFormat+character 綠)、桌面版降級、test-ui 沙盒。
  未驗證:雲端 e2e(需部署後手動:匯入 sample sheet → 啟用 → onMessage 觸發)。
  設計:docs/designs/fan-extension-pack.md、ADR-003。
```

- [ ] **Step 5: Commit(若已授權)**

```bash
git add docs/fan-submission-guide.md README.md docs/ARCHITECTURE.md docs/HANDOFF.md
git commit -m "docs: 粉絲投稿指南+架構文件同步(角色工坊 Phase 1)"
```

---

### Task 11: 全量驗證(DoD)

**Files:** 無新改動;跑驗證並整理回報。

- [ ] **Step 1: 全測試**

Run: `cd yuupeek && npm test`
Expected: 除已知基線紅字(chatListener.test.js suite 載入失敗)外全綠;
packFormat.test.js 與 character.test.js 全過。把輸出原文留存到回報。

- [ ] **Step 2: 沙盒**

Run: `cd yuupeek && npm run test-ui` → http://localhost:3001
Expected: 角色會動;紅字僅限兩種已知例外。

- [ ] **Step 3: 桌面版**

Run: `cd yuupeek && npm start` → http://localhost:3000/panel
Expected: 五分頁正常;角色工房顯示降級提示;桌寵設定可存。

- [ ] **Step 4: 部署產物**

Run: `cd web && node sync.js`
Expected: 5 個 synced;`web/public/` 出現 packFormat.js、workshop.js。

- [ ] **Step 5: 最終回報**(禁寫「應該可以」;分「已驗證」「未驗證」兩節)

已驗證:上述 1–4 的實際輸出。
未驗證(需維護者部署後手動,雲端無本機一鍵驗證):
1. panel 匯入 `yuupeek/assets/sprites/sample/00_hurt_sheet.png` → 自動切 8 幀 → 存擴充包 → 啟用。
2. overlay console `onMessage('!痛', '測試員')`(先在桌寵設定綁 `!痛`→hurt)→ Yolia 播 hurt。
3. 停用(啟用內建 Yolia)→ 動畫回內建。
4. 舊資料庫(無 /packs、無 activePackId)→ overlay 一切照舊。

若未授權 commit,列出建議 commit 切分(Task 1-10 的訊息)供維護者採用。
