const { validatePack, packToAnimations, sliceGeometry, defaultLoop, applyDefaultInteractions, buildAnimationsUpdate, isValidStateName, compareVersions } = require('../packFormat');

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

describe('packToAnimations', () => {
  test('擴充包:原樣輸出,不補 idle、不映射已知狀態', () => {
    const r = packToAnimations(extPack());
    expect(Object.keys(r)).toEqual(['hurt']);
    expect(r.hurt).toEqual({ srcs: [PNG, PNG], ms: 125, loop: false });
  });

  test('換角包:已知狀態缺漏一律映射到包的 idle', () => {
    const r = packToAnimations(fullPack());
    for (const s of ['idle', 'peek', 'cheer', 'cry', 'eat', 'jump', 'wave', 'run_left', 'run_right', 'watch_excited']) {
      expect(r[s].srcs).toEqual([PNG]);
    }
  });

  test('換角包:自有動畫保留,全新狀態名直接註冊', () => {
    const p = fullPack();
    p.animations.attack = { srcs: [PNG, PNG], ms: 100, loop: false };
    const r = packToAnimations(p);
    expect(r.attack.srcs).toHaveLength(2);
    expect(r.peek.srcs).toEqual(p.animations.idle.srcs); // 映射
  });

  test('loop 缺省時輸出 false(布林化)', () => {
    const p = extPack({ animations: { hurt: { srcs: [PNG] } } });
    expect(packToAnimations(p).hurt.loop).toBe(false);
  });
});

describe('sliceGeometry(規格 §7)', () => {
  test('省略幀寬 → 猜圖高;1712×214 切 8 幀', () => {
    const r = sliceGeometry(1712, 214);
    expect(r).toMatchObject({ ok: true, frameW: 214, count: 8 });
    expect(r.rects[0]).toEqual({ x: 0, y: 0, w: 214, h: 214 });
    expect(r.rects[7]).toEqual({ x: 1498, y: 0, w: 214, h: 214 });
  });

  test('不整除 → 報錯訊息含兩個數字', () => {
    const r = sliceGeometry(1712, 200);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/1712/);
    expect(r.error).toMatch(/200/);
  });

  test('手動指定幀寬覆蓋猜測', () => {
    expect(sliceGeometry(1712, 214, 856)).toMatchObject({ ok: true, count: 2 });
  });

  test('幀寬非正整數 → 錯誤', () => {
    expect(sliceGeometry(100, 0).ok).toBe(false);
    expect(sliceGeometry(100, 50, -2).ok).toBe(false);
  });
});

describe('defaultLoop(規格 §7 名稱慣例)', () => {
  test('idle/run_*/walk* 預設循環,其餘單次', () => {
    expect(defaultLoop('idle')).toBe(true);
    expect(defaultLoop('run_left')).toBe(true);
    expect(defaultLoop('walking')).toBe(true);
    expect(defaultLoop('hurt')).toBe(false);
    expect(defaultLoop('wave')).toBe(false);
  });
});

describe('applyDefaultInteractions', () => {
  const genId = (t) => (t === 'command' ? 'c' : t === 'keyword' ? 'k' : 't') + '_test';

  test('新互動取得現生成的 id 並加入', () => {
    const pack = [{ trigger: 'command', match: ['!痛'], animation: 'hurt', yolia_see: 0, response: '好痛!' }];
    const { merged, added, skipped } = applyDefaultInteractions(pack, [], genId);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('c_test');
    expect(merged).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  test('同 match 已存在 → 跳過並回報', () => {
    const existing = [{ id: 'c_old', trigger: 'command', match: '!痛', animation: 'cry' }];
    const pack = [{ trigger: 'command', match: ['!痛'], animation: 'hurt' }];
    const { merged, added, skipped } = applyDefaultInteractions(pack, existing, genId);
    expect(added).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(merged).toEqual(existing);
  });

  test('threshold(無 match)一律加入', () => {
    const pack = [{ trigger: 'threshold', min: 50, state: 'hurt' }];
    const { added } = applyDefaultInteractions(pack, [], genId);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('t_test');
  });
});

describe('buildAnimationsUpdate(桌面版合併/清殘留,ADR-004)', () => {
  const base = { idle: { srcs: [PNG], loop: true }, wave: { srcs: [PNG], loop: false } };

  test('啟用擴充包:snapshot 含包動畫,packStates 回報包鍵', () => {
    const r = buildAnimationsUpdate(base, { hurt: { srcs: [PNG], loop: false } }, []);
    expect(Object.keys(r.snapshot)).toEqual(['idle', 'wave', 'hurt']);
    expect(r.broadcast.hurt).toEqual({ srcs: [PNG], loop: false });
    expect(r.packStates).toEqual(['hurt']);
  });

  test('停用:上一包的自訂狀態在 broadcast 設 null,snapshot 不含', () => {
    const r = buildAnimationsUpdate(base, null, ['hurt']);
    expect(r.snapshot.hurt).toBeUndefined();
    expect('hurt' in r.snapshot).toBe(false);
    expect(r.broadcast.hurt).toBeNull();
    expect(r.packStates).toEqual([]);
  });

  test('切換包:舊包獨有鍵清除,新包鍵保留', () => {
    const r = buildAnimationsUpdate(base, { dance: { srcs: [PNG], loop: true } }, ['hurt']);
    expect(r.broadcast.hurt).toBeNull();
    expect(r.broadcast.dance).toBeTruthy();
    expect(r.packStates).toEqual(['dance']);
  });

  test('上一包覆蓋過內建鍵:停用後回內建值,不設 null', () => {
    const r = buildAnimationsUpdate(base, null, ['wave']);
    expect(r.broadcast.wave).toEqual(base.wave);
  });

  test('prototype 屬性名(constructor)也能正確清除', () => {
    const r = buildAnimationsUpdate(base, null, ['constructor']);
    expect(r.broadcast.constructor).toBeNull();
  });

  test('無包無殘留:snapshot 與 broadcast 相同,等於 base', () => {
    const r = buildAnimationsUpdate(base, null, []);
    expect(r.snapshot).toEqual(base);
    expect(r.broadcast).toEqual(base);
  });
});

describe('isValidStateName', () => {
  test('合法/非法狀態名', () => {
    expect(isValidStateName('hurt')).toBe(true);
    expect(isValidStateName('run_left2')).toBe(true);
    expect(isValidStateName('Bad')).toBe(false);
    expect(isValidStateName('1abc')).toBe(false);
    expect(isValidStateName(null)).toBe(false);
  });
});

describe('compareVersions(市集更新判斷)', () => {
  test('semver 比較', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);   // 數字比較,非字串
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);      // 缺段補 0
  });
  test('非法輸入不炸,當 0 處理', () => {
    expect(compareVersions('abc', '1.0.0')).toBeLessThan(0);
    expect(compareVersions(undefined, undefined)).toBe(0);
  });
});

describe('validatePack 追加規則(2026-07-10 收緊)', () => {
  test('srcs 含引號/空白/角括號 → 拒絕', () => {
    for (const bad of ['data:image/png;base64,x" onerror="x', 'data:image/png;base64,a b', 'https://x/<s>.png']) {
      expect(validatePack(extPack({ animations: { hurt: { srcs: [bad] } } })).ok).toBe(false);
    }
  });

  test('4MB 上限以 UTF-8 位元組計', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024);
    expect(validatePack(extPack({ animations: { hurt: { srcs: [big] } } })).ok).toBe(false);
  });
});
