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
  // 這個分頁目前是不是有還沒存檔的修改——只用來畫「尚未儲存」提示,不影響存檔內容本身。
  let dirty = { twitch: false, youtube: false, soop: false };
  // 剛存檔完的 2 秒內顯示「已儲存」,見 showSavedConfirmation()/updateSaveStatus()。
  let justSaved = { twitch: false, youtube: false, soop: false };
  let status = { twitch: {}, youtube: {}, soop: {} };
  let activeTab = 'twitch';
  let events = [];
  let filterPlatform = '';
  let filterCategory = '';

  const $tabs = document.getElementById('platformTabs');
  const $form = document.getElementById('settingsForm');
  const $appVersion = document.getElementById('appVersion');
  const $chatLog = document.getElementById('chatLog');
  const $dbInfo = document.getElementById('dbInfo');
  const $dbLocationBanner = document.getElementById('dbLocationBanner');
  const $dbLocationBannerText = document.getElementById('dbLocationBannerText');
  const $btnBrowseLocation = document.getElementById('btnBrowseLocation');
  const $btnUseDefaultLocation = document.getElementById('btnUseDefaultLocation');
  const $btnChangeLocation = document.getElementById('btnChangeLocation');
  const $donationNotes = document.getElementById('donationNotes');
  const $wsState = document.getElementById('wsState');
  const $filterPlatform = document.getElementById('filterPlatform');
  const $filterCategory = document.getElementById('filterCategory');
  const $toggleTimestamps = document.getElementById('toggleTimestamps');

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
    html += `<div class="save-status" id="saveStatus"></div>`;
    $form.innerHTML = html;

    document.getElementById('btnSave').onclick = () => saveActiveTab();
    // input/change 委派到整個表單:切分頁或 WS 狀態推播觸發重繪前,先把目前打的字同步進 edits,
    // 不會因為重繪就消失,同時標記「尚未儲存」。取消勾選「啟用監聽」是例外——不用等按按鈕,
    // 直接存檔套用(關閉監聽沒有理由要延遲)。
    function handleFormChange(e) {
      captureFormInto(p);
      setDirty(p, true);
      if (e.target.id === 'f_enabled' && !e.target.checked) saveActiveTab();
    }
    $form.oninput = handleFormChange;
    $form.onchange = handleFormChange;
    for (const btn of $form.querySelectorAll('.toggle-visibility')) {
      btn.onclick = () => {
        const input = document.getElementById(btn.dataset.target);
        input.type = input.type === 'password' ? 'text' : 'password';
      };
    }
    updateSaveStatus(p); // 從別的分頁切回來,反映這個分頁自己還記得的 dirty 狀態
  }

  function setDirty(p, isDirty) {
    dirty[p] = isDirty;
    if (isDirty) justSaved[p] = false; // 存檔後又改了,「已儲存」的提示不該繼續蓋著新的未存變更
    updateSaveStatus(p);
  }

  // updateSaveStatus 每次都重新抓 DOM、用 justSaved/dirty 這兩個模組層級狀態畫,不依賴呼叫當下
  // #saveStatus 是不是同一個節點——saveActiveTab() 存檔後 800ms 還會再跑一次 refreshStatus()→
  // renderForm(),整個表單 DOM 會被換掉一次,如果「已儲存」訊息只是設在舊節點上,800ms 後就會
  // 被無聲蓋掉,使用者兩秒都看不滿;改成狀態驅動,不管中間重繪幾次都能正確反映。
  function updateSaveStatus(p) {
    if (p !== activeTab) return;
    const el = document.getElementById('saveStatus');
    if (!el) return;
    if (justSaved[p]) {
      el.textContent = '✓ 已儲存';
      el.className = 'save-status saved';
    } else if (dirty[p]) {
      el.textContent = '● 尚未儲存的變更';
      el.className = 'save-status dirty';
    } else {
      el.textContent = '';
      el.className = 'save-status';
    }
  }

  function showSavedConfirmation(p) {
    justSaved[p] = true;
    updateSaveStatus(p);
    setTimeout(() => { justSaved[p] = false; updateSaveStatus(p); }, 2000);
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
    captureFormInto(p);
    const res = await fetch(`/api/settings/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildBody(p)) });
    const saved = await res.json();
    settings[p] = saved;
    edits[p] = {};
    dirty[p] = false;
  }

  async function saveActiveTab() {
    const p = activeTab;
    await saveOne(p);
    renderForm();
    showSavedConfirmation(p);
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

  async function refreshDbLocation() {
    const info = await (await fetch('/api/db-location')).json();
    if (!info.chosen) {
      $dbLocationBannerText.textContent = `尚未選擇 SQLite 存放位置，目前使用預設路徑：${info.folder}`;
      $dbLocationBanner.style.display = '';
    } else {
      $dbLocationBanner.style.display = 'none';
    }
  }

  // 跳出伺服器端的原生「瀏覽資料夾」對話方塊(見 server.js 的 browseForFolder());按鈕在等待
  // 期間會被 disable + 換文字提示,因為 fetch 這段時間就是使用者在跳出的視窗裡選資料夾。
  // 選到的資料夾如果已經有 events.sqlite,伺服器那邊會直接沿用(合併歷史),不會覆蓋或清空。
  async function browseAndSwitchLocation(triggerBtn) {
    const originalText = triggerBtn.textContent;
    triggerBtn.disabled = true;
    triggerBtn.textContent = '請在跳出的視窗中選擇資料夾…';
    try {
      const { folder } = await (await fetch('/api/db-location/browse', { method: 'POST' })).json();
      if (!folder) return; // 使用者按了取消
      const res = await fetch('/api/db-location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder }) });
      if (!res.ok) { const err = await res.json(); alert('切換位置失敗：' + err.error); return; }
      await refreshDbLocation();
      await refreshDbInfo();
    } catch (e) {
      alert('切換位置失敗：' + e.message);
    } finally {
      triggerBtn.disabled = false;
      triggerBtn.textContent = originalText;
    }
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

  // Twitch resub 跟 SOOP subscribe 的 amount 存的是「已訂閱幾個月」(見 connectors/twitch.js
  // 的 resub handler、connectors/soop.js 的 SUBSCRIBE handler),原本跟抖內金額一樣顯示成
  // 「+7」,看不出來是月數;這兩種明確標成「已訂閱 N 個月」。YouTube 沒有對應的事件——
  // youtube-chat-next 只給得出 isMembership 布林值,沒有月數資料,顯示不出來是資料源頭的限制,
  // 不是這裡漏接。
  const SUBSCRIPTION_MONTHS_TYPES = new Set(['subscribe', 'resub']);

  function formatAmount(evt) {
    if (!evt.amount) return '';
    if (SUBSCRIPTION_MONTHS_TYPES.has(evt.event_type)) {
      return `<span class="amount">已訂閱 ${escapeHtml(evt.amount)} 個月</span>`;
    }
    return `<span class="amount">+${escapeHtml(evt.amount)}</span>`;
  }

  function renderLine(evt) {
    const cat = eventCategory(evt);
    const div = document.createElement('div');
    div.className = 'chat-line' + (cat === 'donation' ? ' donation' : cat === 'system' ? ' system' : '');
    const dt = new Date(evt.received_at);
    const time = dt.toLocaleTimeString('zh-TW', { hour12: false });
    const fullDateTime = dt.toLocaleString('zh-TW', { hour12: false }); // hover 用,含日期,跨天監聽也看得出來
    const amount = formatAmount(evt);
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
    refreshDbLocation();
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
  $btnBrowseLocation.onclick = () => browseAndSwitchLocation($btnBrowseLocation);
  $btnChangeLocation.onclick = () => browseAndSwitchLocation($btnChangeLocation);
  $btnUseDefaultLocation.onclick = async () => {
    await fetch('/api/db-location/confirm-default', { method: 'POST' });
    await refreshDbLocation();
  };

  renderDonationNotes();
  loadInitial();
  connectWs();
})();
