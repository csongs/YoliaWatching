const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.gif':  'image/gif',
};

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function parseEnvFile(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function formatEnvFile(data) {
  return Object.entries(data).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

function isNewer(tag, current) {
  const a = tag.replace(/^v/, '').split('.').map(Number);
  const b = current.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function createObsServer(config, rootDir) {
  const obsConfig = config.obs ?? config;
  const root = rootDir ?? path.join(__dirname, '..');
  let httpServer = null;
  let wss = null;
  let welcomeData = null;
  let clientMsgHandler = null;
  let panelHandlers = null;

  const requestHandler = (req, res) => {
    // ── Panel routes ────────────────────────────────────────────────────────────

    if (req.url === '/panel' || req.url === '/panel/') {
      fs.readFile(path.join(root, 'renderer', 'panel.html'), (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }

    if (req.url === '/panel/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(panelHandlers?.getStatus?.() ?? {}));
      return;
    }

    if (req.url === '/panel/api/env' && req.method === 'GET') {
      const envPath = path.join(panelHandlers?.appDir ?? root, '.env');
      let data = {};
      try { data = parseEnvFile(fs.readFileSync(envPath, 'utf8')); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        TWITCH_OAUTH:    data.TWITCH_OAUTH    ?? '',
        YOUTUBE_API_KEY: data.YOUTUBE_API_KEY ?? '',
      }));
      return;
    }

    if (req.url === '/panel/api/env' && req.method === 'POST') {
      readBody(req).then(body => {
        const envPath = path.join(panelHandlers?.appDir ?? root, '.env');
        let existing = {};
        try { existing = parseEnvFile(fs.readFileSync(envPath, 'utf8')); } catch {}
        const { TWITCH_OAUTH, YOUTUBE_API_KEY } = body;
        if (TWITCH_OAUTH    !== undefined) existing.TWITCH_OAUTH    = TWITCH_OAUTH;
        if (YOUTUBE_API_KEY !== undefined) existing.YOUTUBE_API_KEY = YOUTUBE_API_KEY;
        fs.writeFileSync(envPath, formatEnvFile(existing), 'utf8');
        panelHandlers?.saveEnv?.({ TWITCH_OAUTH, YOUTUBE_API_KEY });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }

    if (req.url === '/panel/api/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(panelHandlers?.getConfig?.() ?? {}));
      return;
    }

    if (req.url === '/panel/api/config' && req.method === 'POST') {
      readBody(req).then(body => {
        panelHandlers?.saveConfig?.(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }

    if (req.url === '/panel/api/version' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ current: panelHandlers?.getVersion?.() ?? '0.0.0' }));
      return;
    }

    if (req.url === '/panel/api/check-update' && req.method === 'GET') {
      const current = panelHandlers?.getVersion?.() ?? '0.0.0';
      fetch('https://api.github.com/repos/csongs/YoliaWatching/releases/latest', {
        headers: { 'User-Agent': 'YoliaWatching' },
      })
        .then(r => r.json())
        .then(data => {
          const tag = data.tag_name ?? '';
          const latest = tag.replace(/^v/, '');
          const hasUpdate = !!latest && isNewer(tag, current);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ current, latest, hasUpdate, url: data.html_url ?? '' }));
        })
        .catch(e => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ current, error: e.message }));
        });
      return;
    }

    if (req.url === '/panel/api/paths' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ userDataDir: panelHandlers?.userDataDir ?? '' }));
      return;
    }

    if (req.url === '/panel/api/open-userdata' && req.method === 'POST') {
      panelHandlers?.openUserDataDir?.();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/panel/api/open-url' && req.method === 'POST') {
      readBody(req).then(body => {
        if (body.url) panelHandlers?.openUrl?.(body.url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }

    if (req.url === '/panel/api/open-config' && req.method === 'POST') {
      panelHandlers?.openConfigFile?.();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/panel/api/pet-toggle' && req.method === 'POST') {
      panelHandlers?.togglePet?.();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === '/panel/api/sprite-frames' && req.method === 'GET') {
      const spritesDir = path.join(root, 'assets', 'sprites', 'frames');
      const result = {};
      try {
        const folders = fs.readdirSync(spritesDir).filter(f =>
          fs.statSync(path.join(spritesDir, f)).isDirectory()
        );
        for (const folder of folders) {
          const indices = fs.readdirSync(path.join(spritesDir, folder))
            .filter(f => /^\d+\.png$/i.test(f))
            .map(f => parseInt(f, 10))
            .sort((a, b) => a - b);
          if (indices.length) result[folder] = indices;
        }
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.url === '/panel/api/animations' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(panelHandlers?.getAnimations?.() ?? {}));
      return;
    }

    if (req.url === '/panel/api/animations' && req.method === 'POST') {
      readBody(req).then(body => {
        panelHandlers?.saveAnimations?.(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }

    if (req.url === '/panel/api/pet-config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(panelHandlers?.getPetConfig?.() ?? {}));
      return;
    }

    if (req.url === '/panel/api/pet-config' && req.method === 'POST') {
      readBody(req).then(body => {
        panelHandlers?.savePetConfig?.(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch(() => { res.writeHead(500); res.end(); });
      return;
    }

    if (req.url === '/panel/api/metrics' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(panelHandlers?.getMetrics?.() ?? {}));
      return;
    }

    // ── Existing routes ─────────────────────────────────────────────────────────

    if (req.url === '/obs-config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ scale: obsConfig.scale ?? 1 }));
      return;
    }

    if (req.url === '/commands.json') {
      const animData = panelHandlers?.getAnimations?.() ?? {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        greetingAnimations: config.greetingAnimations ?? [],
        animations:         animData.animations       ?? animData,
      }));
      return;
    }

    let filePath;
    if (req.url === '/' || req.url === '/index.html') {
      filePath = path.join(root, 'renderer', 'obs-overlay.html');
    } else {
      filePath = path.join(root, req.url);
    }

    const rel = path.relative(root, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403);
      res.end();
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(data);
    });
  };

  return {
    start() {
      return new Promise((resolve) => {
        httpServer = http.createServer(requestHandler);
        wss = new WebSocket.Server({ server: httpServer });
        wss.on('connection', (client) => {
          if (welcomeData) client.send(JSON.stringify(welcomeData));
          client.on('message', (data) => {
            try { if (clientMsgHandler) clientMsgHandler(JSON.parse(data.toString())); } catch {}
          });
        });
        httpServer.listen(obsConfig.port ?? 3000, resolve);
      });
    },
    stop() {
      return new Promise((resolve) => {
        wss?.close();
        httpServer?.close(resolve);
      });
    },
    port() {
      return httpServer?.address()?.port;
    },
    broadcast(data) {
      const msg = JSON.stringify(data);
      wss?.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });
    },
    setWelcomeData(data) {
      welcomeData = data;
    },
    onClientMessage(handler) {
      clientMsgHandler = handler;
    },
    setPanelHandlers(handlers) {
      panelHandlers = handlers;
    },
  };
}

module.exports = { createObsServer };
