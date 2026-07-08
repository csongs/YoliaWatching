const { validatePack } = require('../packFormat');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function extPack(overrides = {}) {
  return {
    yoliaPack: 1,
    id: 'fans.yolia-extras',
    name: '粉絲動作集',
    version: '1.0.0',
    author: 'fan',
    license: 'CC-BY-4.0',
    base: 'builtin',
    animations: { hurt: { srcs: [PNG, PNG], ms: 125, loop: false } },
    ...overrides,
  };
}

function fullPack(overrides = {}) {
  const p = extPack(overrides);
  delete p.base;
  if (!overrides.animations) p.animations = { idle: { srcs: [PNG], ms: 150, loop: true } };
  return p;
}

describe('validatePack', () => {
  test('擴充包(base:builtin)不含 idle 也通過', () => {
    expect(validatePack(extPack())).toEqual({ ok: true, errors: [] });
  });

  test('換角包(無 base)必含 idle', () => {
    const r = validatePack(fullPack({ animations: { hurt: { srcs: [PNG] } } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/idle/);
  });

  test('換角包含 idle 通過', () => {
    expect(validatePack(fullPack()).ok).toBe(true);
  });

  test('base 是不認識的值 → 拒絕並提示升級', () => {
    const r = validatePack(extPack({ base: 'v2' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/新版本/);
  });

  test('yoliaPack 版本 >1 → 拒絕並提示升級', () => {
    const r = validatePack(extPack({ yoliaPack: 2 }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/新版本/);
  });

  test('id 不合 作者.包名 格式 → 錯誤', () => {
    expect(validatePack(extPack({ id: 'NoDots' })).ok).toBe(false);
    expect(validatePack(extPack({ id: 'Upper.Case' })).ok).toBe(false);
  });

  test('必填字串欄位缺一即錯', () => {
    for (const f of ['name', 'version', 'author', 'license']) {
      expect(validatePack(extPack({ [f]: '' })).ok).toBe(false);
    }
  });

  test('license=custom 時 licenseText 必填', () => {
    expect(validatePack(extPack({ license: 'custom' })).ok).toBe(false);
    expect(validatePack(extPack({ license: 'custom', licenseText: '僅限本頻道' })).ok).toBe(true);
  });

  test('srcs 空陣列或非 data/https 開頭 → 錯誤', () => {
    expect(validatePack(extPack({ animations: { hurt: { srcs: [] } } })).ok).toBe(false);
    expect(validatePack(extPack({ animations: { hurt: { srcs: ['http://x/y.png'] } } })).ok).toBe(false);
    expect(validatePack(extPack({ animations: { hurt: { srcs: ['https://x/y.png'] } } })).ok).toBe(true);
  });

  test('ms 超界或 loop 非布林 → 錯誤', () => {
    expect(validatePack(extPack({ animations: { hurt: { srcs: [PNG], ms: 0 } } })).ok).toBe(false);
    expect(validatePack(extPack({ animations: { hurt: { srcs: [PNG], ms: 20000 } } })).ok).toBe(false);
    expect(validatePack(extPack({ animations: { hurt: { srcs: [PNG], loop: 'yes' } } })).ok).toBe(false);
  });

  test('狀態名不合 ^[a-z][a-z0-9_]*$ → 錯誤', () => {
    expect(validatePack(extPack({ animations: { 'Bad-Name': { srcs: [PNG] } } })).ok).toBe(false);
  });

  test('動畫總數 >32 → 錯誤', () => {
    const anims = {};
    for (let i = 0; i < 33; i++) anims['a' + i] = { srcs: [PNG] };
    expect(validatePack(extPack({ animations: anims })).ok).toBe(false);
  });

  test('單一動畫 >32 幀 → 錯誤', () => {
    expect(validatePack(extPack({ animations: { hurt: { srcs: Array(33).fill(PNG) } } })).ok).toBe(false);
  });

  test('defaultInteractions 含 id → 錯誤;合法項通過', () => {
    const it = { trigger: 'command', match: ['!痛'], animation: 'hurt', yolia_see: 0, response: '好痛!' };
    expect(validatePack(extPack({ defaultInteractions: [it] })).ok).toBe(true);
    expect(validatePack(extPack({ defaultInteractions: [{ ...it, id: 'c_abcd' }] })).ok).toBe(false);
    expect(validatePack(extPack({ defaultInteractions: [{ trigger: 'weird' }] })).ok).toBe(false);
  });

  test('未知欄位忽略不報錯(向前相容)', () => {
    expect(validatePack(extPack({ meta: { x: 1 }, futureField: true })).ok).toBe(true);
  });

  test('非物件輸入不炸', () => {
    expect(validatePack(null).ok).toBe(false);
    expect(validatePack('{}').ok).toBe(false);
  });
});
