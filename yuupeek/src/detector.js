const { exec } = require('child_process');
const { STREAM_KEYWORDS, BARON_KEYWORDS } = require('./config');

function getAllWindowTitles() {
  return new Promise((resolve) => {
    const cmd =
      'powershell.exe -NoProfile -Command "' +
      'Get-Process | Where-Object { $_.MainWindowTitle -ne \\"\\" } | ' +
      'Select-Object -ExpandProperty MainWindowTitle"';

    exec(cmd, { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve([]);
      const titles = stdout.split('\n').map(t => t.trim()).filter(Boolean);
      resolve(titles);
    });
  });
}

function matchesStream(titles) {
  const lower = titles.map(t => t.toLowerCase());
  return STREAM_KEYWORDS.some(kw => lower.some(t => t.includes(kw.toLowerCase())));
}

function matchesBaron(titles) {
  const lower = titles.map(t => t.toLowerCase());
  return BARON_KEYWORDS.some(kw => lower.some(t => t.includes(kw.toLowerCase())));
}

module.exports = { getAllWindowTitles, matchesStream, matchesBaron };
