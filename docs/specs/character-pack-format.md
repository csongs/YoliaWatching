# 角色包格式規格（Character Pack v1）

> 地位:本規格是「編輯器、AI 生成、市集」三條功能線共用的**唯一資料契約**,也是對
> spritecook 等外部工具的**隔離層**——外部工具只碰「匯入器」,碰不到格式本身。
> 實作前必讀:docs/PLAYBOOK.md §3(格式演進規則)。
> 尚未實作(2026-07-07):本檔是規格,不是現況。現況見 docs/ARCHITECTURE.md §5。

## 1. 設計約束(為什麼長這樣)

1. 【事實】現有引擎吃逐幀圖:`setAnimations({狀態: {folder, frames[], ms, loop}})`,
   圖檔路徑=`assetBase/<folder>/<NN>.png`。不支援完整 URL 或 data URL。
2. 【事實】自訂素材沒有上傳點:Hosting 檔案只能經 repo+redeploy;RTDB 是唯一
   「panel 寫、overlay 即時讀」的通道。
3. 【事實】overlay 對 `/config` 是整節點訂閱——大資料放 `/config` 會在每次任何設定
   變更時整包重推(ARCHITECTURE §4)。
4. 【建議→採納】因此:角色包=**單一 JSON 檔**(manifest+base64 data URL 幀圖),
   存放於 RTDB 獨立頂層節點 `/packs/<packId>`,由 overlay 一次性讀取。
   不用 zip(免引入解壓依賴),不用 Cloud Storage(Spark 政策風險,ADR-001 紅線)。

## 2. 檔案格式(.yolia.json)

一個角色包=一個 JSON 檔,副檔名慣例 `.yolia.json`(方便市集分發與本機備份)。

```jsonc
{
  "yoliaPack": 1,                    // 必填。格式版本,整數。讀取端遇到 >1 的值要拒絕匯入並提示升級
  "id": "author-name.pack-name",     // 必填。^[a-z0-9-]+\.[a-z0-9-]+$ (作者.包名,全小寫)
  "name": "幽靈小妹",                 // 必填。顯示名稱
  "version": "1.0.0",                // 必填。semver 字串,市集用來判斷更新
  "author": "someone",               // 必填
  "license": "CC-BY-4.0",            // 必填。SPDX id 或 "custom"(custom 時 licenseText 必填)
  "licenseText": "",                 // 選填
  "description": "",                 // 選填
  "source": {                        // 選填。素材來源紀錄(供追溯,不影響執行)
    "tool": "spritecook",            //   自由字串:"spritecook" | "hand-drawn" | ...
    "prompt": "...",                 //   生成用的 prompt(方便回鍋重生成)
    "assetIds": ["..."]              //   外部服務的 asset id
  },
  "animations": {                    // 必填。至少要有 "idle"
    "idle": {
      "srcs": ["data:image/png;base64,...", "..."],  // 必填。data URL 或 https URL 陣列,即播放順序
      "ms": 125,                     // 選填,預設 150。每幀毫秒
      "loop": true                   // 選填,預設 false
    },
    "attack": { "srcs": ["..."], "ms": 125, "loop": false }
    // 狀態名規則:^[a-z][a-z0-9_]*$。可以是引擎已知狀態(見 §5),也可以是全新名稱
  },
  "defaultInteractions": [           // 選填。建議的觸發綁定(匯入時使用者可勾選採用)
    // 形狀與 RTDB config.interactions 完全相同(見 ARCHITECTURE §6),但「不含 id 欄位」
    // (id 由匯入器在寫入時以 panel 的 generateId 規則現生成,避免跨使用者撞 id)
    { "trigger": "command", "match": ["!attack", "！攻擊"], "animation": "attack", "yolia_see": 0, "response": "{user} 發動攻擊!" }
  ],
  "preview": "data:image/png;base64,...",  // 選填。單張預覽圖(市集列表用),建議 ≤30KB
  "meta": {}                         // 選填。保留欄位,讀取端一律忽略未知子欄位
}
```

**尺寸上限(匯入器強制)**:整包 JSON ≤ 4 MB;單一動畫 ≤ 32 幀;動畫總數 ≤ 32。
理由【建議】:RTDB 單節點寫入有大小限制(【未查證】確切數字,實作時以官方文件為準,
上限取保守值);且 overlay 啟動要一次載入整包。像素風 64–128px 幀圖每張約 1–15 KB,
正常包(10 動畫 × 8 幀)約 0.1–1.5 MB,離上限很遠。

## 3. 儲存與啟用(RTDB)

```
/packs/<packId 的「.」換成「_」>   ← RTDB key 不允許 "."(【事實】Firebase key 禁用 . # $ / [ ])
    = 整個 .yolia.json 內容原樣存入

/config/activePackId = "author-name.pack-name" | null   ← 小欄位,放 config 內沒問題
```

- **rules 必改**(PLAYBOOK §3 規則 3):`/packs` 設 `.read: true`、`.write: 同 config 的 admin 條件`。
- overlay 行為:訂閱 `/config`(照舊)→ 發現 `activePackId` 變了 → `once('value')` 讀
  `/packs/<key>` → 經 `packToAnimations()`(§5)轉成 setAnimations 設定 → 套用。
  `activePackId` 為 null/undefined → 回復內建動畫(向後相容:舊資料庫沒有此欄位,行為不變)。
- 解除安裝=刪 `/packs/<key>`;若它是 activePackId,同時把 activePackId 設 null。

## 4. 引擎擴充(character.js 唯一必要改動)

`setAnimations()` 現況(character.js L329–338)只認 `folder`+`frames`。擴充為:**若項目帶
`srcs`(字串陣列)則直接採用,否則走原有 folder 邏輯**。舊資料完全不受影響。

```js
setAnimations(cfg) {
  Object.entries(cfg).forEach(([state, def]) => {
    if (Array.isArray(def?.srcs)) {                       // 新:直接給 URL(data URL 或 https)
      ANIMATIONS[state] = { srcs: def.srcs, loop: !!def.loop, ms: def.ms };
      cacheFrames(def.srcs);
      return;
    }
    if (!def?.folder || !Array.isArray(def.frames)) return; // 原邏輯,一字不改
    ...
  });
}
```

- 相容性論證(兩條路徑分開講):
  (a) 主路徑:pack 動畫存 `/packs`,由新 overlay 的 packToAnimations 轉換後才進引擎——
      舊 overlay 根本不讀 `/packs`,完全無感,零影響。
  (b) 防禦路徑:若帶 `srcs` 的項目被直接寫進 `config/animations`(僅允許少量 https URL;
      data URL 大資料進 /config 違反 ADR-001 紅線 1),舊 overlay 的 setAnimations 因
      `!def.folder` 靜默跳過該項 → 該狀態回退內建動畫,**降級但不壞**(PLAYBOOK §3 規則 4)。
- 畫布【事實】固定 128×139(DISPLAY_W/H),幀圖會被拉伸繪滿。v1 不支援自訂畫布比例;
  接近方形的來源(如 spritecook 預設 64×64)拉伸後約 8% 直向變形,像素風可接受。
  將來若要支援,加 optional `canvas:{w,h}` 欄位(additive,另開 ADR)。

## 5. 狀態映射與缺漏回退(packToAnimations)

引擎與預設設定會主動用到的狀態【事實,出處:character.js(引擎行為)、chatProcessor.js
(關鍵詞預設)、yuupeek/default.config.json(預設互動)、兩份 DEFAULT_ANIMATIONS】:
- 引擎行為:`idle`(baseState 預設)、`run_left`/`run_right`(移動中)
- 關鍵詞未指定 animation 時的預設:`wave`
- 預設互動(default.config.json):`peek`、`cheer`(門檻)、`cry`、`eat`、`jump`、
  `run_right`(指令「!右」)、`watch_excited`(指令「!幽視」)
實作 packToAnimations 的已知狀態映射時,以上**全部**要涵蓋;日後新增預設互動,記得回來更新本清單。

規則(實作在 packFormat.js 的 `packToAnimations(pack)`,**不准實作在 character.js 裡**):
1. pack 必含 `idle`,否則驗證失敗、拒絕匯入。
2. 引擎已知狀態若 pack 沒提供 → **一律映射到 pack 的 `idle`**(整隻角色風格一致),
   不回退內建 Yolia 圖(混搭兩隻角色的圖會很怪)。
3. pack 提供的全新狀態名(如 `attack`)直接註冊,panel 下拉選單會自動出現
  (【事實】panel 的 STATE_OPTIONS 來自 getAnimations 的 keys,panel.html 約 L663)。

## 6. 匯入來源(匯入器支援的三種輸入)

| 來源 | 輸入 | 處理 |
|---|---|---|
| A. spritesheet(單列橫向 strip) | PNG 檔+幀寬(可自動猜) | 切片演算法見 §7 → 每幀轉 data URL |
| B. 逐幀圖檔 | 多選 PNG(按檔名排序) | 直接轉 data URL |
| C. 現成角色包 | .yolia.json | 驗證(§8)後原樣入庫 |

spritecook 的對應:網頁版下載 PNG spritesheet → 走 A;API 拉取(未來)也是拿
spritesheet URL → 走 A。**匯入器不需要、也不應該有任何 spritecook 專屬邏輯**;
spritecook 專屬的只有:文件裡的操作教學與 prompt 範本(generation-pipeline.md)。

## 7. spritesheet 切片演算法(確定性,照抄可實作)

已知【事實,出處:SpriteCook 官方 Godot skill,2026-07-07 查證】spritecook 動畫 sheet
為單列橫向:第 i 幀 = 矩形 `(i*frame_width, 0, frame_width, frame_height)`;
且輸出幀尺寸可能**大於**原始素材(會加邊距,例:512 源產出 640 幀寬)——
一律以使用者輸入/metadata 的幀寬為準,不要假設等於生成時的尺寸。

```
輸入:image(已載入的 Image), frameW(可省略)
1. 若 frameW 省略:猜 frameW = image.height(單列 sheet 幀通常近方形)
2. 若 image.width % frameW !== 0 → 報錯「幀寬不整除圖寬」,讓使用者手動輸入 frameW
3. count = image.width / frameW
4. for i in 0..count-1:
     canvas(frameW × image.height) ← drawImage(image, i*frameW, 0, frameW, image.height,
                                                0, 0, frameW, image.height)
     frames[i] = canvas.toDataURL('image/png')
5. UI 顯示切出的幀給使用者確認(錯了就改 frameW 重切)
```

ms 換算:spritecook metadata 有 fps(官方範例皆 8)→ `ms = Math.round(1000 / fps)`;
手動匯入的預設值(與 animation-editor.md §2 一致):來源 A(spritesheet)預設 ms=125
(spritecook 慣例 fps 8)、來源 B(逐幀圖)預設 ms=150(引擎預設)。編輯器一律可調。
loop 判斷:spritecook **沒有** loop 欄位(【事實】API 無此欄位)。依名稱慣例給預設:
`idle/run_*/walk*` → loop:true,其餘 false;編輯器一律可改。

## 8. 驗證規則(packFormat.js 的 validatePack)

逐條檢查,回傳 `{ ok, errors: string[] }`(errors 為繁中人話,會直接顯示在 UI):
1. `yoliaPack === 1`(>1 → 「此角色包需要新版本的 YoliaWatching」)
2. `id` 符合 `^[a-z0-9-]+\.[a-z0-9-]+$`;name/version/author/license 非空字串
3. `animations` 至少含 `idle`;每個動畫:srcs 是非空字串陣列、每項是 `data:image/` 或
   `https://` 開頭;ms(若有)是 1–10000 的數字;loop(若有)是布林
4. 狀態名符合 `^[a-z][a-z0-9_]*$`
5. 尺寸上限(§2)
6. `defaultInteractions`(若有):每項 trigger ∈ {threshold,keyword,command} 且**不含 id**;
   欄位形狀同 config.interactions
7. 未知欄位:**忽略,不報錯**(向前相容:新版格式加欄位,舊版讀取端不炸)

## 9. 模組落點與測試(實作時的檔案配置)

| 檔案 | 內容 | 測試 |
|---|---|---|
| `yuupeek/src/packFormat.js`(新,isomorphic,UMD 包裝仿 chatProcessor.js) | validatePack / packToAnimations / applyDefaultInteractions(合併建議綁定,現生成 id,同 match 已存在則跳過並回報) | `yuupeek/src/__tests__/packFormat.test.js`(新):驗證通過/失敗案例、idle 回退映射、interactions 合併與衝突跳過 |
| 切片(§7) | 需要 canvas,放 UI 層(panel 的編輯器 script 或獨立 js);演算法純部分(整除檢查、座標計算)抽成可測純函數放 packFormat.js | 純函數進 packFormat.test.js |
| `web/sync.js` | 若 index.html/panel 以 `<script src>` 載入 packFormat.js,把它加進 FILES 同步清單 | 手動跑 `node sync.js` 驗證 |
| `web/database.rules.json` | 加 `/packs` 規則 | 部署前用 Firebase console 手動塞資料驗證 |

## 10. 外部依賴隔離(spritecook 停更/改格式怎麼辦)

- 本格式**零依賴** spritecook:pack 內只有標準 PNG data URL 與自家 schema。
  已發佈/已匯入的角色包永遠可用。
- spritecook 改輸出格式 → 只需改 §7 匯入器的預設猜測邏輯(或使用者手動輸幀寬即可用)。
- spritecook 倒閉 → 匯入來源 B(逐幀圖)與 C(現成包)不受影響;生成管線換供應商
  (generation-pipeline.md 有備選清單)。
- **判準**:任何 PR 若讓 packFormat.js 或 character.js 出現「spritecook」字樣,就是把
  隔離層打穿了,retreat。
