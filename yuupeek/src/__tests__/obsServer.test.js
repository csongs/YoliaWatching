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
