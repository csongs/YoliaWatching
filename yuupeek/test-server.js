// Standalone dev server for test.html.
// Can be required as a module (used by main.js when modes.test is true)
// or run directly:  node test-server.js

const http = require('http');
const fs   = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.json': 'application/json',
};

function makeHandler(root) {
  return (req, res) => {
    if (req.url === '/commands.json') {
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          commands:    cfg.commands    ?? {},
          yoliaStates: cfg.yoliaStates ?? [],
        }));
      } catch { res.writeHead(500); res.end('{}'); }
      return;
    }

    const filePath = (req.url === '/' || req.url === '/index.html')
      ? path.join(root, 'renderer', 'test.html')
      : path.join(root, req.url);

    const rel = path.relative(root, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403); res.end(); return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
      res.end(data);
    });
  };
}

// Returns a Promise that resolves with the actual port used.
function start(root, port) {
  root = root || __dirname;
  port = port || 3001;
  return new Promise((resolve) => {
    http.createServer(makeHandler(root)).listen(port, () => {
      console.log(`[Test] http://localhost:${port}`);
      resolve(port);
    });
  });
}

module.exports = { start };

// Run directly: node test-server.js
if (require.main === module) start(__dirname, 3001);
