// 部署前把 public/panel.html 裡的 __ADMIN_EMAIL__ 換成實際管理員 Email
// 由 firebase.json 的 predeploy 自動呼叫（sync.js 之後執行），不需要手動執行
const fs = require('fs');
const path = require('path');

const email = process.env.ADMIN_EMAIL;
const panelPath = path.join(__dirname, 'public', 'panel.html');

if (!email) {
  console.warn('[gen-panel-email] ADMIN_EMAIL not set, skipping — Google 登入白名單會維持關閉狀態');
  process.exit(0);
}

const content = fs.readFileSync(panelPath, 'utf8').replace(/__ADMIN_EMAIL__/g, email);
fs.writeFileSync(panelPath, content);
console.log('[gen-panel-email] admin email set in panel.html');
