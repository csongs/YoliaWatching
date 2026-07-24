// 市集分頁(layer4 設計 4c;基底設計 docs/designs/marketplace.md)— DOM 接線層。
// 雲端/桌面通用:安裝走 api.savePack,格式驗證一律 PackFormat.validatePack(不信任 registry)。
// registry URL 存 localStorage(panel 端功能,overlay 用不到,不進 RTDB/config)。
(function () {
  const root = () => document.getElementById('market-root');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const keyOf = PackFormat.packKeyOf;

  const URL_KEY = 'yolia.marketplaceUrl';
  // 無預設 registry(ADR-005:GitHub registry 路線已由中央平台取代,平台網址由
  // 各自部署決定)——未設定時顯示設定提示,填平台的 index.json REST 位址
  const DEFAULT_URL = '';

  let index = null;      // registry index 內容(正規化為陣列)
  let installed = {};    // 本地已安裝包:key → pack
  let preview = null;    // 試播中:{ id, pack, anim } 或 null

  const registryUrl = () => localStorage.getItem(URL_KEY) || DEFAULT_URL;

  // ── 事件委派(同 workshop.js 慣例:字串參數一律走 dataset)─────────────────
  root()?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, id, name } = btn.dataset;
    if (act === 'install') install(id);
    if (act === 'refresh') load(true);
    if (act === 'set-url') setUrl();
    if (act === 'preview') (preview && preview.id === id) ? closePreview() : openPreview(id);
    if (act === 'preview-anim' && preview) { preview.anim = name; render(); }
  });

  async function load(force) {
    if (force) { preview = null; stopPreviewTimer(); }
    if (index && !force) { render(); return; }
    if (!registryUrl()) { renderUnconfigured(); return; }
    root().innerHTML = '<div class="card"><p style="color:#64748b">載入市集中…</p></div>';
    try {
      installed = await api.getPacks();
    } catch (e) { installed = {}; }
    try {
      const { url, data } = await resolveIndex(registryUrl());
      index = normalizeIndex(data, url);
    } catch (e) {
      index = null;
      renderError(e);
      return;
    }
    render();
  }

  // 抓 JSON;非 2xx 或拿到 HTML 都丟錯,notIndex 標記「這裡不是資料端點」讓上層換路徑再試
  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    const isHtml = (res.headers.get('content-type') ?? '').includes('html');
    if (!res.ok || isHtml) {
      const e = new Error(res.ok ? '回應是網頁不是 JSON' : 'HTTP ' + res.status);
      e.notIndex = isHtml || res.status === 404;
      throw e;
    }
    return res.json();
  }

  // 使用者貼什麼都盡量接(依序嘗試;實測 2026-07-10,詳 docs/designs/market-platform.md)。
  // URL 猜測與 firebase-config.js 解析都是純字串邏輯,收在 PackFormat(格式邏輯一律在
  // packFormat.js,見檔頭);這裡只留三步的 fetch/try-catch 排序(I/O 編排)。
  async function resolveIndex(input) {
    const guess = PackFormat.guessIndexUrl(input);   // 步驟 1(literal)/2(補 /index.json)
    if (guess.isLiteral) return { url: guess.url, data: await fetchJson(guess.url) };
    try {
      return { url: guess.url, data: await fetchJson(guess.url) };
    } catch (e) {
      if (!e.notIndex) throw e;                      // 連線失敗/權限錯:原樣回報
    }
    try {                                             // 步驟 3:平台網站網址 → firebase-config.js
      const origin = new URL(guess.normalizedInput).origin;
      const txt = await (await fetch(origin + '/firebase-config.js', { cache: 'no-store' })).text();
      const dbUrl = PackFormat.extractIndexUrlFromFirebaseConfig(txt);
      if (dbUrl) return { url: dbUrl, data: await fetchJson(dbUrl) };
    } catch (e2) { /* 走下面的統一提示 */ }
    throw new Error('這個位址找不到市集資料。貼平台網站網址(部署版可自動偵測),或開平台首頁把最下方的 Registry URL 整串複製過來(本機 emulator 必須用這串)');
  }

  const normalizeIndex = PackFormat.normalizeIndex;

  function renderUnconfigured() {
    root().innerHTML = `
      <div class="card">
        <h3>市集</h3>
        <p style="color:#94a3b8;font-size:13px">尚未設定市集來源。直接貼市集平台的<b>網站網址</b>
        (例如 https://xxx.web.app)即可;本機 emulator 測試則貼平台首頁最下方顯示的 Registry URL 整串。</p>
        ${urlBox()}
      </div>`;
  }

  function renderError(e) {
    root().innerHTML = `
      <div class="card">
        <h3>市集</h3>
        <p style="color:#f87171;font-size:13px">無法連線市集(${esc(e.message ?? e)})。已安裝的角色包不受影響。</p>
        ${urlBox()}
      </div>`;
  }

  function urlBox() {
    return `
      <div style="display:flex;gap:8px;align-items:end;margin-top:12px;flex-wrap:wrap">
        <label style="color:#94a3b8;font-size:12px;flex:1;min-width:260px">市集位址(平台網站網址或 Registry URL 皆可)
          <input id="mk-url" value="${esc(registryUrl())}" style="width:100%"></label>
        <button class="btn btn-secondary btn-small" data-act="set-url">套用</button>
        <button class="btn btn-secondary btn-small" data-act="refresh">重新整理</button>
      </div>`;
  }

  function setUrl() {
    const v = document.getElementById('mk-url').value.trim();
    if (v && v !== DEFAULT_URL) localStorage.setItem(URL_KEY, v);
    else localStorage.removeItem(URL_KEY);
    load(true);
  }

  function render() {
    const cards = (index ?? []).map((it) => {
      const inst = installed[keyOf(it.id)];
      const canUpdate = inst && PackFormat.compareVersions(it.version, inst.version) > 0;
      const kb = it.sizeBytes ? Math.round(it.sizeBytes / 1024) + ' KB' : '';
      const status = inst
        ? (canUpdate
          ? `<button class="btn btn-small" data-act="install" data-id="${esc(it.id)}">更新到 v${esc(it.version)}</button>`
          : '<span style="color:#4ade80;font-size:12px">✓ 已安裝</span>')
        : `<button class="btn btn-small" data-act="install" data-id="${esc(it.id)}">安裝</button>`;
      const isPrev = preview && preview.id === it.id;
      const animChips = isPrev ? Object.keys(preview.pack.animations ?? {}).map((n) =>
        `<button class="btn btn-secondary btn-small" data-act="preview-anim" data-name="${esc(n)}"
                 style="${n === preview.anim ? 'border-color:#f472b6;color:#f472b6' : ''}">${esc(n)}</button>`).join('') : '';
      return `
        <div style="background:#0d111a;border:1px solid #2d3748;border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:12px">
            ${it.previewUrl ? `<img src="${esc(it.previewUrl)}" style="width:48px;height:48px;image-rendering:pixelated;background:#1a1d27;border-radius:6px">` : ''}
            <div style="flex:1">
              <b>${esc(it.name)}</b> <span style="color:#64748b;font-size:12px">v${esc(it.version)} by ${esc(it.author)} · ${esc(it.license)} ${kb ? '· ' + kb : ''}</span>
              ${it.description ? `<div style="color:#94a3b8;font-size:12px;margin-top:2px">${esc(it.description)}</div>` : ''}
            </div>
            <button class="btn btn-secondary btn-small" data-act="preview" data-id="${esc(it.id)}">${isPrev ? '收合' : '試播'}</button>
            ${status}
          </div>
          ${isPrev ? `
          <div style="display:flex;gap:12px;align-items:start;margin-top:10px;flex-wrap:wrap">
            <canvas id="mk-prev" width="96" height="96" style="image-rendering:pixelated;background:#1a1d27;border-radius:6px"></canvas>
            <div style="display:flex;gap:6px;flex-wrap:wrap">${animChips}</div>
          </div>` : ''}
        </div>`;
    }).join('');

    root().innerHTML = `
      <div class="card">
        <h3>市集</h3>
        <p style="color:#64748b;font-size:12px;margin-bottom:12px">「試播」先看效果再安裝;安裝後到「角色工房」勾選啟用。</p>
        ${cards || '<p style="color:#64748b;font-size:13px">市集目前沒有角色包。</p>'}
        ${urlBox()}
      </div>`;
    startPreviewTimer();
  }

  // ── 試播(安裝前預覽;只播 data:image/ 幀,不對外站發請求——同平台預覽的安全理由)──
  let previewTimer = null;
  function stopPreviewTimer() {
    if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
  }
  function startPreviewTimer() {
    stopPreviewTimer();
    const canvas = document.getElementById('mk-prev');
    const a = preview?.pack.animations?.[preview.anim];
    const srcs = (a?.srcs ?? []).filter((s) => typeof s === 'string' && s.startsWith('data:image/'));
    if (!canvas || !srcs.length) return;
    const ctx = canvas.getContext('2d');
    let i = 0;
    const tick = () => {
      const img = new Image();
      img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
      img.src = srcs[i % srcs.length];
      i++;
    };
    tick();
    previewTimer = setInterval(tick, a.ms ?? 150);
  }

  async function openPreview(id) {
    const it = (index ?? []).find(x => x.id === id);
    if (!it?.packUrl) { showToast('此項目缺少下載位址', true); return; }
    try {
      const res = await fetch(it.packUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const pack = await res.json();
      const v = PackFormat.validatePack(pack);          // 試播也重驗,不信任 registry
      if (!v.ok) { showToast('包驗證失敗:' + v.errors[0], true); return; }
      const anims = Object.keys(pack.animations ?? {});
      if (!anims.length) { showToast('這個包沒有動畫', true); return; }
      preview = { id, pack, anim: anims[0] };
      render();
    } catch (e) {
      showToast('試播失敗:' + (e.message ?? e), true);
    }
  }

  function closePreview() {
    preview = null;
    stopPreviewTimer();
    render();
  }

  async function install(id) {
    const it = (index ?? []).find(x => x.id === id);
    if (!it?.packUrl) { showToast('此項目缺少下載位址', true); return; }
    try {
      const res = await fetch(it.packUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const pack = await res.json();
      const v = PackFormat.validatePack(pack);          // 本地重驗,不信任 registry
      if (!v.ok) { showToast('包驗證失敗:' + v.errors[0], true); return; }
      if (pack.id !== id) { showToast('包 id 與市集條目不符,拒絕安裝', true); return; }
      await api.savePack(pack);
      installed[keyOf(pack.id)] = pack;
      render();
      showToast('已安裝「' + pack.name + '」');
      if (confirm('立即啟用「' + pack.name + '」?')) {
        // 勾選制:附加到已啟用清單;互斥規則(換角包一次只能一個)同 workshop,收在 PackFormat.selectPack
        const currentIds = await api.getActivePackIds();
        const { ids, replacedWhole } = PackFormat.selectPack(currentIds, installed, pack.id, true);
        if (replacedWhole) showToast('換角包一次只能啟用一個,已取消先前勾選的換角包');
        await api.setActivePackIds(ids);
        showToast('已啟用');
      }
    } catch (e) {
      showToast('安裝失敗:' + (e.message ?? e), true);
    }
  }

  window.Market = { load, _resolveIndex: resolveIndex, _normalizeIndex: normalizeIndex }; // 底線=測試掛鉤
})();
