const { validatePack, packToAnimations, sliceGeometry, defaultLoop, applyDefaultInteractions, buildAnimationsUpdate, mergeActivePacks, isValidStateName, compareVersions, packKeyOf, resolveActivePackIds, packIdsCompatFields, selectPack, guessIndexUrl, extractIndexUrlFromFirebaseConfig, normalizeIndex, moveFrame, duplicateFrame, deleteFrame, MAX_FRAMES_PER_ANIM, DEFAULT_MS_SPRITESHEET, DEFAULT_MS_PER_FRAME_FILES, compareNatural } = require('../packFormat');

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

describe('mergeActivePacks(多包勾選制,2026-07-11)', () => {
  const PNG2 = 'data:image/png;base64,QQ==';

  test('空清單/null → animations:null(只用內建)', () => {
    expect(mergeActivePacks([]).animations).toBeNull();
    expect(mergeActivePacks(null).animations).toBeNull();
    expect(mergeActivePacks([null, undefined]).animations).toBeNull();
  });

  test('單一擴充包=packToAnimations 原行為', () => {
    const r = mergeActivePacks([extPack()]);
    expect(r.animations).toEqual(packToAnimations(extPack()));
    expect(r.errors).toEqual([]);
  });

  test('兩個擴充包合併,同名動畫後蓋前', () => {
    const a = extPack({ id: 'a.one', animations: { hurt: { srcs: [PNG], ms: 100, loop: false } } });
    const b = extPack({ id: 'b.two', animations: { hurt: { srcs: [PNG2], ms: 200, loop: true }, dance: { srcs: [PNG2], ms: 150, loop: true } } });
    const r = mergeActivePacks([a, b]);
    expect(r.animations.hurt.srcs).toEqual([PNG2]);
    expect(r.animations.dance).toBeTruthy();
  });

  test('換角包永遠墊底:就算勾在擴充包之後,擴充動作仍蓋得到', () => {
    const ext = extPack({ animations: { idle: { srcs: [PNG2], ms: 99, loop: true } } });
    const whole = fullPack();   // idle=PNG,並填滿已知狀態
    const r = mergeActivePacks([ext, whole]);
    expect(r.animations.idle.srcs).toEqual([PNG2]);   // 擴充蓋換角
    expect(r.animations.wave).toBeTruthy();           // 換角包的已知狀態映射仍在
  });

  test('壞包跳過並回報,其他包不受影響', () => {
    const bad = fullPack({ animations: { hurt: { srcs: [PNG] } } });  // 換角包缺 idle → packToAnimations 丟例外
    const r = mergeActivePacks([bad, extPack()]);
    expect(r.animations.hurt).toBeTruthy();
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].id).toBe(bad.id);
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

describe('packKeyOf', () => {
  test('id 的「.」換成底線', () => {
    expect(packKeyOf('fans.yolia-extras')).toBe('fans_yolia-extras');
  });
});

describe('resolveActivePackIds(舊 activePackId ↔ 新 activePackIds 相容折算)', () => {
  test('有 activePackIds 陣列:直接回傳(濾掉非字串/空字串)', () => {
    expect(resolveActivePackIds({ activePackIds: ['a.one', '', 42, 'b.two'] })).toEqual(['a.one', 'b.two']);
  });
  test('只有舊欄位 activePackId:折成單元素陣列', () => {
    expect(resolveActivePackIds({ activePackId: 'a.one' })).toEqual(['a.one']);
  });
  test('activePackIds 優先於 activePackId(就算前者是空陣列)', () => {
    expect(resolveActivePackIds({ activePackIds: [], activePackId: 'a.one' })).toEqual([]);
  });
  test('兩者都沒有:空陣列', () => {
    expect(resolveActivePackIds({})).toEqual([]);
    expect(resolveActivePackIds(undefined)).toEqual([]);
  });
});

describe('packIdsCompatFields(寫回新舊相容欄位)', () => {
  test('非空陣列:activePackIds=原陣列,activePackId=第一個', () => {
    expect(packIdsCompatFields(['a.one', 'b.two'])).toEqual({ activePackIds: ['a.one', 'b.two'], activePackId: 'a.one' });
  });
  test('空陣列/非陣列輸入:兩欄位都是 null', () => {
    expect(packIdsCompatFields([])).toEqual({ activePackIds: null, activePackId: null });
    expect(packIdsCompatFields(undefined)).toEqual({ activePackIds: null, activePackId: null });
  });
});

describe('selectPack(換角包互斥規則)', () => {
  const whole1 = { id: 'w.one', base: undefined };
  const whole2 = { id: 'w.two', base: undefined };
  const ext1   = extPack({ id: 'e.one' });
  const packsByKey = { w_one: whole1, w_two: whole2, e_one: ext1 };

  test('啟用一個換角包,目前沒有其他換角包:直接加入', () => {
    const r = selectPack([], packsByKey, 'w.one', true);
    expect(r).toEqual({ ids: ['w.one'], replacedWhole: false });
  });

  test('啟用第二個換角包:頂掉第一個,標記 replacedWhole', () => {
    const r = selectPack(['w.one'], packsByKey, 'w.two', true);
    expect(r).toEqual({ ids: ['w.two'], replacedWhole: true });
  });

  test('擴充包不受換角包互斥規則限制,可疊加', () => {
    const r = selectPack(['w.one'], packsByKey, 'e.one', true);
    expect(r).toEqual({ ids: ['w.one', 'e.one'], replacedWhole: false });
  });

  test('停用(on=false):只移除,不觸發互斥規則', () => {
    const r = selectPack(['w.one', 'e.one'], packsByKey, 'w.one', false);
    expect(r).toEqual({ ids: ['e.one'], replacedWhole: false });
  });

  test('id 在 packsByKey 查不到(如已刪除的包):視為非換角包,不觸發互斥', () => {
    const r = selectPack(['w.one'], packsByKey, 'missing.pack', true);
    expect(r).toEqual({ ids: ['w.one', 'missing.pack'], replacedWhole: false });
  });
});

describe('guessIndexUrl(市集位址→候選 index.json URL)', () => {
  test('已經是 index.json:原樣使用,isLiteral=true', () => {
    expect(guessIndexUrl('https://x.web.app/index.json')).toEqual({
      url: 'https://x.web.app/index.json', isLiteral: true, normalizedInput: 'https://x.web.app/index.json',
    });
  });
  test('保留查詢字串(RTDB emulator 的 ?ns=)', () => {
    const r = guessIndexUrl('https://x.web.app/index.json?ns=demo');
    expect(r).toEqual({ url: 'https://x.web.app/index.json?ns=demo', isLiteral: true, normalizedInput: 'https://x.web.app/index.json?ns=demo' });
  });
  test('網站網址:補 /index.json', () => {
    const r = guessIndexUrl('x.web.app');
    expect(r).toEqual({ url: 'https://x.web.app/index.json', isLiteral: false, normalizedInput: 'https://x.web.app' });
  });
  test('資料庫根網址帶 ?ns=:補在 /index.json 之後,查詢字串不遺失', () => {
    const r = guessIndexUrl('https://x.web.app?ns=demo');
    expect(r.url).toBe('https://x.web.app/index.json?ns=demo');
    expect(r.isLiteral).toBe(false);
  });
  test('沒有 https:// 前綴一律補上', () => {
    expect(guessIndexUrl('x.web.app').url).toBe('https://x.web.app/index.json');
  });
});

describe('extractIndexUrlFromFirebaseConfig', () => {
  test('挖得到 databaseURL:組出 index.json 位址', () => {
    const text = "const FIREBASE_CONFIG = { databaseURL: 'https://x-default-rtdb.firebaseio.com/' };";
    expect(extractIndexUrlFromFirebaseConfig(text)).toBe('https://x-default-rtdb.firebaseio.com/index.json');
  });
  test('挖不到:回傳 null', () => {
    expect(extractIndexUrlFromFirebaseConfig('not a config file')).toBeNull();
    expect(extractIndexUrlFromFirebaseConfig(undefined)).toBeNull();
  });
});

describe('normalizeIndex(市集 index 格式相容,ADR-005)', () => {
  test('陣列格式(GitHub registry)原樣回傳', () => {
    const arr = [{ id: 'a.one', packUrl: 'https://x/a.one.json' }];
    expect(normalizeIndex(arr, 'https://x/index.json')).toBe(arr);
  });
  test('物件格式(中央平台):補出 packUrl,保留查詢字串', () => {
    const data = { a_one: { id: 'a.one', name: 'A' } };
    const r = normalizeIndex(data, 'https://x-default-rtdb.firebaseio.com/index.json?ns=demo');
    expect(r).toEqual([{ id: 'a.one', name: 'A', packUrl: 'https://x-default-rtdb.firebaseio.com/packs/a_one.json?ns=demo' }]);
  });
  test('物件格式已有 packUrl:不覆蓋', () => {
    const data = { a_one: { id: 'a.one', packUrl: 'https://cdn.example/a.json' } };
    const r = normalizeIndex(data, 'https://x/index.json');
    expect(r[0].packUrl).toBe('https://cdn.example/a.json');
  });
  test('不是陣列也不是物件:空陣列', () => {
    expect(normalizeIndex(null, 'https://x/index.json')).toEqual([]);
  });
});

describe('moveFrame(幀編輯器)', () => {
  test('往右移:交換位置,index 跟著移動的幀走', () => {
    expect(moveFrame(['a', 'b', 'c'], 0, 1)).toEqual({ ok: true, srcs: ['b', 'a', 'c'], index: 1 });
  });
  test('往左移', () => {
    expect(moveFrame(['a', 'b', 'c'], 2, -1)).toEqual({ ok: true, srcs: ['a', 'c', 'b'], index: 1 });
  });
  test('已在陣列頭/尾:邊界外靜默略過(ok:false,無 error)', () => {
    expect(moveFrame(['a', 'b'], 0, -1)).toEqual({ ok: false });
    expect(moveFrame(['a', 'b'], 1, 1)).toEqual({ ok: false });
  });
  test('不動原陣列', () => {
    const srcs = ['a', 'b'];
    moveFrame(srcs, 0, 1);
    expect(srcs).toEqual(['a', 'b']);
  });
});

describe('duplicateFrame(幀編輯器)', () => {
  test('複製選取的幀,插在其後', () => {
    expect(duplicateFrame(['a', 'b'], 0)).toEqual({ ok: true, srcs: ['a', 'a', 'b'], index: 0 });
  });
  test('達到 MAX_FRAMES_PER_ANIM 上限:拒絕並回錯誤訊息', () => {
    const srcs = Array(MAX_FRAMES_PER_ANIM).fill('x');
    expect(duplicateFrame(srcs, 0)).toEqual({ ok: false, error: '已達單一動畫 ' + MAX_FRAMES_PER_ANIM + ' 幀上限' });
  });
});

describe('deleteFrame(幀編輯器)', () => {
  test('刪除選取的幀,index 夾到新陣列範圍內', () => {
    expect(deleteFrame(['a', 'b', 'c'], 2)).toEqual({ ok: true, srcs: ['a', 'b'], index: 1 });
  });
  test('只剩一幀時拒絕刪除', () => {
    expect(deleteFrame(['a'], 0)).toEqual({ ok: false, error: '至少要留一幀' });
  });
});

describe('匯入精靈 ms 預設與自然排序', () => {
  test('DEFAULT_MS_SPRITESHEET/DEFAULT_MS_PER_FRAME_FILES 符合規格 §7', () => {
    expect(DEFAULT_MS_SPRITESHEET).toBe(125);
    expect(DEFAULT_MS_PER_FRAME_FILES).toBe(150);
  });
  test('compareNatural:數字視為數值比較,不是逐字元比較', () => {
    const names = ['frame10.png', 'frame2.png', 'frame1.png'];
    expect([...names].sort(compareNatural)).toEqual(['frame1.png', 'frame2.png', 'frame10.png']);
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
