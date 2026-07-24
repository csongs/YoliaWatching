// 桌面版角色包儲存(ADR-004):packs.json 的讀寫 + 啟用中的包合併,從 main.js 拆出來的
// 電子(Electron)無關模組——不依賴 app/BrowserWindow,可直接用 fs 對真實/暫存檔案單元測試。
const fs = require('fs');
const { packKeyOf, mergeActivePacks } = require('./packFormat');

function createPackStore(packsPath) {
  let packs = (() => {
    try { return JSON.parse(fs.readFileSync(packsPath, 'utf8')); }
    catch { return {}; }
  })();

  function persist() {
    fs.writeFileSync(packsPath, JSON.stringify(packs, null, 2), 'utf8');
  }

  return {
    getAll: () => packs,

    save(pack) {
      packs[packKeyOf(pack.id)] = pack;
      persist();
    },

    remove(key) {
      delete packs[key];
      persist();
    },

    has(id) {
      return !!packs[packKeyOf(id)];
    },

    // 給定啟用中的 id 清單(順序即勾選/合併順序),回傳合併後的動畫集;
    // 壞包(轉換丟例外)跳過並記 log,不拖垮其他包(規則見 packFormat.mergeActivePacks)。
    mergeActive(activeIds) {
      const list = (activeIds ?? []).map((id) => packs[packKeyOf(id)]).filter(Boolean);
      const { animations, errors } = mergeActivePacks(list);
      for (const err of errors) console.warn('[pack] 轉換失敗,忽略啟用中的包:', err.id, err.message);
      return animations;
    },
  };
}

module.exports = { createPackStore };
