(function () {
  const L = window.ChatMonitorLabels;
  const PLATFORMS = ['twitch', 'youtube', 'soop'];

  const FIELD_DEFS = {
    twitch: [
      { key: 'channel', label: 'Twitch 頻道名稱', placeholder: '例如 altheayolia', type: 'text' },
      { key: 'oauthToken', label: 'OAuth Token（選填，留空可匿名讀取聊天，但收不到訂閱/Bits 以外資訊）', placeholder: 'oauth:xxxxxxxx', type: 'password' },
    ],
    youtube: [
      { key: 'channel', label: 'YouTube handle 或頻道 ID', placeholder: '例如 @altheayolia 或 UCxxxx', type: 'text' },
      { key: 'apiKey', label: 'YouTube API Key', placeholder: 'AIzaSy...', type: 'password' },
    ],
    soop: [
      { key: 'channel', label: 'SOOP 主播 ID (streamerId)', placeholder: '例如 altheayolia', type: 'text' },
      { key: 'apiMode', label: 'SOOP 連線方式', type: 'select', options: [
        { value: 'community', label: '社群模式（soop-extension，可用）' },
        { value: 'official', label: '官方 API 模式（尚未實作）' },
      ] },
    ],
  };

  let settings = { twitch: {}, youtube: {}, soop: {} };
  let status = { twitch: {}, youtube: {}, soop: {} };
  let activeTab = 'twitch';
  let events = [];
  let filterPlatform = '';
  let filterCategory = '';

  const $tabs = document.getElementById('platformTabs');
  const $form = document.getElementById('settingsForm');
  const $chatLog = document.getElementById('chatLog');
  const $dbInfo = document.getElementById('dbInfo');
  const $donationNotes = document.getElementById('donationNotes');
  const $wsState = document.getElementById('wsState');
  const $filterPlatform = document.getElementById('filterPlatform');
  const $filterCategory = document.getElementById('filterCategory');

  function statusDotClass(platform) {
    const s = status[platform] || {};
    if (s.error) return 'err';
    if (s.connected || s.live) return 'on';
    return '';
  }

  function statusLineText(platform) {
    const s = status[platform] || {};
    if (s.error) return { text: '⚠ ' + s.error, cls: 'err' };
    if (platform === 'youtube') return s.live ? { text: '● 直播中，監聽訊息中', cls: 'ok' } : { text: '○ 目前沒有偵測到直播', cls: '' };
    return s.connected ? { text: '● 已連線', cls: 'ok' } : { text: '○ 未連線', cls: '' };
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
    const cfg = settings[p] || {};
    const defs = FIELD_DEFS[p];
    const line = statusLineText(p);

    let html = '';
    html += `<div class="field row"><input type="checkbox" id="f_enabled" ${cfg.enabled ? 'checked' : ''}> <label for="f_enabled" style="margin:0;">啟用監聽</label></div>`;
    for (const d of defs) {
      html += `<div class="field"><label>${d.label}</label>`;
      if (d.type === 'select') {
        html += `<select id="f_${d.key}">` + d.options.map((o) => `<option value="${o.value}" ${cfg[d.key] === o.value ? 'selected' : ''}>${o.label}</option>`).join('') + `</select>`;
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
    $form.innerHTML = html;

    document.getElementById('btnSave').onclick = () => saveSettings(p, defs);
    for (const btn of $form.querySelectorAll('.toggle-visibility')) {
      btn.onclick = () => {
        const input = document.getElementById(btn.dataset.target);
        input.type = input.type === 'password' ? 'text' : 'password';
      };
    }
  }

  async function saveSettings(p, defs) {
    const body = { enabled: document.getElementById('f_enabled').checked };
    for (const d of defs) body[d.key] = document.getElementById(`f_${d.key}`).value.trim();
    const res = await fetch(`/api/settings/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const saved = await res.json();
    settings[p] = saved;
    renderForm();
    setTimeout(refreshStatus, 800); // 給 connector 一點時間連線再刷新狀態
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
    const time = new Date(evt.received_at).toLocaleTimeString('zh-TW', { hour12: false });
    const amount = evt.amount ? `<span class="amount">+${evt.amount}</span>` : '';
    const msg = evt.message ? escapeHtml(evt.message) : '';
    div.innerHTML = `<span class="time">${time}</span>`
      + `<span class="tag ${evt.platform}">${L.platformLabel(evt.platform)}</span>`
      + `<span class="tag type">${eventLabel(evt)}</span>`
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

  renderDonationNotes();
  loadInitial();
  connectWs();
})();
