// 市集分頁(layer4 設計 4c;基底設計 docs/designs/marketplace.md)— DOM 接線層。
// 雲端/桌面通用:安裝走 api.savePack,格式驗證一律 PackFormat.validatePack(不信任 registry)。
// registry URL 存 localStorage(panel 端功能,overlay 用不到,不進 RTDB/config)。
(function () {
  const root = () => document.getElementById('market-root');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const keyOf = (id) => String(id).replace(/\./g, '_');

  const URL_KEY = 'yolia.marketplaceUrl';
  // 無預設 registry(ADR-005:GitHub registry 路線已由中央平台取代,平台網址由
  // 各自部署決定)——未設定時顯示設定提示,填平台的 index.json REST 位址
  const DEFAULT_URL = '';

  let index = null;      // registry index 內容(正規化為陣列)
  let installed = {};    // 本地已安裝包:key → pack

  const registryUrl = () => localStorage.getItem(URL_KEY) || DEFAULT_URL;

  // ── 事件委派(同 workshop.js 慣例:字串參數一律走 dataset)─────────────────
  root()?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'install') install(id);
    if (act === 'refresh') load(true);
    if (act === 'set-url') setUrl();
  });

  async function load(force) {
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

  // 使用者貼什麼都盡量接(依序嘗試;實測 2026-07-10,詳 docs/designs/market-platform.md):
  //   1. 含 /index.json → 原樣抓(平台首頁底部顯示的 Registry URL)
  //   2. 資料庫根網址(可帶 ?ns=,emulator 用)→ 補 /index.json 再抓
  //   3. 平台網站網址 → 抓站上部署的 firebase-config.js 挖 databaseURL
  async function resolveIndex(input) {
    let u = String(input).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    if (/\/index\.json(\?|$)/.test(u)) return { url: u, data: await fetchJson(u) };
    const qi = u.indexOf('?');
    const guess = qi === -1 ? u + '/index.json'
      : u.slice(0, qi).replace(/\/+$/, '') + '/index.json' + u.slice(qi);
    try {
      return { url: guess, data: await fetchJson(guess) };
    } catch (e) {
      if (!e.notIndex) throw e;                      // 連線失敗/權限錯:原樣回報
    }
    try {
      const origin = new URL(u).origin;
      const txt = await (await fetch(origin + '/firebase-config.js', { cache: 'no-store' })).text();
      const m = txt.match(/databaseURL:\s*["']([^"']+)["']/);
      if (m) {
        const dbUrl = m[1].replace(/\/+$/, '') + '/index.json';
        return { url: dbUrl, data: await fetchJson(dbUrl) };
      }
    } catch (e2) { /* 走下面的統一提示 */ }
    throw new Error('這個位址找不到市集資料。貼平台網站網址(部署版可自動偵測),或開平台首頁把最下方的 Registry URL 整串複製過來(本機 emulator 必須用這串)');
  }

  // 兩種 index 格式都收(ADR-005):
  //   陣列 = GitHub registry(每項自帶 packUrl)
  //   物件 = 中央平台 RTDB REST 的 /index.json(key→條目;packUrl 由 registry 根組出
  //          `<根>/packs/<key>.json`,即平台 /packs 節點的 REST 端點)
  // 查詢字串要原樣帶到 packUrl——RTDB emulator 靠 ?ns=<namespace> 選資料庫,丟掉就 404
  function normalizeIndex(data, url) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    const m = String(url).match(/^(.*?)\/index\.json(\?.*)?$/);
    const base = m ? m[1] : String(url).replace(/\/index\.json.*$/, '');
    const qs = (m && m[2]) || '';
    return Object.entries(data).map(([key, it]) => ({
      ...it,
      packUrl: it.packUrl ?? (base + '/packs/' + key + '.json' + qs),
    }));
  }

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
      return `
        <div style="display:flex;align-items:center;gap:12px;background:#0d111a;border:1px solid #2d3748;border-radius:8px;padding:12px;margin-bottom:10px">
          ${it.previewUrl ? `<img src="${esc(it.previewUrl)}" style="width:48px;height:48px;image-rendering:pixelated;background:#1a1d27;border-radius:6px">` : ''}
          <div style="flex:1">
            <b>${esc(it.name)}</b> <span style="color:#64748b;font-size:12px">v${esc(it.version)} by ${esc(it.author)} · ${esc(it.license)} ${kb ? '· ' + kb : ''}</span>
            ${it.description ? `<div style="color:#94a3b8;font-size:12px;margin-top:2px">${esc(it.description)}</div>` : ''}
          </div>
          ${status}
        </div>`;
    }).join('');

    root().innerHTML = `
      <div class="card">
        <h3>市集</h3>
        <p style="color:#64748b;font-size:12px;margin-bottom:12px">安裝後到「角色工房」啟用;投稿方式見 registry repo 的 README。</p>
        ${cards || '<p style="color:#64748b;font-size:13px">市集目前沒有角色包。</p>'}
        ${urlBox()}
      </div>`;
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
        await api.setActivePack(pack.id);
        showToast('已啟用');
      }
    } catch (e) {
      showToast('安裝失敗:' + (e.message ?? e), true);
    }
  }

  window.Market = { load, _resolveIndex: resolveIndex, _normalizeIndex: normalizeIndex }; // 底線=測試掛鉤
})();
