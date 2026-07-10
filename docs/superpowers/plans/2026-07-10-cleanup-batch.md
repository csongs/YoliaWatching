# 小尾巴清理+測試債 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清掉 HANDOFF 列的角色包小尾巴(7 項)+既有技術債(chatListener/chatProcessor 測試、DEPLOY.md、README、dead code、sync 守門測試),完成後測試基線恢復**全綠**並改回鐵律 4。

**Architecture:** 全部是既有檔案的小修;唯二新檔=兩個測試檔+一個 sync 守門測試。維護者已拍板:sync 維持現狀+守門測試;刪 frames.js、留 detector.js(加註記)。

**Tech Stack:** jest@30(node+jsdom)、jest.mock(tmi.js/googleapis)。

## Global Constraints

- **絕不 `git push`**;本機 commit 已授權,訊息尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。分支 `feature/cleanup-batch`。
- 每個任務後 `cd yuupeek && npm test` 不得新增紅字;**Task 8 完成後必須全綠**
  (實際落點 8/8 suites:原 6 suite − 刪除的 frames 無 suite + 新增 syncManifest/chatProcessor)。
- 改共用檔(panel.html/workshop.js/character.js/chatProcessor.js/packFormat.js)→ `cd web && node sync.js` 成功。
- `web/public/index.html` 是雲端專屬檔可直接改;其他 web/public/ 副本不准改。
- 格式演進:validatePack 收緊 srcs 字元集屬「匯入層驗證」,不影響既有已入庫資料的讀取(overlay 不驗證);spec §8 同步記載。

---

### Task 1: packFormat.js — isValidStateName + 精確位元組 + srcs 字元集

**Files:** Modify `yuupeek/src/packFormat.js`、`yuupeek/src/__tests__/packFormat.test.js`、`docs/specs/character-pack-format.md` §8

- [ ] 測試(追加;require 加 `isValidStateName`):

```js
describe('isValidStateName', () => {
  test('合法/非法狀態名', () => {
    expect(isValidStateName('hurt')).toBe(true);
    expect(isValidStateName('run_left2')).toBe(true);
    expect(isValidStateName('Bad')).toBe(false);
    expect(isValidStateName('1abc')).toBe(false);
    expect(isValidStateName(null)).toBe(false);
  });
});

describe('validatePack 追加規則', () => {
  test('srcs 含引號/空白/角括號 → 拒絕', () => {
    for (const bad of ['data:image/png;base64,x" onerror="x', 'data:image/png;base64,a b', 'https://x/<s>.png']) {
      expect(validatePack(extPack({ animations: { hurt: { srcs: [bad] } } })).ok).toBe(false);
    }
  });

  test('4MB 上限以 UTF-8 位元組計', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024);
    expect(validatePack(extPack({ animations: { hurt: { srcs: [big] } } })).ok).toBe(false);
  });
});
```

- [ ] 實作:`isValidStateName = (name) => typeof name === 'string' && STATE_RE.test(name)`,加入 return 物件;srcs 檢查加 `&& !/[\s"'<>\\]/.test(s)`(錯誤訊息:動畫「X」的幀圖網址含空白或引號等非法字元);大小改 `new TextEncoder().encode(json).length`(Node≥11 全域有 TextEncoder)。
- [ ] spec §8 規則 3 補「srcs 不得含空白、單雙引號、角括號、反斜線(2026-07-10 收緊,匯入層驗證)」;上限註明以 UTF-8 位元組計。
- [ ] `npx jest src/__tests__/packFormat.test.js` 全綠 → commit `fix: validatePack srcs 字元集收緊+4MB 改精確位元組;匯出 isValidStateName`

### Task 2: web overlay purge 換用 buildAnimationsUpdate

**Files:** Modify `web/public/index.html`(applyAllAnimations 與 prevPackStates 區塊)

- [ ] 把手寫的 `stale` 過濾(`s in baseline`)換成:

```js
    function applyAllAnimations(config) {
      const u = PackFormat.buildAnimationsUpdate(
        { ...DEFAULT_ANIMATIONS, ...(config.animations ?? {}) },
        packAnimations,
        prevPackStates
      );
      prevPackStates = u.packStates;
      char.setAnimations(u.broadcast);
    }
```

(語意等價:原本「baseline→pack 兩次 setAnimations」合併為一次 broadcast 物件;引擎逐狀態合併,結果相同,且修掉 prototype-prop 邊界。)
- [ ] `npm test` 基線不變 → commit `refactor: web overlay 殘留清除改用 buildAnimationsUpdate(修 prototype-prop 邊界)`

### Task 3: workshop.js 三修

**Files:** Modify `yuupeek/renderer/workshop.js`

- [ ] (a) 孤兒計時器+編輯器消失:`renderEditor()` 末尾加 `if (editingAnim) renderFrameEditor(); else stopPreview();`,並刪除各呼叫端(editAnim/withSel/setMs/setLoop)重複的 `renderFrameEditor()` 呼叫(單一出口)。
- [ ] (b) manifest 輸入不再被還原:`renderEditor()` 開頭加 `if (document.getElementById('wk-id')) readManifest();`(編輯器 DOM 存在=使用者可能改過欄位,先收進 working 再重繪)。
- [ ] (c) `addAnim` 的 inline regex 換 `PackFormat.isValidStateName(name)`。
- [ ] `node --check` + `cd web && node sync.js` + 靜態追蹤五流程(開編輯器→刪別的動畫:編輯器保留且預覽跟著動畫清單同步;ms 改動後 manifest 輸入不丟)→ commit `fix: 工房編輯器單一重繪出口(孤兒計時器/manifest 還原)+狀態名驗證去重`

### Task 4: main.js 廣播閘門

**Files:** Modify `yuupeek/main.js`

- [ ] `savePack`/`deletePack` 只在動到啟用中的包時廣播:

```js
    savePack: (pack) => {
      packs[packKeyOf(pack.id)] = pack;
      savePacksFile();
      if (pack.id === config.activePackId) broadcastAnimations();
    },
    deletePack: (key) => {
      const wasActive = config.activePackId && packKeyOf(config.activePackId) === key;
      delete packs[key];
      savePacksFile();
      if (wasActive) broadcastAnimations();
    },
```

- [ ] `node --check yuupeek/main.js` + `npm test` → commit `perf: 桌面版存/刪非啟用包不再廣播`

### Task 5: sync 守門測試

**Files:** Create `yuupeek/src/__tests__/syncManifest.test.js`

- [ ] 內容:

```js
// sync 守門(維護者決策 2026-07-10):HTML 引用的本地 js 必須在 sync.js 清單內,
// 漏登記=此測試紅字,而不是部署後靜默 404。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 部署時由其他機制產生、不經 sync.js 的檔案
const GENERATED = new Set(['firebase-config.js']);

function syncedBasenames() {
  const src = read('web/sync.js');
  const names = new Set();
  for (const m of src.matchAll(/'web\/public\/([\w./-]+\.js)'/g)) names.add(path.basename(m[1]));
  return names;
}

function referencedLocalJs(html) {
  const names = new Set();
  for (const m of html.matchAll(/<script src="\.\/([\w./-]+\.js)"/g)) names.add(path.basename(m[1]));
  for (const m of html.matchAll(/loadScript\('\/([\w-]+\.js)'\)/g)) names.add(m[1]);
  return names;
}

test('index.html/panel.html 引用的本地 js 都在 sync 清單或生成清單內', () => {
  const synced = syncedBasenames();
  const refs = new Set([
    ...referencedLocalJs(read('web/public/index.html')),
    ...referencedLocalJs(read('yuupeek/renderer/panel.html')),
  ]);
  const missing = [...refs].filter(n => !synced.has(n) && !GENERATED.has(n));
  expect(missing).toEqual([]);
});
```

(panel 桌面模式的 `loadScript('/src/...')`/`/renderer/...` 路徑含斜線,不會被上面 loadScript regex 抓到——它們讀的是源頭檔,本來就不需 sync,刻意排除。)
- [ ] `npx jest src/__tests__/syncManifest.test.js` 綠 → commit `test: sync 清單守門(HTML 引用的 js 漏登記即紅字)`

### Task 6: dead code——刪 frames.js、註記 detector.js

**Files:** Delete `yuupeek/src/frames.js`;Modify `yuupeek/src/detector.js`(檔頭註解)

- [ ] `grep -rn "frames.js\|require.*frames'" yuupeek web --include=*.js --include=*.html` 確認零引用(排除 sprites/frames 資料夾路徑字樣)→ `git rm yuupeek/src/frames.js`。
- [ ] detector.js 檔頭加:`// 尚未接線(桌面版藍圖功能:視窗標題偵測)。production 無 require,僅 detector.test.js 引用。勿當活程式碼修改;接線前先讀 docs/ARCHITECTURE.md §11。`
- [ ] `npm test`(detector suite 仍綠)→ commit `chore: 刪除 dead code frames.js;detector.js 加未接線註記`

### Task 7: chatProcessor.test.js(新)

**Files:** Create `yuupeek/src/__tests__/chatProcessor.test.js`

- [ ] 覆蓋(全部純函數,直接 require):
  - `computeState`:門檻排序取最高符合、無門檻回 idle、恰好等於 min。
  - `buildHandlers`:command 的 match 字串/陣列都建進 commandMap;keyword 建 regex 且特殊字元跳脫;未知 trigger 被忽略。
  - `processMessage` command:cost 不足 → costDenied+提示;cost 扣除+yolia_see 增減 clamp 0–100;`animation` → animOnly+resetState=computeState;`{user}` 替換。
  - `processMessage` keyword:非指令先 +1;命中再疊 kw.yolia_see;`{word}`/`{user}` 替換;未指定 animation → 'wave';animOnly=true。
  - `processMessage` 一般訊息:+1、100 封頂、state=computeState、speech=null。

```js
const { buildHandlers, computeState, processMessage } = require('../chatProcessor');

describe('computeState', () => {
  const thresholds = [
    { trigger: 'threshold', min: 30, state: 'peek' },
    { trigger: 'threshold', min: 70, state: 'cheer' },
  ];
  test('取最高符合門檻', () => {
    expect(computeState(75, thresholds)).toBe('cheer');
    expect(computeState(69, thresholds)).toBe('peek');
    expect(computeState(30, thresholds)).toBe('peek');
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
```

- [ ] 全綠 → commit `test: chatProcessor 補測試(command/keyword/threshold 核心路徑)`

### Task 8: chatListener.test.js 重寫(基線紅字歸零)

**Files:** Overwrite `yuupeek/src/__tests__/chatListener.test.js`

- [ ] 以 jest.mock 隔離外部依賴,測 createChatListener 的可觀察行為:

```js
jest.mock('tmi.js', () => {
  const instances = [];
  class Client {
    constructor(opts) { this.opts = opts; this.handlers = {}; instances.push(this); }
    on(evt, cb) { this.handlers[evt] = cb; }
    connect() { return Promise.resolve(); }
    disconnect() { this.disconnected = true; }
    readyState() { return 'OPEN'; }
  }
  return { Client, __instances: instances };
});
jest.mock('googleapis', () => ({ google: { youtube: jest.fn(() => ({})) } }));

const tmi = require('tmi.js');
const { createChatListener } = require('../chatListener');

function makeListener(interactions = [], smInit = { yolia_see: 0, state: 'idle' }) {
  const config = {
    twitch: { enabled: true, channel: 'tester' },
    youtube: { enabled: false },
    soop: { enabled: false },
    interactions,
  };
  const sm = { ...smInit };
  const broadcasts = [];
  const listener = createChatListener(config, sm, (p) => broadcasts.push(p));
  return { listener, sm, broadcasts };
}

function emitTwitch(text, username = '觀眾') {
  const client = tmi.__instances[tmi.__instances.length - 1];
  client.handlers['message'](null, { 'display-name': username }, text);
}

beforeEach(() => { tmi.__instances.length = 0; jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('一般訊息:+1 並廣播 value/state', () => {
  const { listener, sm, broadcasts } = makeListener();
  listener.start();
  emitTwitch('安安');
  expect(sm.yolia_see).toBe(1);
  expect(broadcasts[0]).toMatchObject({ value: 1, animOnly: false });
  listener.stop();
});

test('指令動畫:animOnly 廣播+3 秒後 resetState 廣播', () => {
  const { listener, broadcasts } = makeListener([
    { trigger: 'command', match: '!跳', animation: 'jump' },
  ]);
  listener.start();
  emitTwitch('!跳');
  expect(broadcasts[0]).toMatchObject({ state: 'jump', animOnly: true });
  jest.advanceTimersByTime(3000);
  expect(broadcasts[1]).toMatchObject({ state: 'idle' });
  listener.stop();
});

test('cost 不足:costDenied 提示廣播+3 秒後回復廣播', () => {
  const { listener, broadcasts } = makeListener([
    { trigger: 'command', match: '!貴', animation: 'cheer', cost: 50 },
  ]);
  listener.start();
  emitTwitch('!貴');
  expect(broadcasts[0].speech).toContain('幽視值不足');
  jest.advanceTimersByTime(3000);
  expect(broadcasts).toHaveLength(2);
  listener.stop();
});

test('updateHandlers 後新指令生效', () => {
  const { listener, broadcasts } = makeListener();
  listener.start();
  listener.updateHandlers([{ trigger: 'command', match: '!新', animation: 'cry' }]);
  emitTwitch('!新');
  expect(broadcasts[0]).toMatchObject({ state: 'cry', animOnly: true });
  listener.stop();
});

test('getStatus 形狀與 stop 斷線', () => {
  const { listener } = makeListener();
  listener.start();
  const s = listener.getStatus();
  expect(s).toMatchObject({ twitch: { connected: true }, youtube: { live: false }, soop: { connected: false } });
  listener.stop();
  expect(tmi.__instances[0].disconnected).toBe(true);
});
```

  注意:start() 會排 YouTube 輪詢 setTimeout(fake timers 下不觸發網路);
  stop() 清掉;若 fake timers 造成 youtubeInterval 的 setTimeout(scheduleYt, 0) 在
  advanceTimersByTime 時執行,config.youtube.enabled=false 使 fetchYouTubeMessages
  直接返回,無網路呼叫——實測若有非同步 open handle 警告,在 afterEach 補
  `jest.clearAllTimers()`。
- [ ] `npm test` **6/6 suites 全綠** → commit `test: chatListener 測試重寫(對齊 createChatListener API,基線紅字歸零)`

### Task 9: 文件收官

**Files:** Modify `CLAUDE.md`、`docs/PLAYBOOK.md`、`docs/ARCHITECTURE.md`、`docs/HANDOFF.md`、`web/DEPLOY.md`、`README.md`

- [ ] CLAUDE.md:鐵律 4 改回「`cd yuupeek && npm test` 必須全綠」;技術債清單刪掉已處理項(DEPLOY.md、detector/frames、測試基線紅字、chatProcessor 無測試),保留 API keys 一條。
- [ ] PLAYBOOK §1 DoD 第一條同步改全綠;§7 待修清單刪 DEPLOY.md/README 兩項。
- [ ] ARCHITECTURE §10 基線描述改全綠(6 suites);§11 表:frames.js 改「已刪除(2026-07-10)」、chatListener 紅字行改已修復。
- [ ] web/DEPLOY.md 整檔改為三行指向 README(單一事實源):

```markdown
# 部署說明(已併入 README)

本檔曾記載以 FIREBASE_TOKEN 部署的舊流程,已過時。
正確流程(FIREBASE_SERVICE_ACCOUNT + GitHub Actions)見根目錄 [README.md](../README.md)。
```

- [ ] README:test-ui 描述改「角色/動畫沙盒頁 test.html(port 3001,不需聊天室)」;「5 個 secret」改 6。
- [ ] HANDOFF 補狀態(小尾巴+技術債清理完成、基線全綠)。
- [ ] `npm test` 全綠 → commit `docs: 測試基線恢復全綠,鐵律/待修清單/DEPLOY 指向收官`
