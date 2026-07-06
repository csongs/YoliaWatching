// 把 database.rules.json 裡的 REPLACE_WITH_YOUR_EMAIL 換成實際的管理員 Email
// 由 GitHub Actions 呼叫，不需要手動執行
const fs = require('fs');
const path = require('path');

const email = process.env.ADMIN_EMAIL;
if (!email) throw new Error('ADMIN_EMAIL is required');

const rulesPath = path.join(__dirname, 'database.rules.json');
const content = fs.readFileSync(rulesPath, 'utf8').replace(/REPLACE_WITH_YOUR_EMAIL/g, email);
fs.writeFileSync(rulesPath, content);
console.log('[gen-database-rules] admin email set');
