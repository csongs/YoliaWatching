(function () {
  const L = window.ChatMonitorLabels;
  const PLATFORMS = ['twitch', 'youtube', 'soop'];

  const FIELD_DEFS = {
    twitch: [
      { key: 'channel', label: 'Twitch 頻道名稱', placeholder: '例如 altheayolia', type: 'text' },
      { key: 'oauthToken', label: 'OAuth Token（選填，留空可匿名讀取聊天，但收不到訂閱/Bits 以外資訊）', placeholder: 'oauth:xxxxxxxx', type: 'password' },
    ],
    youtube: [
      { key: 'channel', label: 'YouTube handle 或頻道 ID(免 API Key)', placeholder: '例如 @altheayolia 或 UCxxxx', type: 'text' },
    ],
    soop: [
      { key: 'channel', label: 'SOOP 主播 ID (streamerId)', placeholder: '例如 altheayolia', type: 'text' },
      { key: 'apiMode', label: 'SOOP 連線方式', type: 'select', options: [
        { value: 'community', label: '社群模式（soop-extension）' },
        { value: 'official', label: '官方 API 模式（尚未實作）', disabled: true },
      ] },
    ],
  };

  let settings = { twitch: {}, youtube: {}, soop: {} };
  // 尚未存檔的欄位修改,切分頁或收到 WS 狀態推播觸發 renderForm() 重繪都不會遺失
  // (renderForm 用 settings 疊 edits 畫表單,每次輸入變動都同步寫回 edits)。
  let edits = { twitch: {}, youtube: {}, soop: {} };
  let status = { twitch: {}, youtube: {}, soop: {} };
  let activeTab = 'twitch';
  let events = [];
  let filterPlatform = '';
  let filterCategory = '';

  const $tabs = document.getElementById('platformTabs');
  const $form = document.getElementById('settingsForm');
  const $btnSaveAll = document.getElementById('btnSaveAll');
  const $appVersion = document.getElementById('appVersion');
  const $chatLog = document.getElementById('chatLog');
  const $dbInfo = document.getElementById('dbInfo');
  const $donationNotes = document.getElementById('donationNotes');
  const $wsState = document.getElementById('wsState');
  const $filterPlatform = document.getElementById('filterPlatform');
  const $filterCategory = document.getElementById('filterCategory');
  const $toggleTimestamps = document.getElementById('toggleTimestamps');

  function statusDotClass(platform) {
    const s = status[platform] || {};
    if (s.error) return 'err';
    // 「直播中」(YouTube 的 live)跟「已連線」(Twitch/SOOP 的 connected)語意不同,用不同顏色
    // 區隔,不要讓使用者誤以為兩者是同一件事。
    if (s.live) return 'live';
    if (s.connected) return 'connected';
    return '';
  }

  function statusLineText(platform) {
    const s = status[platform] || {};
    if (s.error) return { text: '⚠ ' + s.error, cls: 'err' };
    if (platform === 'youtube') return s.live ? { text: '● 直播中，監聽訊息中', cls: 'live' } : { text: '○ 目前沒有偵測到直播', cls: '' };
    return s.connected ? { text: '● 已連線', cls: 'connected' } : { text: '○ 未連線', cls: '' };
  }

  function renderTabs() {
    $tabs.innerHTML = '';
    for (const p of PLATFORMS) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (p === activeTab ? ' active' : '');
      btn.innerHTML = `<span class="dot ${statusDotClass(p)}"></span>${L.platformLabel(p)}`;
      btn.onclick = () => { activeTab = p; renderTabs(); renderForm(); };
      $tabs.appendChild(btn);
    }
  }

  function renderForm() {
    const p = activeTab;
    const cfg = { ...settings[p], ...edits[p] };
    const defs = FIELD_DEFS[p];
    const line = statusLineText(p);

    let html = '';
    html += `<div class="field row"><input type="checkbox" id="f_enabled" ${cfg.enabled ? 'checked' : ''}> <label for="f_enabled" style="margin:0;">啟用監聽</label></div>`;
    for (const d of defs) {
      html += `<div class="field"><label>${d.label}</label>`;
      if (d.type === 'select') {
        html += `<select id="f_${d.key}">` + d.options.map((o) => `<option value="${o.value}" ${cfg[d.key] === o.value ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}>${o.label}</option>`).join('') + `</select>`;
      } else if (d.type === 'password') {
        html += `<div class="field-secret">`
          + `<input type="password" id="f_${d.key}" placeholder="${d.placeholder || ''}" value="${cfg[d.key] ?? ''}" autocomplete="off">`
          + `<button type="button" class="toggle-visibility" data-target="f_${d.key}" title="顯示/隱藏">👁</button>`
          + `</div>`;
      } else {
        html += `<input type="text" id="f_${d.key}" placeholder="${d.placeholder || ''}" value="${cfg[d.key] ?? ''}" autocomplete="off">`;
      }
      html += `</div>`;
    }
    html += `<div class="status-line ${line.cls}">${line.text}</div>`;
    html += `<button class="save" id="btnSave">儲存並套用</button>`;
    html += `<div class="save-hint">只儲存「${L.platformLabel(p)}」這個分頁</div>`;
    $form.innerHTML = html;

    document.getElementById('btnSave').onclick = () => saveActiveTab();
    // input/change 委派到整個表單:切分頁或 WS 狀態推播觸發重繪前,先把目前打的字同步進 edits,
    // 不會因為重繪就消失。
    $form.oninput = () => captureFormInto(p);
    $form.onchange = () => captureFormInto(p);
    for (const btn of $form.querySelectorAll('.toggle-visibility')) {
      btn.onclick = () => {
        const input = document.getElementById(btn.dataset.target);
        input.type = input.type === 'password' ? 'text' : 'password';
      };
    }
  }

  function captureFormInto(p) {
    const enabledEl = document.getElementById('f_enabled');
    if (!enabledEl) return; // 表單還沒渲染
    const cfg = { enabled: enabledEl.checked };
    for (const d of FIELD_DEFS[p]) cfg[d.key] = document.getElementById(`f_${d.key}`).value;
    edits[p] = cfg;
  }

  function buildBody(p) {
    const cfg = { ...settings[p], ...edits[p] };
    const body = { enabled: !!cfg.enabled };
    for (const d of FIELD_DEFS[p]) body[d.key] = (cfg[d.key] ?? '').toString().trim();
    return body;
  }

  async function saveOne(p) {
    if (p === activeTab) captureFormInto(p);
    const res = await fetch(`/api/settings/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody(p)) });
    const saved = await res.json();
    settings[p] = saved;
    edits[p] = {};
  }

  async function saveActiveTab() {
    await saveOne(activeTab);
    renderForm();
    setTimeout(refreshStatus, 800); // 給 connector 一點時間連線再刷新狀態
  }

  async function saveAllSettings() {
    $btnSaveAll.disabled = true;
    $btnSaveAll.textContent = '儲存中…';
    try {
      await Promise.all(PLATFORMS.map(saveOne));
    } finally {
      $btnSaveAll.disabled = false;
      $btnSaveAll.textContent = '三個平台一起儲存並套用';
    }
    renderForm();
    setTimeout(refreshStatus, 800);
  }

  function renderDonationNotes() {
    $donationNotes.innerHTML = L.PLATFORM_DONATION_NOTES.map((n) =>
      `<div class="note-item"><b>${n.title}</b>：${n.note}</div>`
    ).join('');
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  async function refreshDbInfo() {
    const info = await (await fetch('/api/db-info')).json();
    $dbInfo.innerHTML = `
      <div>檔案位置：<code>${info.path}</code></div>
      <div style="margin-top:6px;">目前共 <b style="color:var(--text)">${info.count}</b> 筆事件，檔案大小 ${fmtBytes(info.fileSizeBytes)}</div>
      <div style="margin-top:6px;">想清空歷史紀錄：關閉伺服器後直接刪除上面這個檔案（含 .sqlite / -wal / -shm）即可，重開伺服器會自動重建空白資料庫。平台設定也存在同一個檔案裡，一併刪除後會用 yuupeek/config.json 的既有頻道設定重新帶入。</div>
    `;
  }

  function eventLabel(evt) {
    return L.labelFor(evt.event_type);
  }
  function eventCategory(evt) {
    return L.categoryFor(evt.event_type);
  }

  function passesFilter(evt) {
    if (filterPlatform && evt.platform !== filterPlatform) return false;
    if (filterCategory && eventCategory(evt) !== filterCategory) return false;
    return true;
  }

  function renderLine(evt) {
    const cat = eventCategory(evt);
    const div = document.createElement('div');
    div.className = 'chat-line' + (cat === 'donation' ? ' donation' : cat === 'system' ? ' system' : '');
    const dt = new Date(evt.received_at);
    const time = dt.toLocaleTimeString('zh-TW', { hour12: false });
    const fullDateTime = dt.toLocaleString('zh-TW', { hour12: false }); // hover 用,含日期,跨天監聽也看得出來
    const amount = evt.amount ? `<span class="amount">+${evt.amount}</span>` : '';
    const msg = evt.message ? escapeHtml(evt.message) : '';
    // 一般聊天訊息(event_type 'chat')每則都會重複同一個灰色「一般訊息」標籤,量大時是純雜訊,
    // 省略不顯示;抖內/會員/系統通知等特殊事件的類型標籤還是保留,因為那才是使用者想一眼看到的資訊。
    const typeTag = evt.event_type === 'chat' ? '' : `<span class="tag type">${eventLabel(evt)}</span>`;
    // 每行時間戳顏色一致,要不要顯示交給使用者用工具列的「顯示時間戳」勾選框控制
    // (CSS 用 .chat-log.hide-timestamps .time { display:none } 整批切換,不用重繪)。
    div.innerHTML = `<span class="time" title="${fullDateTime}">${time}</span>`
      + `<span class="tag ${evt.platform}">${L.platformLabel(evt.platform)}</span>`
      + typeTag
      + (evt.username ? `<span class="uname">${escapeHtml(evt.username)}</span>` : '')
      + msg + amount;
    return div;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderChatLog() {
    const visible = events.filter(passesFilter);
    $chatLog.innerHTML = '';
    if (visible.length === 0) {
      $chatLog.innerHTML = '<div class="empty-hint">尚無訊息，啟用左側平台設定後開始監聽</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const evt of visible) frag.appendChild(renderLine(evt));
    $chatLog.appendChild(frag);
    $chatLog.scrollTop = $chatLog.scrollHeight;
  }

  function appendEvent(evt) {
    events.push(evt);
    if (events.length > 2000) events.shift();
    if (passesFilter(evt)) {
      const wasAtBottom = $chatLog.scrollTop + $chatLog.clientHeight >= $chatLog.scrollHeight - 20;
      if ($chatLog.querySelector('.empty-hint')) $chatLog.innerHTML = '';
      $chatLog.appendChild(renderLine(evt));
      if (wasAtBottom) $chatLog.scrollTop = $chatLog.scrollHeight;
    }
  }

  async function refreshStatus() {
    status = await (await fetch('/api/status')).json();
    renderTabs();
    renderForm();
  }

  async function loadInitial() {
    settings = await (await fetch('/api/settings')).json();
    status = await (await fetch('/api/status')).json();
    events = await (await fetch('/api/history?limit=300')).json();
    renderTabs();
    renderForm();
    renderChatLog();
    refreshDbInfo();
    // debug 開關狀態不在頁面顯示(對一般使用者是雜訊)——啟動伺服器時終端機那行已經有講,
    // /api/version 仍然回傳 debug 欄位,需要的話可以直接 curl 那支 API 查。
    const { version } = await (await fetch('/api/version')).json();
    $appVersion.textContent = `v${version}`;

    const prefs = await (await fetch('/api/prefs')).json();
    const showTimestamps = prefs.showTimestamps ?? true; // 沒存過就預設顯示
    $toggleTimestamps.checked = showTimestamps;
    $chatLog.classList.toggle('hide-timestamps', !showTimestamps);
  }

  function connectWs() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => { $wsState.textContent = '● 即時連線中'; };
    ws.onclose = () => { $wsState.textContent = '○ 連線中斷，5 秒後重試'; setTimeout(connectWs, 5000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'event') {
        appendEvent(msg.data);
        refreshDbInfo();
      } else if (msg.type === 'status') {
        status[msg.platform] = msg.data;
        renderTabs();
        if (activeTab === msg.platform) renderForm();
      }
    };
  }

  $filterPlatform.onchange = () => { filterPlatform = $filterPlatform.value; renderChatLog(); };
  $filterCategory.onchange = () => { filterCategory = $filterCategory.value; renderChatLog(); };
  $toggleTimestamps.onchange = () => {
    const checked = $toggleTimestamps.checked;
    $chatLog.classList.toggle('hide-timestamps', !checked);
    fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showTimestamps: checked }) });
  };
  $btnSaveAll.onclick = () => saveAllSettings();

  renderDonationNotes();
  loadInitial();
  connectWs();
})();
