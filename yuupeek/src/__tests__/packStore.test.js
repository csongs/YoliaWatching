const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPackStore } = require('../packStore');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function extPack(id, overrides = {}) {
  return {
    yoliaPack: 1, id, name: id, version: '1.0.0', author: 'fan', license: 'CC-BY-4.0', base: 'builtin',
    animations: { hurt: { srcs: [PNG], ms: 125, loop: false } },
    ...overrides,
  };
}

let tmpRoot, packsPath;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yoliawatching-packstore-'));
  packsPath = path.join(tmpRoot, 'packs.json');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true });
});

test('packs.json 不存在時:getAll 回傳空物件,不炸', () => {
  const store = createPackStore(packsPath);
  expect(store.getAll()).toEqual({});
});

test('save 後可用 has()/getAll() 查到,且落地到 packs.json', () => {
  const store = createPackStore(packsPath);
  const pack = extPack('fans.yolia-extras');
  store.save(pack);
  expect(store.has('fans.yolia-extras')).toBe(true);
  expect(store.getAll()['fans_yolia-extras']).toEqual(pack);

  const onDisk = JSON.parse(fs.readFileSync(packsPath, 'utf8'));
  expect(onDisk['fans_yolia-extras']).toEqual(pack);
});

test('remove:用 key(底線版)刪除', () => {
  const store = createPackStore(packsPath);
  store.save(extPack('fans.yolia-extras'));
  store.remove('fans_yolia-extras');
  expect(store.has('fans.yolia-extras')).toBe(false);
  expect(JSON.parse(fs.readFileSync(packsPath, 'utf8'))).toEqual({});
});

test('重新開啟(new createPackStore)讀得到先前存的包', () => {
  const store1 = createPackStore(packsPath);
  store1.save(extPack('fans.yolia-extras'));
  const store2 = createPackStore(packsPath);
  expect(store2.has('fans.yolia-extras')).toBe(true);
});

test('mergeActive:依 activeIds 合併,壞包不拖垮其他包', () => {
  const store = createPackStore(packsPath);
  store.save(extPack('a.one'));
  const animations = store.mergeActive(['a.one']);
  expect(animations.hurt).toBeTruthy();
});

test('mergeActive:activeIds 含不存在的 id,直接忽略', () => {
  const store = createPackStore(packsPath);
  expect(store.mergeActive(['missing.pack'])).toBeNull();
});
