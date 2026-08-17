# HANDOFF — session 交接檔

> 用途：任何 session（不論模型大小）中斷或收尾時，把「做到哪、接下來做什麼」寫在這裡。
> 下一個 session 開場：先讀 CLAUDE.md，再讀本檔的「目前狀態」。
> 維護規則：完成一項就把狀態改成 ✅ 並補一句結果；新發現的坑寫進「地雷區」。

## 目前狀態（2026-08-16 二，互動規則改事件類型導向 + 面板簡化）

- 起因：同一天的後續工作。維護者先要求簡化面板「桌寵設定」的互動編輯表單（怕太複雜），
  接著提出想把「觸發條件/狀態/對話泡泡/動作」四塊抽象化、格式化，最後定案：觸發條件要能
  選粗略分類或細項、可複選，且要跟 chat-monitor 的 `event_type`/`category` 詞彙對齊——
  等於順帶解決了上一輪 HANDOFF 記的「明確排除在範圍外」那項（斗內/訂閱/Raid 現在可以配了）。
- **已完成**：
  - 互動規則格式改版：`{eventTypes[], matchMode?, match?, minEnergy?, energyDelta?, speech?,
    action?}`，取代舊的 `trigger:"keyword"/"command"` 二分。`chatProcessor.js` 新增
    `normalizeInteraction()`（舊格式自動轉新格式，讀取端正規化，既有 config.json 不用手動遷移）、
    `buildEventHandlers()`、`processEvent()`（吃事件物件而不是純文字，找第一條命中的規則，
    沒命中回 `null`）。`computeState()`/`planMessageEffects()` 沒變。
  - 新建 `yuupeek/src/chatMonitorEventTypes.js`：chat-monitor `public/labels.js` 的
    event_type→category 小抄本（兩個是各自獨立的 npm 專案，沒有共用模組機制，只能各留一份，
    chat-monitor 改分類要記得回來對）。
  - `chatMonitorClient.js` 拿掉 `event_type!=='chat'` 的過濾器，改成每個事件都交給
    `processEvent` 判斷——這是**刻意的範圍擴大**（PLAYBOOK §5 升級判準過的決策，維護者
    在對話中明確拍板「做完」）。
  - **一般聊天 +1 幽視值不再是引擎內建行為**，改成一條資料驅動的 catch-all 規則
    （`default.config.json` 的 `c_base`：`eventTypes:["chat"]`、不填 `match`、`energyDelta:1`，
    排在規則清單最後當 fallback）——對齊維護者「客製化針對什麼事件才能增加/減少」的要求。
  - `default.config.json` 既有指令全部轉新格式；`!香菜` 原本的 `cost:10` 拿掉了（這次簡化
    決定不保留消耗機制，改成無條件可用，已跟維護者確認過）。
  - 面板「桌寵設定」互動編輯表單重寫：拿掉「門檻」選項（既有門檻規則資料不刪，存在
    `hiddenThresholds` closure 變數裡，save 時原樣接回去，只是不給編輯）；新表單＝觸發事件
    多選（`<select multiple>`，粗略分類＋細項混著選）＋比對方式（關鍵詞/指令）＋觸發文字＋
    觸發門檻＋幽視值±＋動作（可留白＝不指定）＋對話泡泡。
  - OBS overlay 的 yolia_see 數字/進度條隱藏（`display:none`），對話泡泡不受影響；
    `character.js` 完全沒動，之後要拿回來顯示只要刪那兩行 style。
  - 面板互動表單追加：觸發事件多選預設收合成只剩 3 個粗略分類（維護者反應「平台很多要按
    好多」），細項要點連結才展開；「動作」欄位旁加「▶ 試播」按鈕（呼叫既有的
    `api.playAnimation`，跟角色工房「試播」同一支 API），取代原本想做的縮圖預覽。
  - **修好一個真的 bug**：`main.js` 的 `broadcastState()` 把整包 `data`（含 `speech`）存進
    `welcomeData`，導致任何新連線(overlay 開啟/重整)都會重播上一次的對話泡泡文字，即使
    那則訊息是好幾分鐘前的——維護者實測發現「一打開頁面、什麼都沒發生就看到泡泡」。
    修法：`setWelcomeData` 存進去的快照明確把 `speech` 蓋成 `null`，即時 `broadcast(data)`
    不受影響照樣正常顯示。這不是這次改動造成的，是既有邏輯的舊坑，這次順手修掉。
  - **上面那個修完後，維護者截圖回報還是有個黑色藥丸形狀浮在角色頭上**——查出來不是對話
    泡泡本身（`#speech-bubble` 是白色，且已經修好不會亂顯示），是**`#hud` 外層容器自己的
    深色背景/圓角/padding**：隱藏 yolia_see 數字/進度條那兩個子元素時，只對它們個別加了
    `display:none`，沒把包住它們的 `#hud` 外框樣式一起拿掉，導致裡面空空如也時還是畫出一個
    有背景色的空圓角方塊。修法：`#hud` 拿掉背景/圓角/padding/border/backdrop-filter，變成
    純定位容器；`#speech-bubble` 本來就有自己完整的白色泡泡樣式，不受影響。
- 驗證：`cd yuupeek && npm test` 9 suites / 143 tests 全綠（`chatProcessor.test.js`/
  `chatMonitorClient.test.js` 大改，新增涵蓋 normalizeInteraction/事件比對/catch-all 規則/
  無規則命中回 null 等案例）。**手動驗證仍待維護者**：面板互動編輯表單實際操作一輪
  （新增/刪除規則、多選觸發事件、存檔後重新整理資料還在）；用 chat-monitor 的模擬事件 API
  送一筆 `cheer`/`superchat` 事件，確認有設對應規則時桌寵真的會反應。
- **文件同步**：CLAUDE.md 鐵律 2 改寫（不再是「只接 chat」，改成描述新規則格式）；
  ARCHITECTURE.md §4/§6/§7/§11/§12、PLAYBOOK.md §5/§8 一併更新。

## 前次狀態（2026-08-16，拿掉 Firebase 雲端版，聊天連線改接 chat-monitor）

- 起因：維護者提案「先去除 Firebase 部署，網頁跟桌寵都讀同一份資料」，經過一輪逐項確認
  （process 模型、即時事件走 WS 還是 SQLite、設定存放、產品定位等 10 個決策點，逐一問過
  維護者拍板）後動工。最終定案：**不是把兩個部署模式合併，是砍掉雲端版，聊天連線的職責
  轉移給既有的 `chat-monitor/`**（原本是獨立測試工具，這次升格為正式聊天來源，但刻意維持
  獨立 process，不合併進 Electron、不自動 spawn）。
- **已完成**：
  - 刪除 `web/`、`.github/workflows/deploy.yml`（Firebase 部署流程整個拿掉）。
  - 新建 `yuupeek/src/chatMonitorClient.js`，取代 `yuupeek/src/chatListener.js`（已刪）：
    桌寵不再自己接 Twitch IRC/YouTube API/SOOP，改當 chat-monitor 的
    `ws://127.0.0.1:3100/ws` 唯讀 client，只處理 `event_type==='chat'`（斗內/訂閱/Raid
    等事件這次刻意不接，是範圍決策不是漏接）。斷線每 3 秒靜默重試。
  - `yuupeek/src/youtubePollPolicy.js` 一併刪除（連同它的測試）——已用不到：chat-monitor
    的 YouTube connector 早就換成免 API Key 的 `youtube-chat-next` 爬蟲套件，quota 節流
    邏輯整個不需要了。
  - `main.js`／`obsServer.js`／`panel.html` 拿掉了 Twitch/YouTube/SOOP 平台設定 UI 與
    對應 API（getConfig/saveConfig/getEnv/saveEnv/checkYouTubeLive 全刪）——這些設定
    現在只在 chat-monitor 自己的頁面（`http://127.0.0.1:3100`）改。`panel.html` 的
    Firebase 登入/DataAdapter 雙模式也整個拿掉，只剩桌面模式。
  - `default.config.json` 移除 `twitch`/`youtube`/`soop` 欄位（桌寵不再管這塊）。
  - `.gitignore` 清掉所有 `web/` 相關規則。
  - CLAUDE.md、docs/ARCHITECTURE.md、docs/PLAYBOOK.md 三份全文改寫，反映新架構。
- 驗證：`cd yuupeek && npm test` 9 suites / 134 tests 全綠（新增 `chatMonitorClient.test.js`，
  刪除 `chatListener.test.js`/`youtubePollPolicy.test.js`/`syncManifest.test.js`）。
  **手動驗證仍待維護者**：`cd chat-monitor && npm start` 後再 `cd yuupeek && npm start`，
  panel「模組狀態」分頁應顯示聊天室已連線；OBS overlay 對真的聊天訊息應該還有反應（幽視值/
  動畫）；chat-monitor 沒開時桌寵應該安靜不報錯，panel 燈號顯示未連線。
- **明確排除在這次範圍外，之後若要做請先讀 PLAYBOOK §5 升級判準**：斗內/訂閱/Raid 等
  chat-monitor 事件接進互動規則系統（需要新的規則格式，不是這次的自然延伸）；聊天監聽合併
  進同一個 process（這次決定維持解耦）。

## 前次狀態（2026-07-25 七，架構審查第五輪——收斂 DEFAULT_ANIMATIONS 三份副本）

- 起因:同一次 session 第七次操作。前六輪都聚焦在 panel.html/main.js/obsServer.js/
  pack-market 子系統這個熱點,這輪改查 CLAUDE.md 自己文件裡明寫的「鐵律 5」——
  預設動畫有三份手抄副本(main.js、index.html 的兩份 `DEFAULT_ANIMATIONS`,加上
  character.js 內建 fallback 表),這條規則本身就是「已知重複，改一處要記得改三處」
  的警告,存在了很久卻沒人真的收斂過。查證後三份仍然都在,決定收斂。
- 新增 `yuupeek/src/defaultAnimations.js`(isomorphic,經 sync.js 同步):唯一的
  `DEFAULT_ANIMATIONS` 資料源頭。`main.js` 改 `require`,`web/public/index.html`
  改載入 script 引用全域。
- `character.js` 改造:`createCharacter()` 新增 `defaultAnimations` 選項,內建
  fallback 表改成用既有的 `frames()` helper 從這個選項**衍生**,不再手寫第三份。
  三個呼叫點(index.html、obs-overlay.html、test.html)都補上載入
  `defaultAnimations.js` + 傳入這個選項;character.test.js 的 `makeChar()` fixture
  也改用真正的共用資料,不再是測試專用假資料。
- **順手修正一個小落差**:character.js 原本的內建表少了 `watch_excited`(ARCHITECTURE.md
  舊版明確記過這件事),現在從共用資料衍生後自動補齊,三個平台的 fallback 行為完全一致。
  合併前已逐一核對舊版 9 個手寫項目與共用資料的 folder/frames/ms/loop,確認衍生結果
  與原本行為**完全相同**(ms 全部顯式帶入,原本靠 `?? FRAME_MS` 隱式預設的幾項現在
  顯式寫 150,數值相同無感)。
- 文件同步:CLAUDE.md 鐵律 5、ARCHITECTURE.md §2/§5/§8/§11/§12 都提到這個舊的
  「三份副本」框架,已一併更新為「單一源頭」的現況描述;測試套件計數(11 suites/149
  tests)也順便校正(舊文件卡在 10 suites/131 tests)。
- 驗證:`cd yuupeek && npm test` 11 suites / 149 tests 全綠(新增
  `defaultAnimations.test.js`,`character.test.js` 用真實共用資料重跑通過)。
  main.js/defaultAnimations.js/character.js 過 `node --check`;index.html/
  obs-overlay.html/test.html 內嵌 script 都過語法解析。**手動驗證仍待維護者**:
  三個平台(雲端 overlay、桌面 overlay、test.html 沙盒)角色動畫應與改動前肉眼無異,
  額外多一個 `watch_excited` 狀態在 config 到達前也能正常 fallback 播放。

## 目前狀態（2026-07-25 六，雲端/桌面功能對等盤點+文件過時清理）

- 起因:維護者要求盤點雲端版與桌面版「功能」是否有差異(前幾輪只做了「程式碼重複」),
  並順便清掉過時文件。盤點結論:SOOP(CORS 擋瀏覽器,實質僅桌面版)、角色工房/市集
  (ADR-004 雙模式全支援)、greeting animations(雙邊都沒編輯 UI)這幾項文件記載正確,
  不是落差。真正找到 3 個問題:
- **修好:雲端版「檢查更新」卡片是誤導性 UI**——`checkUpdate()` 硬編碼
  `hasUpdate:false`,雲端版沒有「發行版本」概念(push main 即部署,不是下載安裝),
  卻永遠顯示「已是最新版本」。改成 `local-only`(比照設定檔位置等桌面專屬卡片隱藏),
  自動檢查呼叫也加 `!IS_WEB` 判斷,不再對雲端版使用者發無意義的 GitHub API 請求。
- **修好:main.js 有一段真的死代碼,而且有 bug**——`obsServer.onClientMessage` 註冊的
  `feed`/`punish`/`setYoliaSee` handler 引用了從未宣告的 `win` 變數(commit 81ae70f
  移除 Electron 透明覆蓋層「pet mode」視窗時漏刪的殘留),而且全 repo 找不到任何地方
  會送出這幾個 WebSocket 訊息(`renderer/`、`web/public/` 都查過)——不只沒用,一旦真的
  觸發 `feed` 分支會直接 `ReferenceError`。已整段刪除,連同 obsServer.js 裡完全沒有
  其他呼叫端的 `onClientMessage`/`clientMsgHandler` 機制與 `client.on('message', ...)`
  接收邏輯一併移除。
- **修好:桌面版本機伺服器沒有限定只聽 localhost**——`obsServer.js` 的
  `httpServer.listen(port, resolve)` 沒指定 host,Node 預設綁所有網卡;桌面版控制面板
  API(config/pack 讀寫、API key)完全沒有驗證機制,理論上同一 WiFi/區網的其他裝置
  連得到。已明綁 `127.0.0.1`。ARCHITECTURE.md §9 已補記這條事實。
- **文件清理**:`docs/designs/animation-editor.md`、`docs/designs/fan-extension-pack.md`、
  `docs/specs/character-pack-format.md` 三份的狀態橫幅都還寫「尚未實作/待實作」,但
  角色工房/擴充包/桌面版支援早就全部做完並經過好幾輪重構——橫幅改成標記「已實作」,
  指向 ARCHITECTURE.md 為現況來源,本檔內容保留作設計理由紀錄(不重寫內文,只修狀態宣告)。
  其餘 design/spec 文件(market-platform.md、marketplace.md、generation-pipeline.md)
  狀態橫幅查過,沒有同類問題。
- 驗證:`cd yuupeek && npm test` 10 suites / 147 tests 全綠(此輪修正沒新增測試案例,
  純刪除死代碼+改一行 host 綁定+改 CSS class,行為由既有測試間接覆蓋)。main.js/
  obsServer.js/panel.html 都過語法檢查。**手動驗證仍待維護者**:桌面版 `npm start`
  後確認 overlay/panel 仍能連上(綁 127.0.0.1 後行為應不變,因為 `localhost` 本來就
  解析到 127.0.0.1);雲端版設定分頁應該看不到「版本資訊」卡片。

## 目前狀態（2026-07-25 五，收斂訊息套用時機的重複邏輯）

- 起因:維護者問「app 跟 web 還有沒有分離 code 做同一件事的 case」,盤點後找到一個——
  `chatProcessor.processMessage()` 雖然雙邊共用,但外層「何時套用、要不要延遲 3 秒回復」
  這段決策桌面版(`chatListener.js` 的 `processMessage`)與雲端版(`index.html` 的
  `onMessage`)各自手刻一份,形狀一樣,只有最終 sink 不同(桌面 broadcast 走 WebSocket,
  雲端直接呼叫同頁 `char.applyUpdate`)。
- `chatProcessor.js` 新增 `planMessageEffects(r, yolia_see)`(純函數):回傳
  `{ immediate, delayed }`,呼叫端只需把 patch 丟給自己的 sink。桌面版額外保留
  `sm.state` 持久化(供 `getStatus()` 等讀取)這個桌面特有的副作用,雲端版沒有對應需求
  (`sm` 只追蹤 `yolia_see`)。
- 驗證前先查證這不只是程式碼重複,也不是行為分歧:`costDenied:true` 時 chatProcessor
  保證 `animOnly` 恆為 `false`,桌面原本省略這個欄位、雲端原本明寫 `false`,兩者結果
  相同,合併後不影響行為。
- 驗證:`cd yuupeek && npm test` 10 suites / 147 tests 全綠(chatProcessor.test.js
  補了 planMessageEffects 三案例)。chatProcessor.js/chatListener.js/index.html
  都過語法檢查。**UI 手動驗證仍待維護者**:cost 不足提示 3 秒後消失、指令動畫播完回
  idle,雙版本行為應與改動前一致。

## 目前狀態（2026-07-25 四，架構審查第四輪——panel.html 整體覆核）

- 起因:同一次 session 第四輪。`panel.html`(995 行)是全 repo 歷史異動次數最高的檔案
  (31 次),前三輪只動過其中特定機制(pack DataAdapter 方法、分頁切換 unload 掛鉤),
  沒整份看過。這輪排除已審過的部分,專看 panel.html 自己的地盤:兩份 DataAdapter、
  狀態分頁、桌寵設定分頁、系統設定分頁、initApp/showTab 外殼。
- **修好一個真的 bug**:雲端版(web)DataAdapter 的 `getConfig()` 原本只回
  `{twitch, youtube}`,漏了 `soop`——但同一個 adapter 的 `saveConfig()` 有正確寫入
  `soop/enabled`/`soop/channel`/`soop/apiMode`(panel.html:878-880),桌面版
  `main.js:getConfig`(135-139)也回三個平台。讀寫不對稱的結果:雲端版使用者存好
  SOOP 設定、重新整理設定分頁後,畫面顯示 SOOP 未啟用/頻道空白(其實 RTDB 裡資料是對的),
  這時候若使用者再碰任一 SOOP 欄位存檔,會用空白值覆蓋掉 DB 裡本來正確的資料。
  修法:`getConfig` 補一行 `soop: c.soop ?? {}`(panel.html:870)。
  `loadConfig()` 讀取端(542-551)本來就正確處理 `data.soop?.*`,只是從沒收到過資料。
- **誠實結論:這輪沒有第二個候選**。除了上面這個 bug,狀態分頁的輪詢、桌寵設定分頁的
  debounce/id 產生、initApp/showTab 外殼都套過 deletion test,現有形狀已經是問題允許
  的最簡形狀,沒有勉強湊候選。
- 驗證:panel.html 內嵌 script 過語法解析;`cd yuupeek && npm test` 10 suites /
  144 tests 全綠(此修正沒動任何 yuupeek/src/ 下的邏輯,測試數不變)。
  **UI 手動驗證仍待維護者**:雲端版存 SOOP 設定→重新整理設定分頁→欄位應該還在。

## 前次狀態（2026-07-25 三，架構審查第三輪——main.js 剩餘 panelHandlers）

- 起因:同一次 session 第三輪,依全歷史檔案異動次數排序(`git log --pretty=format: --name-only
  | sort | uniq -c | sort -rn`),下一個沒動過的熱點是 main.js(29 次)與 obsServer.js(17 次)。
  直接回頭覆核前次狀態留的待辦(configStore/broadcastPolicy/listenerLifecycle 三塊)。
- **listenerLifecycle ✅ 做了**:`yuupeek/src/chatListener.js` 新增
  `restartChatListener(prev, config, sm, broadcast)`,收斂 main.js 三處(`saveConfig`/
  `saveEnv`/啟動時)逐字或近逐字複製的「stop 舊的→三平台任一 enabled 就 create+start,
  否則設 null」邏輯。函數放在已經有 `chatListener.test.js` 測試安全網、無 electron 依賴
  的檔案裡,main.js 本身仍然不能跑測試也沒關係。
- **isNewer/compareVersions ✅ 順手做了**(第一輪就標記過的舊債):`obsServer.js` 的
  app 版本比較改呼叫 `packFormat.compareVersions`,刪掉自己重新發明的 `isNewer`。
  `compareVersions` 本身沒改(維持只吃無前綴 semver 字串的既有契約),'v' 前綴的剝除
  留在 obsServer.js 做(那是 GitHub tag 格式的特性,不是通用版本比較規則)。
- **configStore ❌ 覆核後判定不值得做——結論已定案,之後的審查不用再提**:
  `saveConfig`/`savePetConfig` 的 patch 邏輯確實有重複的讀檔→局部覆寫→寫回骨架,
  但每個分支都同時要碰 `sm`(狀態機)、`chatListener`(熱重載)、`obsServer`(broadcast)
  三個共享可變狀態——抽成獨立模組要嘛把這三個依賴一起注入(deletion test 沒過:
  複雜度只是從 main.js 的頂層閉包搬到另一個 factory 的閉包,沒有真的變少),要嘛切一半
  留一半(製造新 seam 卻沒有真的變深)。**broadcastPolicy ❌ 同樣不值得**:round 1/2
  已經把真正的邏輯(`buildAnimationsUpdate`、pack 合併)搬進 packFormat.js,main.js
  剩下的只是呼叫 `obsServer.broadcast(...)` 的膠水,deletion test 直接失敗——已經沒有
  複雜度可集中。若真要動,值得做的是更小的 `patchJsonFile(path, patcher)` 工具函數
  (收斂讀-改-寫骨架本身),不是 configStore 那種模組級改動,且目前沒有急迫性。
- 驗證:`cd yuupeek && npm test` 10 suites / 144 tests 全綠(chatListener.test.js
  補了 restartChatListener 三個案例)。main.js/chatListener.js/obsServer.js 都過
  `node --check`。main.js 仍因 require('electron') 無法在此沙盒環境跑起來驗證,
  建議維護者本機 `npm start` 驗一次設定變更/停用重連/YouTube「我開播了」按鈕。

## 前次狀態（2026-07-25 二，架構審查第二輪——角色工房幀編輯器/匯入精靈）

- 起因:同一次 `/mattpocock-skills:improve-codebase-architecture` session,第二輪聚焦
  `workshop.js`(579 行,超過自己的設計稿 docs/designs/animation-editor.md §6 訂的
  ~300 行分拆門檻)裡上一輪沒動過的部分:幀編輯器與匯入精靈。3 個候選全做,第 4 個
  (讓 .yolia.json 也能只匯入單一動畫貼進目前開著的包)判斷是新功能而非架構收斂,
  沒做,留給維護者決定要不要排。
- **真的 bug 修好了**:`Workshop`/`Market` 新增 `unload()`(呼叫既有的
  `stopPreview`/`stopPreviewTimer`),`panel.html` 的 `showTab()` 現在會在切走
  工房/市集分頁時呼叫。原本打開幀編輯器或市集試播後切到別的分頁,計時器會無限期留在
  背景對隱藏 canvas 解碼/畫圈,直到手動切回去關掉——跟 commit 歷史上修過一次的
  「幀編輯器預覽計時器生命週期」同一類問題,這次抓到的是 tab 切換這個新邊界。
- `packFormat.js` 新增 `moveFrame`/`duplicateFrame`/`deleteFrame`(純函數,吃 srcs
  陣列吐新陣列)與匯出 `MAX_FRAMES_PER_ANIM`:workshop.js 的幀移動/複製/刪除與 32 幀
  上限原本整組活在 DOM 事件處理器裡,32 這個數字還手抄了兩份(一份跟 packFormat.js
  內部常數重複、一份在 addAnim 的匯入上限檢查)。
- `packFormat.js` 新增 `DEFAULT_MS_SPRITESHEET`(125)/`DEFAULT_MS_PER_FRAME_FILES`
  (150)/`compareNatural`:匯入精靈原本把這兩條規格 §7 命名規則(來源 A/B 的 ms 預設、
  逐幀圖按檔名自然排序)寫成散落的字面值與一行沒名字的 `localeCompare`,現在跟
  `defaultLoop` 待遇一致,都是有名字的純函數。
- 驗證:`cd yuupeek && npm test` 10 suites / 141 tests 全綠(packFormat.test.js
  補了 moveFrame/duplicateFrame/deleteFrame/compareNatural/ms 常數的測試)。
  workshop.js/market.js/panel.html 內嵌 script 都過 `node --check`/語法解析。
  **UI 手動驗證仍待維護者**:幀編輯器移動/複製/刪除、切分頁後計時器確實停了。

## 前次狀態（2026-07-25，架構審查後的四項收斂重構）

- 起因:`/mattpocock-skills:improve-codebase-architecture` 掃過角色包/市集熱點與
  聊天監聽子系統,列出 4 個「重複邏輯收斂成單一 interface」的候選,維護者核准全做。
  全程只收斂既有邏輯的**位置**,格式/行為刻意不變(RTDB schema、動畫格式皆未動)。
- **① `yuupeek/src/youtubePollPolicy.js`(新檔,isomorphic,已加進 sync.js)**:
  `shouldCheckLiveNow`/`classifyYoutubeError` 收斂桌面 `chatListener.js` 與雲端
  `index.html` 原本各自手刻的「15 分鐘找直播節奏」「quota 錯誤判斷」——上一版
  (2026-07-12 那次)兩邊各改一次,這次起兩邊都呼叫同一份純函數。**順手補的行為修正**:
  雲端 overlay 原本 quota 爆掉後沒有停止狀態,「我開播了」還會再打一次註定失敗的請求;
  現在跟桌面版一樣有 `quotaStopped` 旗標擋掉。
- **② `packFormat.js` 新增 `packKeyOf`/`resolveActivePackIds`/`packIdsCompatFields`/
  `selectPack`**:收斂 `activePackId`↔`activePackIds` 相容折算(原本 main.js/
  obsServer.js/panel.html 兩個 adapter/index.html 共 6 處各自手刻)與「換角包一次只能
  一個」互斥規則(原本 workshop.js/market.js 各刻一份,`mergeActivePacks` 本身不知道
  這條規則,任何新呼叫端理論上可悄悄同時啟用兩個換角包)。7 個呼叫端全部改呼叫這 4 個
  函數,touchpoints:main.js、obsServer.js、panel.html 兩個 adapter、workshop.js、
  market.js、web overlay(index.html)。
- **③ `packFormat.js` 新增 `guessIndexUrl`/`extractIndexUrlFromFirebaseConfig`**:
  market.js 的 `resolveIndex` 原本把「市集位址→候選 index.json URL」的純字串邏輯
  跟 fetch/try-catch 編排混在一起,且完全沒測試(雖然 `window.Market._resolveIndex`
  早就掛了測試鉤子)。純字串部分搬進 packFormat.js,market.js 只留 I/O 編排。
  `normalizeIndex` 一併搬過去(原本已是純函數,只是位置不對)。
- **④(範圍縮小)`yuupeek/src/packStore.js`(新檔,electron 無關)**:原候選是把
  main.js 的 panelHandlers 整個拆成 configStore/packStore/broadcastPolicy/
  listenerLifecycle 四塊;實際只做了 packStore 這塊——main.js 需要 `require('electron')`
  才能跑,這個 repo 目前沒有任何 main.js 的自動化測試,沒有安全網驗證更大範圍的拆分。
  packStore 這塊本身不依賴 electron(只用 fs),已補 `packStore.test.js`。
  剩下三塊(configStore/broadcastPolicy/listenerLifecycle)還沒拆。
  【2026-07-25 三後續】已覆核:listenerLifecycle 做了(見上方最新狀態);
  configStore/broadcastPolicy 判定 deletion test 沒過,結論定案不再是待辦。
- 驗證:`cd yuupeek && npm test` 10 suites / 131 tests 全綠(含新增的
  `youtubePollPolicy.test.js`、`packStore.test.js`,以及 `packFormat.test.js` 補的
  pack-selection/index-format 測試)。`main.js` 只能 `node --check` 語法檢查
  (此沙盒環境 `ELECTRON_RUN_AS_NODE=1`,無法真的開視窗跑桌面版;維護者本機
  `npm start` 建議手動驗一次工房勾選/市集安裝/YouTube 面板「我開播了」)。

## 前次狀態（2026-07-12，YouTube 直播偵測改 15 分鐘+「我開播了」）

- 查證(2026-07-12,determine_quota_cost):**search.list 改為獨立每日 100 次上限**,
  其他端點共用 10,000 units/天。桌面版原本未開播 30 秒搜一次=50 分鐘用光額度 → bug。
- 桌面 chatListener:未開播改 15 分鐘查一次(LIVE_CHECK_INTERVAL_MS,與雲端一致),
  暫時性狀況用 RETRY_INTERVAL_MS=30 秒;新增 `checkYouTubeLiveNow()`(清節流立即查,
  配額爆掉回 false);輪詢迴圈加 ytBusy 防手動觸發造成雙迴圈。
- 「我開播了」按鈕(panel「YouTube 設定」卡,兩模式):桌面 `POST /panel/api/youtube/check`;
  雲端寫 `/events/checkLive` nonce → overlay 首快照抑制後觸發 `checkNow()`。
- 雲端 overlay `startYouTube` 回傳值改 `{stop, checkNow}`(原本是 stop 函數)。
- `liveChat/messages` 單價官方未列(【未查證】);長期選項 `liveChatMessages.streamList`
  (官方建議,免輪詢)記入 backlog,暫不做。
- 驗證:jest 92 tests 全綠(+1 時序測試:15 分鐘節流+手動觸發立即查)。

## 前次狀態（2026-07-11 二，角色包勾選制+市集試播）

- **角色包改勾選制**(維護者 UI 回饋):工房清單內建只標「內建」徽章無操作鈕;
  每個包一個啟用勾選框,**擴充包可同時勾多個**,換角包一次限一個(勾新的自動取消舊的)。
- 資料格式(只加不改):`config.activePackIds: string[]` 新可選欄位;
  `activePackId` 保留=清單第一個(舊 overlay 相容)。合併邏輯統一在
  `packFormat.mergeActivePacks`(換角包墊底、擴充依勾選順序疊後,壞包跳過回報)。
  touchpoints:main.js(config 讀寫+廣播)、obsServer active-pack 路由(收陣列,
  相容舊單包 body)、web overlay(多 packRef 訂閱)、panel 兩個 adapter、workshop.js。
- **市集試播**:卡片「試播」→ 抓包+validatePack → 卡片內小畫布循環播,可切動畫,
  只播 data:image/ 幀(不對外站發請求);安裝後「立即啟用」改為附加到勾選清單。
- 驗證:jest 8 suites/91 tests 全綠(+5 mergeActivePacks);node 假 DOM 驅動
  workshop 勾選流程 7 項全過;市集渲染煙霧測試過。瀏覽器實測待維護者。

## 前次狀態（2026-07-11，平台本機免登入測試模式）

- 平台 repo 新增 `dev.js`(零依賴):`node dev.js` 同時端出三頁+假資料庫
  (RTDB 風格 REST 存 `.local-data.json`)。localhost 無 firebase-config.js 時
  common.js 走 **MOCK 分支**:免登入固定為「本機測試員」(已核准 admin),
  rules 不驗;panel 市集位址直接貼 `http://127.0.0.1:5000`。要測 rules/SSO
  才用 emulator(config projectId 用 demo- 開頭觸發,需 Java)。
- panel 市集位址改「貼什麼都盡量接」:index.json 原樣/資料庫根自動補/網站網址
  自動探測 firebase-config.js(正式部署限定——hosting emulator 不套自訂標頭,
  firebase-tools #3860);錯誤訊息導引抄首頁底部的 Registry URL。
- 端到端驗證(2026-07-11,node 驅動 mock 分支):免登入→發布→瀏覽→
  panel 貼網站網址解析→抓包→下架,7 項全過;主 repo 測試 86 全綠。

## 前次狀態（2026-07-10 深夜二，中央市集平台 ADR-005）

- 市集路線改版:GitHub registry → **中央 Firebase 平台**(維護者拍板,ADR-005;
  原 registry 骨架保留為自架備援)。新 repo `../YoliaWatching-market/`(已 git init):
  瀏覽頁(卡片+試播)、創作者頁(Google SSO→申請→審核→PNG 上傳/切片/命名/試播/發布)、
  管理頁(審帳號/停權/下架/增減 admin);rules 強制「id 前綴=handle」防冒名;
  零伺服器,Spark $0。
- 主 repo 唯一改動:market.js 的 `normalizeIndex`——同時吃 GitHub 陣列格式與
  平台物件格式(packUrl 自動組 `<根>/packs/<key>.json`)。
- **待維護者**:照 ../YoliaWatching-market/README.md 部署(建 Firebase 專案→填 config→
  deploy→bootstrap 首任 admin);開 GitHub repo push;實測創作者流與管理流。
- 未驗證:平台三頁全部未經瀏覽器實測(本環境無法);rules 權限矩陣需部署後手動驗
  (README 已列驗收流程)。

## 前次狀態（2026-07-10 深夜，layer4 批次：匯出/試播/市集/AI 教學）

- **匯出**：工房包卡「匯出」鈕（validatePack 防呆 → Blob 下載 .yolia.json）。
- **手動試播**：RTDB 新頂層節點 `/events`（rules 同改）；overlay 訂閱 nonce 觸發
  animOnly 播放（首快照不觸發）；桌面走 `POST /panel/api/play` → WS 廣播；
  工房頂部「試播」卡（getAnimations keys）。
- **市集**：panel 新「市集」分頁（yuupeek/renderer/market.js，sync 已登記）：
  fetch index.json → 卡片 → 安裝（本地 validatePack 重驗＋id 比對）→ 問啟用；
  已安裝/可更新標記（packFormat.compareVersions）；registry URL 存 localStorage
  （`yolia.marketplaceUrl`），**無預設值**——未設定時顯示設定提示（填中央平台的
  index.json 位址，見 ADR-005）。
- ~~registry 骨架~~：GitHub registry 路線被 ADR-005 中央平台取代，
  `../YoliaWatching-packs/` 已於 2026-07-10 經維護者確認刪除（未曾 push）。
  market.js 仍支援陣列型 index，自架 registry 可按 marketplace.md 重建。
- **AI 教學**：docs/guides/ai-generation-nano-banana.md（Nano Banana 2 手動流程）；
  generation-pipeline.md 階段二擱置註記；粉絲指南已連結。
- 未驗證：試播/市集 UI 為靜態追蹤；維護者桌面實測（試播按鈕、市集指本地假 index 裝
  demo 包、匯出再匯入迴圈）；雲端 e2e 照舊待部署。

## 前次狀態（2026-07-10 晚，小尾巴+技術債清理）

- **測試基線恢復全綠**（8 suites / 84 tests）：chatListener.test.js 重寫（舊版備份於
  docs/backups/）、新建 chatProcessor.test.js、新建 syncManifest.test.js（sync 清單守門:
  HTML 引用的 js 漏登記 sync.js 即紅字）。CLAUDE.md 鐵律 4 已改回「必須全綠」。
- 角色包小尾巴清畢：validatePack srcs 字元集收緊+4MB 精確位元組(spec §8 同步)、
  web overlay 殘留清除改用 buildAnimationsUpdate(修 prototype-prop 邊界)、
  工房編輯器單一重繪出口(孤兒計時器/manifest 還原修復)、isValidStateName 去重、
  桌面版非啟用包不再廣播。
- dead code:frames.js 已刪(grep 零引用)、detector.js 檔頭加未接線註記。
- 文件:web/DEPLOY.md 改一頁式指向 README;README 修 test-ui 描述與 secrets 數量(6)。
- 未驗證:工房 UI 修改僅靜態追蹤(無 DOM 測試框架);維護者桌面實測清單仍待跑
  (見 docs/superpowers/plans/2026-07-10-desktop-pack-support.md Task 5)。

## 前次狀態（2026-07-10，桌面版角色工房支援）

- 桌面版角色工房已支援（ADR-004）：packs 存 `<userDataDir>/packs.json`、activePackId 存
  config.json、obsServer 加 5 條 `/panel/api/packs*`/`active-pack` 路由、panel 桌面 adapter
  換 fetch 實作並載入共用 workshop.js/packFormat.js（obsServer 靜態服務直接供應）、
  合併/清殘留邏輯=packFormat.js 新純函數 `buildAnimationsUpdate`（含測試）。
  已驗證：npm test 63/63（僅既有 chatListener 基線紅字）、路由測試、sync.js。
  未驗證：維護者 `npm start` 手動清單（見 docs/superpowers/plans/2026-07-10-desktop-pack-support.md Task 5）。

## 前次狀態（2026-07-09，Task 10 文件更新）

- 角色工坊 Phase 1 + 擴充包(base:"builtin")已實作:packFormat.js(含測試)、
  character.js srcs、/packs rules、overlay activePackId、panel 角色工房分頁+workshop.js、
  粉絲投稿指南。已驗證:npm test(packFormat+character 綠)、桌面版降級、test-ui 沙盒。
  未驗證:雲端 e2e(需部署後手動:匯入 sample sheet → 啟用 → onMessage 觸發)。
  設計:docs/designs/fan-extension-pack.md、ADR-003。

  最終審查修正後續(2026-07-09):
  - late-resolve config race 已由 latestConfig 大致修好,見 web/public/index.html。
  - 剩餘已知後續:`s in baseline` prototype-prop 邊界情況(web/public/index.html 的 purge 過濾)。
  - 剩餘已知後續:編輯器開著時移除另一個動畫,殘留孤兒 preview interval(yuupeek/renderer/workshop.js)。
  - 剩餘已知後續:renderEditor 在 ms/loop 變更時會還原未儲存的 manifest 輸入(yuupeek/renderer/workshop.js)。
  - 剩餘已知後續:PackFormat 可考慮匯出 isValidStateName,去重 addAnim 內建的 regex(yuupeek/renderer/workshop.js)。
  - 剩餘已知後續:validatePack 的 srcs 字元集可再收緊,作為縱深防禦(yuupeek/src/packFormat.js)。
  - 剩餘已知後續:4MB 上限目前用 UTF-16 字串長度當代理值,非精確位元組數。
  - 編輯啟用中的包現在即時生效(overlay 改為訂閱啟用中的 /packs 節點,見 web/public/index.html)。

| # | 交付項 | 檔案 | 狀態 |
|---|--------|------|------|
| 0 | CLAUDE.md 路由 | CLAUDE.md | ✅ |
| 1 | 架構全貌 | docs/ARCHITECTURE.md | ✅ 含技術債查證結論 |
| 2 | 平台定位評估 | docs/decisions/ADR-001-platform-positioning.md | ✅ |
| 3 | 工作制度（給弱模型） | docs/PLAYBOOK.md | ✅ |
| 4 | 角色包格式規格 | docs/specs/character-pack-format.md | ✅ 基石文件 |
| 5 | spritecook 整合 | docs/decisions/ADR-002-spritecook-integration.md | ✅ spritecook=spritecook.ai，已線上查證格式 |
| 6 | 動畫編輯器設計 | docs/designs/animation-editor.md | ✅ 含第四種觸發（手動）分析 |
| 7 | 生成管線設計 | docs/designs/generation-pipeline.md | ✅ 含 prompt 範本、CORS spike 前置 |
| 8 | 市集設計 | docs/designs/marketplace.md | ✅ GitHub registry 方案，Spark 免升級 |
| 9 | 對抗審查＋read-back | （無檔案，流程） | ✅ 25 發現全修（含 3 嚴重）、37 宣稱抽驗通過、連結兩輪全綠 |
| 10 | 一頁總結 | 回覆訊息＋本檔 | ✅ |

另：記憶系統已建立（user-profile、session-conduct-preferences 兩則＋索引）。

## 本 session 已確認的關鍵事實（下一個 session 不用重查）

- 動畫 runtime 格式：`{ folder, frames: number[], ms, loop }`，逐幀 PNG，
  路徑 = `assetBase/<folder>/<兩位數補零>.png`。定義在 [character.js](../yuupeek/renderer/character.js) 的
  `setAnimations()`（約 L329）。
- 雲端版 overlay 的 assetBase = `./assets/sprites/frames`（[index.html](../web/public/index.html) 約 L103）。
- `config/animations`（RTDB）已能覆蓋/新增動畫；panel 的動畫下拉選單自動吃
  `getAnimations()` 的 keys（panel.html 約 L663）。
- 缺口 A：web 版 panel 的 api adapter **沒有 saveAnimations**（桌面版有），雲端版無法在 UI 編動畫。
- 缺口 B：自訂 sprite 圖檔目前只能放 repo 靜態檔（要 redeploy 才會生效），沒有上傳機制。
- `setAnimations` 只支援「assetBase 相對路徑 + folder + 幀索引」，不支援完整 URL 或 data URL
  ——這是角色包功能唯一需要動 character.js 的地方。
- 共用檔（character.js / chatProcessor.js / panel.html）原始碼在 yuupeek/，
  web/public/ 的副本由 web/sync.js 部署時複製。
- 文件矛盾：web/DEPLOY.md 還在教 FIREBASE_TOKEN，實際 CI 已改用 FIREBASE_SERVICE_ACCOUNT
  （README 是對的）。→ 待修。

## 地雷區（會咬人的細節）

> 2026-08-16 更新：這節原本大量記著 Firebase 雲端版（web/public/index.html、RTDB
> `config` 訂閱、YouTube quota 永久停止）的細節，那套架構已經整個拿掉，舊內容刪除
> 避免誤導。現行的坑：

- `chatMonitorClient.js` 現在**每種 event_type 都會轉發**給規則引擎（2026-08-16 二次收斂，
  拿掉了原本的 `event_type!=='chat'` 過濾器）——一個事件會不會讓桌寵反應，完全看有沒有
  規則的 `eventTypes` 配到它，不是引擎層面的限制了。查「某個事件沒反應」先看有沒有對應規則，
  不要往 chatMonitorClient.js 本身找。
- chat-monitor 沒開著時，桌寵是**安靜地**每 3 秒重試連線，不會報錯彈窗、也不會卡住其他
  功能——排查「聊天沒反應」時第一步永遠是先確認 chat-monitor process 有沒有真的在跑。
- `npm run test-ui`（port 3001 沙盒）console **必有**兩種紅字（WS 重連、pet-config 404），
  是 test-server 功能缺口，不算驗證失敗；且沙盒讀不到 animations.json 的自訂動畫，也不接
  chat-monitor（純測動畫本身）。
- chat-monitor 是獨立 npm 專案，`cd yuupeek && npm test` 測不到它；它自己也沒有 jest 測試，
  驗證方式是模擬事件 API（見 chat-monitor/README.md）。

## 待辦（工單）

目前沒有明確待辦——上一輪（見上方「目前狀態」）的手動驗證項還沒有維護者回報結果，
下一個 session 接手前先確認那幾項有沒有人測過。

## 給未來 session 的信（2026-07-07 制度建立 session 已完整收尾）

制度與設計文件已全部落地且經過對抗審查。接下來的正確順序：

1. **維護者先做**：review 本次產出（全部未 commit，`git status` 可見），確認後自行 commit。
   注意 PLAYBOOK §6：push main 會觸發真部署（本次只有 docs/ 與 CLAUDE.md，部署無害但要知情）。
2. **第一張工單**：修測試基線（本檔「待辦」1、2；已有現成 task chip 可一鍵開工）。
   基線全綠後才開始功能開發，否則 DoD 判準會一直帶著例外。
3. **功能開發起點**：docs/designs/animation-editor.md §5 的 Phase 1 清單（從 packFormat.js
   ＋測試開始，那是純函數、風險最低、其他一切的地基）。
4. 每個新 session：CLAUDE.md 會自動載入，照它的路由表讀對應文件再動手。
