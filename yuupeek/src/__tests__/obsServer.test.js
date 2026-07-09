const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const WebSocket = require('ws');
const { createObsServer } = require('../obsServer');

let server;
let port;
let tmpRoot;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yoliawatching-test-'));
  fs.mkdirSync(path.join(tmpRoot, 'renderer'));
  fs.writeFileSync(path.join(tmpRoot, 'renderer', 'obs-overlay.html'), '<html>test</html>');
  server = createObsServer({ port: 0 }, tmpRoot);
  await server.start();
  port = server.port();
});

afterEach(async () => {
  await server.stop();
  fs.rmSync(tmpRoot, { recursive: true });
});

test('GET / returns 200 with HTML content', (done) => {
  http.get(`http://localhost:${port}/`, (res) => {
    expect(res.statusCode).toBe(200);
    done();
  });
});

test('broadcast sends JSON to all connected WebSocket clients', (done) => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  ws.on('open', () => {
    server.broadcast({ value: 72, state: 'cheer' });
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    expect(msg).toEqual({ value: 72, state: 'cheer' });
    ws.close();
    done();
  });
});

test('broadcast does not throw when no clients connected', () => {
  expect(() => server.broadcast({ value: 50, state: 'idle' })).not.toThrow();
});

describe('pack routes (ADR-004)', () => {
  function fetchJson(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: 'localhost', port, path: urlPath, method,
        headers: { 'Content-Type': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }));
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  test('GET/POST packs 與 active-pack 走 panelHandlers', async () => {
    const calls = {};
    server.setPanelHandlers({
      getPacks:        () => ({ a_b: { id: 'a.b' } }),
      savePack:        (p) => { calls.saved = p; },
      deletePack:      (k) => { calls.deleted = k; },
      getActivePackId: () => 'a.b',
      setActivePack:   (id) => { calls.activated = id; },
    });

    expect((await fetchJson('GET', '/panel/api/packs')).json).toEqual({ a_b: { id: 'a.b' } });

    await fetchJson('POST', '/panel/api/packs', { id: 'a.b', name: 'x' });
    expect(calls.saved).toEqual({ id: 'a.b', name: 'x' });

    await fetchJson('POST', '/panel/api/packs/delete', { key: 'a_b' });
    expect(calls.deleted).toBe('a_b');

    expect((await fetchJson('GET', '/panel/api/active-pack')).json).toEqual({ activePackId: 'a.b' });

    await fetchJson('POST', '/panel/api/active-pack', { activePackId: null });
    expect(calls.activated).toBeNull();
  });

  test('無 panelHandlers 時 packs 路由回空值不炸', async () => {
    expect((await fetchJson('GET', '/panel/api/packs')).json).toEqual({});
    expect((await fetchJson('GET', '/panel/api/active-pack')).json).toEqual({ activePackId: null });
  });
});
