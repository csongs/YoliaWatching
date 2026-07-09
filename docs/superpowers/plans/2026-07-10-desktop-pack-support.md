# 桌面版角色工房支援 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm start` 的桌面版可完整使用角色工房(匯入/編輯/啟用/刪除角色包),資料存本機,零 Firebase 依賴(ADR-004)。

**Architecture:** packs 存 `<userDataDir>/packs.json`(仿 animations.json);`activePackId` 存 config.json;obsServer 加 5 條 panel API route;合併/清殘留的純邏輯放 packFormat.js 的新函數 `buildAnimationsUpdate`(可測);panel 桌面 adapter 換 fetch 實作並載入共用的 workshop.js/packFormat.js(obsServer 既有靜態服務直接可供)。

**Tech Stack:** Node(Electron main)、原生 http server、jest@30。

## Global Constraints

- **絕不 `git push`**;本機 commit 已獲授權(沿用本 session 授權),訊息尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 分支:`feature/desktop-pack-support`。
- 測試基線:`cd yuupeek && npm test`,除已知 `chatListener.test.js` suite 載入失敗外必須全綠(目前 55/55)。
- 格式演進(PLAYBOOK §3):config.json 新欄位 `activePackId` 為 optional;無 packs.json=行為不變;不改任何既有欄位語意。
- packFormat.js / character.js 不得出現「spritecook」字樣;workshop.js **零修改**(它只認 api adapter 介面)。
- 改共用檔 panel.html → `cd web && node sync.js` 必須成功(雲端副本同步)。

---

### Task 1: packFormat.js 新增 buildAnimationsUpdate(純函數)

**Files:**
- Modify: `yuupeek/src/packFormat.js`(factory return 前加函數,return 物件加一項)
- Test: `yuupeek/src/__tests__/packFormat.test.js`(追加 describe)

**Interfaces:**
- Produces: `buildAnimationsUpdate(base, packAnims, prevPackStates) → { snapshot, broadcast, packStates }`
  - `snapshot`:`{...base, ...packAnims}`,**不含 null**(給 getAnimations/commands.json 快照)
  - `broadcast`:snapshot 加上「上一包引入、且新集合蓋不掉的殘留鍵」設為 `null`(給 WS 廣播,引擎 null-delete)
  - `packStates`:本次 packAnims 的鍵陣列(呼叫端存起來當下次的 prevPackStates)
  - 殘留判定用 `Object.prototype.hasOwnProperty.call`(順帶修掉 HANDOFF 列的 prototype-prop 邊界)

- [ ] **Step 1: 寫失敗測試**(追加到 packFormat.test.js;require 解構加 `buildAnimationsUpdate`)

```js
describe('buildAnimationsUpdate(桌面版合併/清殘留,ADR-004)', () => {
  const base = { idle: { srcs: [PNG], loop: true }, wave: { srcs: [PNG], loop: false } };

  test('啟用擴充包:snapshot 含包動畫,packStates 回報包鍵', () => {
    const r = buildAnimationsUpdate(base, { hurt: { srcs: [PNG], loop: false } }, []);
    expect(Object.keys(r.snapshot)).toEqual(['idle', 'wave', 'hurt']);
    expect(r.broadcast.hurt).toEqual({ srcs: [PNG], loop: false });
    expect(r.packStates).toEqual(['hurt']);
  });

  test('停用:上一包的自訂狀態在 broadcast 設 null,snapshot 不含', () => {
    const r = buildAnimationsUpdate(base, null, ['hurt']);
    expect(r.snapshot.hurt).toBeUndefined();
    expect('hurt' in r.snapshot).toBe(false);
    expect(r.broadcast.hurt).toBeNull();
    expect(r.packStates).toEqual([]);
  });

  test('切換包:舊包獨有鍵清除,新包鍵保留', () => {
    const r = buildAnimationsUpdate(base, { dance: { srcs: [PNG], loop: true } }, ['hurt']);
    expect(r.broadcast.hurt).toBeNull();
    expect(r.broadcast.dance).toBeTruthy();
    expect(r.packStates).toEqual(['dance']);
  });

  test('上一包覆蓋過內建鍵:停用後回內建值,不設 null', () => {
    const r = buildAnimationsUpdate(base, null, ['wave']);
    expect(r.broadcast.wave).toEqual(base.wave);
  });

  test('prototype 屬性名(constructor)也能正確清除', () => {
    const r = buildAnimationsUpdate(base, null, ['constructor']);
    expect(r.broadcast.constructor).toBeNull();
  });

  test('無包無殘留:snapshot 與 broadcast 相同,等於 base', () => {
    const r = buildAnimationsUpdate(base, null, []);
    expect(r.snapshot).toEqual(base);
    expect(r.broadcast).toEqual(base);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd yuupeek && npx jest src/__tests__/packFormat.test.js`
Expected: FAIL — `buildAnimationsUpdate is not a function`

- [ ] **Step 3: 實作**(packFormat.js,`return {...}` 前加;return 加 `buildAnimationsUpdate`)

```js
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd yuupeek && npx jest src/__tests__/packFormat.test.js`
Expected: PASS(28+6 案例)

- [ ] **Step 5: Commit**

```bash
git add yuupeek/src/packFormat.js yuupeek/src/__tests__/packFormat.test.js
git commit -m "feat: buildAnimationsUpdate(合併+殘留清除純函數,ADR-004)"
```

---

### Task 2: obsServer 加 packs/active-pack 路由

**Files:**
- Modify: `yuupeek/src/obsServer.js`(pet-config 路由區塊後插入)
- Test: `yuupeek/src/__tests__/obsServer.test.js`(追加)

**Interfaces:**
- Consumes: `panelHandlers.getPacks/savePack/deletePack/getActivePackId/setActivePack`(Task 3 提供)。
- Produces(panel 桌面 adapter Task 4 依賴):
  - `GET  /panel/api/packs` → `{ key: pack }` 全量
  - `POST /panel/api/packs`(body=整個 pack)→ `{ ok: true }`
  - `POST /panel/api/packs/delete`(body=`{ key }`)→ `{ ok: true }`
  - `GET  /panel/api/active-pack` → `{ activePackId: string|null }`
  - `POST /panel/api/active-pack`(body=`{ activePackId: string|null }`)→ `{ ok: true }`

- [ ] **Step 1: 寫失敗測試**(追加到 obsServer.test.js;beforeEach 既有 server 可直接 setPanelHandlers)

```js
describe('pack routes (ADR-004)', () => {
  function fetchJson(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: 'localhost', port, path: urlPath, method,
        headers: { 'Content-Type': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  test('GET/POST packs 與 active-pack 走 panelHandlers', async () => {
    const calls = {};
    server.setPanelHandlers({
      getPacks:        () => ({ a_b: { id: 'a.b' } }),
      savePack:        (p) => { calls.saved = p; },
      deletePack:      (k) => { calls.deleted = k; },
      getActivePackId: () => 'a.b',
      setActivePack:   (id) => { calls.activated = id; },
    });

    expect((await fetchJson('GET', '/panel/api/packs')).json).toEqual({ a_b: { id: 'a.b' } });

    await fetchJson('POST', '/panel/api/packs', { id: 'a.b', name: 'x' });
    expect(calls.saved).toEqual({ id: 'a.b', name: 'x' });

    await fetchJson('POST', '/panel/api/packs/delete', { key: 'a_b' });
    expect(calls.deleted).toBe('a_b');

    expect((await fetchJson('GET', '/panel/api/active-pack')).json).toEqual({ activePackId: 'a.b' });

    await fetchJson('POST', '/panel/api/active-pack', { activePackId: null });
    expect(calls.activated).toBeNull();
  });

  test('無 panelHandlers 時 packs 路由回空值不炸', async () => {
    expect((await fetchJson('GET', '/panel/api/packs')).json).toEqual({});
    expect((await fetchJson('GET', '/panel/api/active-pack')).json).toEqual({ activePackId: null });
  });
});
```

(若既有 server 物件沒有 `setPanelHandlers` 方法名,以 obsServer.js 實際 export 的方法名為準——main.js 用的是 `obsServer.setPanelHandlers(...)`,應已存在。)

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd yuupeek && npx jest src/__tests__/obsServer.test.js`
Expected: FAIL(404 或 undefined json)

- [ ] **Step 3: 實作**(obsServer.js,`/panel/api/pet-config` POST 區塊之後插入)

```js
    // ── Pack routes(ADR-004,桌面版角色工房)────────────────────────────────
    if (req.url === '/panel/api/packs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(panelHandlers?.getPacks?.() ?? {}));
      return;
    }

    if (req.url === '/panel/api/packs' && req.method === 'POST') {
      readBody(req).then(body => {
        panelHandlers?.savePack?.(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }

    if (req.url === '/panel/api/packs/delete' && req.method === 'POST') {
      readBody(req).then(body => {
        panelHandlers?.deletePack?.(body.key);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }

    if (req.url === '/panel/api/active-pack' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ activePackId: panelHandlers?.getActivePackId?.() ?? null }));
      return;
    }

    if (req.url === '/panel/api/active-pack' && req.method === 'POST') {
      readBody(req).then(body => {
        panelHandlers?.setActivePack?.(body.activePackId ?? null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd yuupeek && npx jest src/__tests__/obsServer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add yuupeek/src/obsServer.js yuupeek/src/__tests__/obsServer.test.js
git commit -m "feat: obsServer 加 packs/active-pack panel 路由(ADR-004)"
```

---

### Task 3: main.js 整合(packs.json 載入、handlers、廣播)+ .gitignore

**Files:**
- Modify: `yuupeek/main.js`(L33-35 require 區、L62-66 animations 區後、L205-228 getAnimations/saveAnimations、panelHandlers 物件內)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 1 `buildAnimationsUpdate`、既有 `packToAnimations`(packFormat.js);Task 2 的路由呼叫這裡的 handlers。
- Produces: `panelHandlers.getPacks() → { key: pack }`、`savePack(pack)`、`deletePack(key)`、`getActivePackId() → string|null`、`setActivePack(idOrNull)`;`getAnimations()` 的 `animations` 含啟用中包的動畫。

- [ ] **Step 1: require 與狀態**(L35 `createObsServer` require 之後加)

```js
const { packToAnimations, buildAnimationsUpdate } = require('./src/packFormat');
```

animations 區(L62-66 `userAnimations` 定義)之後加:

```js
// 角色包(ADR-004):整包存 packs.json,activePackId 存 config.json
const packsPath = path.join(userDataDir, 'packs.json');
let packs = (() => {
  try { return JSON.parse(fs.readFileSync(packsPath, 'utf8')); }
  catch { return {}; }
})();
let prevPackStates = [];   // 上一次廣播時啟用包的狀態鍵(清殘留用)

const packKeyOf = (id) => String(id).replace(/\./g, '_');

function activePackAnimations() {
  const id = config.activePackId;
  if (!id) return null;
  const pack = packs[packKeyOf(id)];
  if (!pack) return null;
  try { return packToAnimations(pack); }
  catch (e) { console.warn('[pack] 轉換失敗,忽略啟用中的包:', e.message); return null; }
}

function animationsUpdate() {
  return buildAnimationsUpdate(
    { ...DEFAULT_ANIMATIONS, ...userAnimations },
    activePackAnimations(),
    prevPackStates
  );
}

function savePacksFile() {
  fs.writeFileSync(packsPath, JSON.stringify(packs, null, 2), 'utf8');
}

function broadcastAnimations() {
  const u = animationsUpdate();
  prevPackStates = u.packStates;
  obsServer?.broadcast({ setAnimations: u.broadcast });
}
```

- [ ] **Step 2: panelHandlers 加 pack handlers**(`getAnimations:` 之前插入)

```js
    getPacks: () => packs,
    savePack: (pack) => {
      packs[packKeyOf(pack.id)] = pack;
      savePacksFile();
      broadcastAnimations();   // 編輯的是啟用中的包 → 立即生效(對齊雲端 on() 訂閱行為)
    },
    deletePack: (key) => {
      delete packs[key];
      savePacksFile();
      broadcastAnimations();
    },
    getActivePackId: () => config.activePackId ?? null,
    setActivePack: (idOrNull) => {
      const cfgPath = path.join(userDataDir, 'config.json');
      const raw = readUserCfg(cfgPath);
      if (idOrNull) raw.activePackId = idOrNull;
      else delete raw.activePackId;
      config.activePackId = idOrNull ?? undefined;
      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
      broadcastAnimations();
    },
```

- [ ] **Step 3: 既有兩處改用合併結果**

`getAnimations`(L205-208)改為:

```js
    getAnimations: () => ({
      animations: animationsUpdate().snapshot,
      defaults:   DEFAULT_ANIMATIONS,
    }),
```

`saveAnimations` 尾端的廣播行(L227)`obsServer?.broadcast({ setAnimations: { ...DEFAULT_ANIMATIONS, ...userAnimations } });` 改為:

```js
      broadcastAnimations();
```

- [ ] **Step 4: .gitignore 加一行**(dev 模式 userDataDir=yuupeek/,packs.json 會落在 repo 內)

在 `# 隱私設定（含 API key）` 區塊前加:

```
# 桌面版本機資料(dev 模式落在 repo 內)
yuupeek/packs.json
yuupeek/animations.json
```

(animations.json 同理補上;先 `git ls-files yuupeek/animations.json` 確認未被追蹤,已追蹤則不加該行。)

- [ ] **Step 5: 驗證**

Run: `cd yuupeek && npm test`
Expected: 全綠(除已知 chatListener 紅字;main.js 無直接測試,靠 Task 1/2 的純函數與路由測試覆蓋)。
Run: `node --check yuupeek/main.js`
Expected: 無輸出。

- [ ] **Step 6: Commit**

```bash
git add yuupeek/main.js .gitignore
git commit -m "feat: 桌面版 pack 儲存/啟用/廣播(packs.json+activePackId,ADR-004)"
```

---

### Task 4: panel.html 桌面 adapter + 載入 workshop + 移除降級提示

**Files:**
- Modify: `yuupeek/renderer/panel.html`(#workshop 區塊、`if (!IS_WEB)` 降級區塊、desktop adapter stubs、desktop init)

**Interfaces:**
- Consumes: Task 2 的 5 條路由;obsServer 既有靜態服務(`/src/packFormat.js`、`/renderer/workshop.js` 直接可取,MIME 表含 .js)。
- Produces: 桌面模式下 `window.Workshop` 完整可用;workshop.js 零修改。

- [ ] **Step 1: 移除降級提示**——刪掉 #workshop 內的 `workshop-desktop-note` card div(保留 `<div id="workshop-root"></div>`),並刪掉 script 裡的:

```js
  if (!IS_WEB) {
    document.getElementById('workshop-desktop-note').style.display = '';
  }
```

- [ ] **Step 2: desktop adapter 換實作**——else 分支(約 L900+)把 5 個 stub:

```js
        getPacks:        () => Promise.resolve({}),
        savePack:        () => Promise.reject(new Error('僅雲端版支援')),
        deletePack:      () => Promise.reject(new Error('僅雲端版支援')),
        getActivePackId: () => Promise.resolve(null),
        setActivePack:   () => Promise.reject(new Error('僅雲端版支援')),
```

換成:

```js
        getPacks:        () => fetch('/panel/api/packs').then(r => r.json()),
        savePack:        (pack) => post('/panel/api/packs', pack),
        deletePack:      (key) => post('/panel/api/packs/delete', { key }),
        getActivePackId: () => fetch('/panel/api/active-pack').then(r => r.json()).then(d => d.activePackId ?? null),
        setActivePack:   (idOrNull) => post('/panel/api/active-pack', { activePackId: idOrNull }),
```

- [ ] **Step 3: desktop init 載入共用腳本**——else 分支的 `api = {...}` 之後、`apiReady = true` 之前加:

```js
      await loadScript('/src/packFormat.js');
      await loadScript('/renderer/workshop.js');
```

- [ ] **Step 4: 驗證(自動化部分)**

Run: `cd web && node sync.js`
Expected: 6 行 synced 無錯(panel.html 副本更新)。
Run: `cd yuupeek && npm test`
Expected: 維持基線。

- [ ] **Step 5: Commit**

```bash
git add yuupeek/renderer/panel.html
git commit -m "feat: panel 桌面模式啟用角色工房(adapter fetch 實作+載入共用模組)"
```

---

### Task 5: 端到端驗證(維護者手動)+ 文件

**Files:**
- Modify: `docs/ARCHITECTURE.md`(§2 表格 panel 行或 §5 附註,一句話)、`docs/HANDOFF.md`(狀態)

- [ ] **Step 1: 維護者 `npm start` 實測清單**(這正是本功能的目的,由維護者在有畫面的終端機執行):

1. 角色工房分頁不再顯示「僅雲端版支援」,出現包清單(內建 Yolia 啟用中)。
2. ＋新增擴充包 → 從 spritesheet 匯入 `assets/sprites/sample/00_hurt_sheet.png` → 自動切 8 幀 → 狀態名 hurt → 加入 → 儲存包 → 立即啟用。
3. 桌寵設定綁指令 `!痛` → hurt;桌面 OBS 預覽(或 http://localhost:3000/)確認觸發播放。
4. 切回內建 Yolia → hurt 殘留清除(觸發 `!痛` 回退 idle 行為)。
5. 重啟 app → 包還在(packs.json 持久化)、啟用狀態還原。

- [ ] **Step 2: 文件**——ARCHITECTURE §2 桌面版欄補「角色包:`<userDataDir>/packs.json`(ADR-004)」;HANDOFF 補一條狀態(桌面版角色工房已支援,已驗證=npm test+路由測試,未驗證=維護者手動清單)。

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/HANDOFF.md
git commit -m "docs: 桌面版角色工房支援文件同步(ADR-004)"
```
