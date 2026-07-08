// 角色工房(僅雲端版)— DOM 接線層;格式邏輯一律在 packFormat.js(規格 §9,不得重複實作)。
// 由 panel.html initApp 的 IS_WEB 分支以 loadScript 載入。依賴全域:api、showToast、PackFormat。
(function () {
  const root = () => document.getElementById('workshop-root');
  const keyOf = (id) => String(id).replace(/\./g, '_');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let packs = {};          // RTDB /packs 全量:key → pack
  let activePackId = null; // pack.id(含「.」)或 null(=內建 Yolia)
  let working = null;      // 編輯中的包(記憶體工作副本;儲存才寫 RTDB)
  let dirty = false;

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // ── 事件委派(data-act)────────────────────────────────────────────────────
  // #workshop-root 從頁面載入就存在(panel.html),在此裝一次即可,不必等 load()。
  // 用意:避免字串參數塞進 inline onclick 造成引號逃逸(XSS);key/id/name 一律走
  // dataset 讀取,不再拼字串進 HTML 屬性以外的 JS 上下文。
  root()?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, key, id, name } = btn.dataset;
    // data-act 派發表(Task 9 將於此擴充動畫幀編輯器等真正實作)
    switch (act) {
      case 'activate':          activate(id); break;
      case 'activate-builtin':  activate(null); break;
      case 'edit':              edit(key); break;
      case 'remove':            remove(key); break;
      case 'edit-anim':         window.Workshop._editAnim(name); break;
      case 'remove-anim':       removeAnim(name); break;
    }
  });

  // ── 檔案/圖片工具 ─────────────────────────────────────────────────────────
  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  function loadImage(dataUrl) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = dataUrl;
    });
  }
  function sliceImage(img, geo) {   // 規格 §7 步驟 4:canvas 逐幀切片轉 data URL
    return geo.rects.map((r) => {
      const c = document.createElement('canvas');
      c.width = r.w; c.height = r.h;
      c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      return c.toDataURL('image/png');
    });
  }
  function pickFiles(accept, multiple) {
    return new Promise((res) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
      inp.onchange = () => res([...inp.files]);
      inp.click();
    });
  }

  // ── 進入點 ────────────────────────────────────────────────────────────────
  async function load() {
    if (working) { renderEditor(); return; }   // 編輯到一半切回分頁:維持編輯畫面
    try {
      [packs, activePackId] = await Promise.all([api.getPacks(), api.getActivePackId()]);
    } catch (e) {
      showToast('載入角色包失敗', true);
      return;
    }
    renderPackList();
  }

  // ── ① 包清單 ─────────────────────────────────────────────────────────────
  function renderPackList() {
    const cards = Object.entries(packs).map(([key, p]) => {
      const isActive = p.id === activePackId;
      const type = p.base === 'builtin' ? '擴充包' : '換角包';
      const n = Object.keys(p.animations ?? {}).length;
      return `
        <div style="display:flex;align-items:center;gap:10px;background:#0d111a;border:1px solid ${isActive ? '#f472b6' : '#2d3748'};border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="flex:1">
            <b>${esc(p.name)}</b> <span style="color:#64748b;font-size:12px">v${esc(p.version)} by ${esc(p.author)} · ${type} · ${n} 動畫</span>
          </div>
          ${isActive
            ? '<span style="color:#f472b6;font-size:12px">● 啟用中</span>'
            : `<button class="btn btn-secondary btn-small" data-act="activate" data-id="${esc(p.id)}">啟用</button>`}
          <button class="btn btn-secondary btn-small" data-act="edit" data-key="${esc(key)}">編輯</button>
          <button class="btn btn-secondary btn-small" style="color:#f87171;border-color:#f87171" data-act="remove" data-key="${esc(key)}">刪除</button>
        </div>`;
    }).join('');

    root().innerHTML = `
      <div class="card">
        <h3>我的角色包</h3>
        <div style="display:flex;align-items:center;gap:10px;background:#0d111a;border:1px solid ${activePackId ? '#2d3748' : '#f472b6'};border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="flex:1"><b>內建 Yolia</b> <span style="color:#64748b;font-size:12px">預設角色,不可刪除</span></div>
          ${activePackId
            ? '<button class="btn btn-secondary btn-small" data-act="activate-builtin">啟用</button>'
            : '<span style="color:#f472b6;font-size:12px">● 啟用中</span>'}
        </div>
        ${cards}
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-small" onclick="Workshop._create('builtin')">＋新增擴充包(為內建角色加動作)</button>
          <button class="btn btn-secondary btn-small" onclick="Workshop._create(null)">＋新增換角包(整隻新角色)</button>
          <button class="btn btn-secondary btn-small" onclick="Workshop._importJson()">匯入 .yolia.json</button>
        </div>
      </div>`;
  }

  async function activate(idOrNull) {
    try {
      await api.setActivePack(idOrNull);
      activePackId = idOrNull;
      renderPackList();
      showToast(idOrNull ? '已啟用角色包' : '已切回內建 Yolia');
    } catch (e) {
      showToast('啟用失敗:' + (e.message ?? e), true);
    }
  }

  function create(base) {
    working = {
      yoliaPack: 1,
      id: base === 'builtin' ? 'fans.yolia-extras' : 'me.my-character',
      name: base === 'builtin' ? '粉絲動作集' : '我的角色',
      version: '1.0.0',
      author: '',
      license: 'CC-BY-4.0',
      animations: {},
    };
    if (base === 'builtin') working.base = 'builtin';
    dirty = false;
    renderEditor();
  }

  function edit(key) {
    working = JSON.parse(JSON.stringify(packs[key]));   // 深拷貝:儲存前不動原資料
    dirty = false;
    renderEditor();
  }

  // ── 來源 C:.yolia.json 直接入庫 ─────────────────────────────────────────
  async function importJson() {
    const [file] = await pickFiles('.json,application/json', false);
    if (!file) return;
    let pack;
    try {
      pack = JSON.parse(await file.text());
    } catch (e) {
      showToast('不是有效的 JSON 檔', true);
      return;
    }
    const v = PackFormat.validatePack(pack);
    if (!v.ok) { showToast(v.errors[0], true); return; }
    const n = Object.keys(pack.animations).length;
    const kb = Math.round(JSON.stringify(pack).length / 1024);
    if (!confirm(`匯入「${pack.name}」?\n${n} 個動畫,約 ${kb} KB,授權 ${pack.license}`)) return;
    try {
      await api.savePack(pack);
      packs[keyOf(pack.id)] = pack;
      renderPackList();
      showToast('已匯入角色包');
    } catch (e) {
      showToast('儲存失敗:' + (e.message ?? e), true);
    }
  }

  // ── ②③ 編輯器畫面(manifest + 動畫清單;幀編輯器在 Task 9 補上)────────────
  function renderEditor() {
    const w = working;
    const rows = Object.entries(w.animations).map(([name, a]) => `
      <div style="display:flex;align-items:center;gap:10px;background:#0d111a;border:1px solid #2d3748;border-radius:8px;padding:10px;margin-bottom:8px">
        <img src="${esc(a.srcs[0])}" style="width:36px;height:36px;image-rendering:pixelated;background:#1a1d27;border-radius:4px">
        <div style="flex:1"><b>${esc(name)}</b> <span style="color:#64748b;font-size:12px">${a.srcs.length} 幀 · ${a.ms ?? 150}ms · ${a.loop ? '循環' : '單次'}</span></div>
        <button class="btn btn-secondary btn-small" data-act="edit-anim" data-name="${esc(name)}">編輯</button>
        <button class="btn btn-secondary btn-small" style="color:#f87171;border-color:#f87171" data-act="remove-anim" data-name="${esc(name)}">刪除</button>
      </div>`).join('');

    root().innerHTML = `
      <div class="card">
        <h3>${w.base === 'builtin' ? '擴充包(疊加在內建 Yolia 上)' : '換角包(整隻角色,必含 idle)'}</h3>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px">
          <label style="color:#94a3b8;font-size:12px">包 ID(作者.包名,全小寫)<input id="wk-id" value="${esc(w.id)}" style="width:100%" oninput="Workshop._touch()"></label>
          <label style="color:#94a3b8;font-size:12px">名稱<input id="wk-name" value="${esc(w.name)}" style="width:100%" oninput="Workshop._touch()"></label>
          <label style="color:#94a3b8;font-size:12px">作者<input id="wk-author" value="${esc(w.author)}" style="width:100%" oninput="Workshop._touch()"></label>
          <label style="color:#94a3b8;font-size:12px">授權<select id="wk-license" style="width:100%" oninput="Workshop._touch()">
            ${['CC0-1.0', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'custom'].map(l => `<option${l === w.license ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label>
        </div>
        <h3>動畫清單</h3>
        ${rows || '<p style="color:#64748b;font-size:13px">尚無動畫,從下方匯入。</p>'}
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-small" onclick="Workshop._importSheet()">＋從 spritesheet 匯入</button>
          <button class="btn btn-secondary btn-small" onclick="Workshop._importFrames()">＋從逐幀圖匯入</button>
        </div>
        <div id="wk-wizard"></div>
        <div id="wk-frame-editor"></div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-small" onclick="Workshop._save()">儲存包</button>
          <button class="btn btn-secondary btn-small" onclick="Workshop._cancel()">返回列表</button>
        </div>
      </div>`;
  }

  function readManifest() {
    working.id      = document.getElementById('wk-id').value.trim();
    working.name    = document.getElementById('wk-name').value.trim();
    working.author  = document.getElementById('wk-author').value.trim();
    working.license = document.getElementById('wk-license').value;
  }

  // ── 匯入精靈:來源 A(spritesheet)──────────────────────────────────────────
  let wizard = null; // { frames: dataURL[], img, sheetUrl } 切片工作區

  async function importSheet() {
    const [file] = await pickFiles('image/png', false);
    if (!file) return;
    if (file.type !== 'image/png') {
      showToast('請提供 PNG spritesheet(不收 webp/gif,生成工具請選 PNG 輸出)', true);
      return;
    }
    const url = await readAsDataURL(file);
    const img = await loadImage(url);
    wizard = { img, sheetUrl: url, frames: [] };
    reslice(img.height);   // 規格 §7 步驟 1:猜幀寬=圖高
  }

  function reslice(frameW) {
    if (!wizard?.img) return;   // 來源 B(逐幀圖)沒有 sheet,幀寬欄不適用
    const geo = PackFormat.sliceGeometry(wizard.img.naturalWidth, wizard.img.naturalHeight, frameW);
    if (!geo.ok) {
      document.getElementById('wk-wizard').innerHTML = `
        <div style="background:#0d111a;border:1px solid #f87171;border-radius:8px;padding:12px;margin-top:12px">
          <p style="color:#f87171;font-size:13px">${esc(geo.error)}</p>
          ${frameWInput(frameW)}
        </div>`;
      return;
    }
    wizard.frames = sliceImage(wizard.img, geo);
    renderWizard(geo.frameW);
  }

  function frameWInput(v) {
    return `<label style="color:#94a3b8;font-size:12px">幀寬(px)
      <input id="wk-framew" type="text" inputmode="numeric" value="${v}" style="width:80px"
             onchange="Workshop._reslice(parseInt(this.value,10))"></label>`;
  }

  function renderWizard(frameW) {
    const thumbs = wizard.frames.map((f, i) =>
      `<img src="${f}" title="幀 ${i}" style="width:48px;height:48px;image-rendering:pixelated;background:#1a1d27;border:1px solid #2d3748;border-radius:4px">`
    ).join('');
    const knownOpts = PackFormat.KNOWN_STATES.map(s => `<option>${s}</option>`).join('');
    document.getElementById('wk-wizard').innerHTML = `
      <div style="background:#0d111a;border:1px solid #2d3748;border-radius:8px;padding:12px;margin-top:12px">
        <p style="color:#94a3b8;font-size:12px;margin-bottom:8px">切片結果(切得不對?改幀寬重切):</p>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${thumbs}</div>
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          ${frameWInput(frameW)}
          <label style="color:#94a3b8;font-size:12px">狀態名
            <input id="wk-anim-name" list="wk-known-states" value="hurt" style="width:120px">
            <datalist id="wk-known-states">${knownOpts}</datalist></label>
          <label style="color:#94a3b8;font-size:12px">每幀 ms
            <input id="wk-anim-ms" type="text" inputmode="numeric" value="125" style="width:60px"></label>
          <label style="color:#94a3b8;font-size:12px;display:flex;align-items:center;gap:4px">
            <input id="wk-anim-loop" type="checkbox"> 循環</label>
          <button class="btn btn-small" onclick="Workshop._addAnim()">加入動畫</button>
        </div>
      </div>`;
    const nameInp = document.getElementById('wk-anim-name');
    nameInp.onchange = () => {
      document.getElementById('wk-anim-loop').checked = PackFormat.defaultLoop(nameInp.value.trim());
    };
  }

  // ── 匯入精靈:來源 B(逐幀圖,按檔名排序)─────────────────────────────────
  async function importFrames() {
    const files = await pickFiles('image/png', true);
    if (!files.length) return;
    if (files.some(f => f.type !== 'image/png')) { showToast('逐幀圖限 PNG', true); return; }
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const frames = [];
    for (const f of files) frames.push(await readAsDataURL(f));
    wizard = { frames };
    renderWizard('—');                                 // 無 sheet,幀寬欄不適用
    document.getElementById('wk-anim-ms').value = '150'; // 來源 B 預設 ms=150(規格 §7)
  }

  function addAnim() {
    const name = document.getElementById('wk-anim-name').value.trim();
    const ms   = parseInt(document.getElementById('wk-anim-ms').value, 10);
    const loop = document.getElementById('wk-anim-loop').checked;
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { showToast('狀態名限小寫英文開頭+小寫英數底線', true); return; }
    if (!wizard?.frames?.length) { showToast('沒有可加入的幀', true); return; }
    if (working.animations[name] && !confirm(`動畫「${name}」已存在,要覆蓋嗎?`)) return;
    working.animations[name] = { srcs: wizard.frames, ms: Number.isFinite(ms) ? ms : 125, loop };
    wizard = null;
    dirty = true;
    renderEditor();
  }

  function removeAnim(name) {
    if (!confirm(`刪除動畫「${name}」?`)) return;
    delete working.animations[name];
    dirty = true;
    renderEditor();
  }

  // ── 儲存/返回/刪除 ────────────────────────────────────────────────────────
  async function save() {
    readManifest();
    const v = PackFormat.validatePack(working);
    if (!v.ok) { showToast(v.errors[0], true); return; }
    try {
      await api.savePack(working);
      packs[keyOf(working.id)] = working;
      dirty = false;
      showToast('已儲存角色包');
      if (working.id !== activePackId && confirm('立即啟用這個角色包?')) await activate(working.id);
      working = null;
      renderPackList();
    } catch (e) {
      showToast('儲存失敗:' + (e.message ?? e), true);
    }
  }

  function cancel() {
    if (dirty && !confirm('有未儲存的變更,確定離開?')) return;
    working = null;
    wizard = null;
    renderPackList();
  }

  async function remove(key) {
    const p = packs[key];
    if (!p) return;
    let hint = '';
    try {
      const cfg = await api.getPetConfig();
      const states = new Set(Object.keys(p.animations ?? {}));
      const bound = (cfg.interactions ?? []).filter(i => states.has(i.animation) || states.has(i.state));
      if (bound.length) hint = `\n注意:有 ${bound.length} 個互動綁定此包的動畫,刪除後將回退未知狀態行為。`;
    } catch (e) { /* 查不到綁定就不提示,不阻擋刪除 */ }
    if (!confirm(`刪除角色包「${p.name}」?${hint}`)) return;
    try {
      await api.deletePack(key);
      if (p.id === activePackId) { await api.setActivePack(null); activePackId = null; }
      delete packs[key];
      renderPackList();
      showToast('已刪除');
    } catch (e) {
      showToast('刪除失敗:' + (e.message ?? e), true);
    }
  }

  window.Workshop = {
    load,
    _activate: activate, _create: create, _edit: edit, _remove: remove,
    _importJson: importJson, _importSheet: importSheet, _importFrames: importFrames,
    _reslice: reslice, _addAnim: addAnim, _removeAnim: removeAnim,
    _save: save, _cancel: cancel,
    _touch: () => { dirty = true; },
    _editAnim: () => showToast('幀編輯器尚未就緒(下一任務)', true), // Task 9 覆蓋
  };
})();
