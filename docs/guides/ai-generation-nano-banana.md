# 用 Nano Banana 2 生成角色動作(手動流程教學)

> 狀態:2026-07-10。本教學是「生成 → 角色工房匯入 → 綁指令」的手動流程;
> 平台內一鍵生成已擱置(見 docs/designs/generation-pipeline.md 頂部註記)。
> 【事實】倉庫內的標準範例 `yuupeek/assets/sprites/sample/00_hurt_sheet.png`
> (1712×214、單列 8 幀、每幀 214×214)即為 Nano Banana 2 產出,可行性已實證。
> 模型的參數選項、額度與計費【未查證】,以服務當下介面為準。

## 目標產物規格(匯入器吃這個)

- **PNG spritesheet**:所有幀橫向排成**單列**,左到右=播放順序,透明背景。
- 幀等寬、近方形;圖總寬=幀寬×幀數(整除)。
- 幀數建議 4–16(上限 32);幀尺寸 64×64–256×256 都可(引擎畫布 128×139,會拉伸)。
- 詳細規格與範例:docs/fan-submission-guide.md。

## Prompt 範本(【建議】,基於 sample 成功經驗;英文對模型較穩)

先生成母體角色(之後每個動作都基於它,風格才會一致):

```
chibi 【角色描述,如 ghost girl with blue hoodie】, full body, facing left,
standing pose, clean pixel-art style, simple flat colors,
transparent background, single character
```

再對母體逐動作生成 spritesheet(一次一個動作):

```
sprite sheet of the same character, 【動作描述】 animation,
8 frames in a single horizontal row, evenly spaced, same size each frame,
transparent background, consistent character design across all frames
```

動作描述參考(對應內建狀態語意):

| 想要的狀態 | 動作描述片段 | loop 建議 |
|---|---|---|
| idle | subtle breathing, gentle bobbing | ✓ |
| hurt | taking damage, flinching, dizzy stars | ✗ |
| cheer | jumping cheer with sparkles | ✗ |
| cry | crying, tears, drooping | ✗ |
| dance | rhythmic dancing | ✓ |

要點(易錯):
- **「single horizontal row」和「same size each frame」一定要寫**——多列或幀寬不一的圖,匯入器切不了。
- 臉朝左=本專案角色慣例(內建 Yolia 靠畫面右緣、臉朝左)。
- 生成結果幀數不一定聽話——匯入器會用「幀寬=圖高」自動猜,切錯就在匯入視窗手動改幀寬。
- 背景若不透明,先用去背工具處理再匯入。

## 匯入與使用

1. 控制面板 → 角色工房 → 擴充包 → 「＋從 spritesheet 匯入」→ 選生成的 PNG。
2. 確認切片縮圖 → 取狀態名(如 `hurt`)→ 設 ms(預設 125)/loop → 加入 → 儲存 → 啟用。
3. 工房頂部「試播」按一下,直接在 overlay 上看效果。
4. 滿意後到「桌寵設定」綁指令(如 `!痛` → hurt)。
5. 想分享:工房「匯出」得 `.yolia.json`,可場外傳給別人(對方用「匯入 .yolia.json」),
   或投稿到市集 registry(規則見該 repo README)。

## 授權提醒

AI 生成素材的散布權取決於生成服務的條款(【未查證】,自行確認);
投稿市集時,投稿者自行保證擁有散布權(registry README 免責條款)。
