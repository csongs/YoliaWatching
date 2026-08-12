// 把 chat-monitor 打包成「原始碼 + install.bat/start.bat」的資料夾與 zip,方便直接丟給別人
// 測試(不用他們自己裝 Node.js、不用 clone repo)。輸出到 release/(已加進 chat-monitor/.gitignore,
// 不會被 commit)。install.bat/start.bat/使用說明.txt 的可編輯版本放在 packaging/(有 git 追蹤),
// 每次打包都從那邊複製最新版,不要直接改 release/ 底下的副本——下次打包會被蓋掉。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_NAME = 'YoliaChatMonitor-source';
const RELEASE_DIR = path.join(ROOT, 'release');
const OUT_DIR = path.join(RELEASE_DIR, OUT_NAME);
const OUT_ZIP = path.join(RELEASE_DIR, `${OUT_NAME}.zip`);

// 直接照抄的原始碼檔案/資料夾(排除 node_modules、data、release、.env——跟 chat-monitor/.gitignore
// 排除的東西一致,這裡沒有用 .gitignore 本身去過濾,是因為要打包的清單本來就很短,手動列更清楚)。
const SOURCE_ENTRIES = ['server.js', 'db.js', 'package.json', 'package-lock.json', 'connectors', 'public', 'lib'];

// packaging/ 底下的可編輯範本,複製時改名(install.bat/start.bat/使用說明.txt 本身不用改名,
// 只是強調來源是 packaging/,不是每次手動改 release/ 裡的副本)。
const TEMPLATE_ENTRIES = ['install.bat', 'start.bat', '使用說明.txt'];

function main() {
  // 清空 OUT_DIR 的內容,但不刪掉資料夾本身再重建——Windows 上如果有 Explorer 視窗或終端機
  // cd 在這個資料夾裡,rmdir 整個資料夾會撞到「resource busy or locked」,但刪資料夾「裡面」
  // 的東西不會有這個問題。
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of fs.readdirSync(OUT_DIR)) {
    fs.rmSync(path.join(OUT_DIR, name), { recursive: true, force: true });
  }
  fs.rmSync(OUT_ZIP, { force: true });

  for (const entry of SOURCE_ENTRIES) {
    fs.cpSync(path.join(ROOT, entry), path.join(OUT_DIR, entry), { recursive: true });
  }
  for (const entry of TEMPLATE_ENTRIES) {
    fs.cpSync(path.join(ROOT, 'packaging', entry), path.join(OUT_DIR, entry));
  }
  fs.writeFileSync(path.join(OUT_DIR, '.gitignore'), 'node_modules/\ndata/\n.env\ndb-location.json\n');

  console.log(`[package] 原始碼已複製到 ${OUT_DIR}`);

  // Compress-Archive 是 Windows 內建的,不用額外裝 zip 工具——這個工具本來就只給 Windows 使用者
  // (install.bat/start.bat 是 .bat),所以不用考慮跨平台壓縮。
  const result = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path "${OUT_DIR}\\*" -DestinationPath "${OUT_ZIP}" -Force`,
  ], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error('[package] 壓縮失敗(Compress-Archive 回傳非 0),資料夾版本仍在 release/ 底下可用。');
    process.exit(1);
  }
  console.log(`[package] 已壓縮成 ${OUT_ZIP}`);
}

main();
