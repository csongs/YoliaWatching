# ADR-003:擴充包用選填 `base:"builtin"` 欄位表達——粉絲幫內建角色加動作

- 狀態:已採納(2026-07-07,維護者核可)
- 依賴文件:docs/specs/character-pack-format.md(格式細節)、docs/designs/fan-extension-pack.md(流程與工單)

## 問題

粉絲會提供單一動作的 spritesheet(如 `00_hurt_sheet.png`,畫的是內建 Yolia 本人的新動作)。
角色包規格(ADR-002 採納時)只有「整隻換角」模型:必含 idle、缺漏狀態映射到包的 idle、
不混搭內建圖。「幫現有角色加一個動作」塞不進這個模型。

## 決策

角色包格式加選填欄位 `base`:值恰為 `"builtin"` 時=**擴充包**——動畫疊在內建角色之上、
不要求 idle、包內沒有的狀態維持內建動畫。缺省=原整隻換角語意,一切不變。
`activePackId` 仍單值(v1 不支援多包同時啟用;多個粉絲動作加進同一個擴充包)。

符合 PLAYBOOK §3:純 additive(規格 §8 第 7 條「未知欄位忽略」保證舊讀取端不炸;
舊 overlay 根本不讀 /packs)。`base` 存在但非 `"builtin"` → 拒絕匯入,保留未來取值空間。

## 考慮過的替代方案

| 方案 | 不採納原因 |
|---|---|
| 不改規格:匯入器把內建素材(81 PNG ≈3.5 MB)轉 data URL 打包成完整包再加粉絲動作 | base64 後 ≈4.7 MB,超過包上限 4 MB,死路 |
| 新頂層節點 /customAnimations 與包系統平行 | 兩套自訂動畫來源,未來做整隻換角/市集時要整合遷移;維護者已明示要與包系統相容 |
| data URL 動畫直接寫 config/animations | 違反 ADR-001 紅線 1(大資料進 /config,整節點訂閱每次設定變更整包重推) |
