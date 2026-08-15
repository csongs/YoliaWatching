(function () {
  const L = window.ChatMonitorLabels;
  const PLATFORMS = ['twitch', 'youtube', 'soop'];

  const FIELD_DEFS = {
    twitch: [
      { key: 'channel', label: 'Twitch 頻道名稱', placeholder: '例如 altheayolia', type: 'text' },
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
  const $btnKeywordFilter = document.getElementById('btnKeywordFilter');
  const $keywordModalOverlay = document.getElementById('keywordModalOverlay');
  const $keywordInput = document.getElementById('keywordInput');
  const $btnKeywordApply = document.getElementById('btnKeywordApply');
  const $btnKeywordClose = document.getElementById('btnKeywordClose');
  const $searchResults = document.getElementById('searchResults');
  const $searchResultHint = document.getElementById('searchResultHint');
  const $searchFrom = document.getElementById('searchFrom');
  const $searchTo = document.getElementById('searchTo');
  const $btnSearchFromNow = document.getElementById('btnSearchFromNow');
  const $btnSearchToNow = document.getElementById('btnSearchToNow');
  const $searchEventType = document.getElementById('searchEventType');

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
      <div style="margin-top:6px;">想清空歷史紀錄：關閉伺服器後直接刪除上面這個檔案（含 .sqlite / -wal / -shm）即可，重開伺服器會自動重建空白資料庫。平台設定也存在同一個檔案裡，一併刪除後會用內建的預設頻道設定重新帶入。</div>
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
    // 2026-08-15:Twitch 新訂閱一次預先買多個月(msg-param-multimonth-duration)時,amount 存的
    // 是「這次買了幾個月」,不是累積訂閱月數——語意跟上面 SUBSCRIPTION_MONTHS_TYPES 的「已訂閱」
    // 不一樣(那個是續訂/已訂閱多久的既成事實),這裡用「預先訂閱」跟 Twitch 原文「已預先訂閱
    // 層級 1 x 3 個月」的用詞對齊,避免使用者對照原文覺得有落差。
    if (evt.event_type === 'sub') {
      return `<span class="amount">預先訂閱 ${escapeHtml(evt.amount)} 個月</span>`;
    }
    return `<span class="amount">+${escapeHtml(evt.amount)}</span>`;
  }

  // extra_json 存的是 JSON 字串,壞掉(不合法 JSON)就當沒有,退回純文字 message,不要整行渲染失敗。
  function getExtra(evt) {
    if (!evt.extra_json) return null;
    try { return JSON.parse(evt.extra_json); } catch { return null; }
  }

  // extra.messageParts 是「文字/表情圖片」交錯的陣列(YouTube/Twitch 才有,SOOP 目前只有
  // emoticonId,沒查到公開的圖片網址規則,見 README「各事件類型與驗證狀態」表的 SOOP 表情訊息那列),
  // 沒有就退回純文字 message。
  function renderMessageBody(evt) {
    const parts = getExtra(evt)?.messageParts;
    if (!parts) return evt.message ? escapeHtml(evt.message) : '';
    return parts.map((p) => p.type === 'emoji'
      ? `<img class="chat-emoji" src="${escapeHtml(p.url ?? '')}" alt="${escapeHtml(p.alt ?? '')}" title="${escapeHtml(p.alt ?? '')}" loading="lazy">`
      : escapeHtml(p.text ?? '')
    ).join('');
  }

  // Twitch(tags.color)、SOOP(randomNicknameColorDarkmode,見 connectors/soop.js 的
  // parseChat 補丁)都有使用者自訂的暱稱顏色,存在 extra.color——YouTube 目前沒有這個概念
  // (見過的欄位只有 superchat 的背景色,不是使用者本人的顏色),extra.color 就會是 undefined。
  // 值來自外部平台,渲染成 CSS 前先驗證格式是合法的 hex color,不合法就當沒有,不要整個
  // style 屬性讓不可信字串直接進去。
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
  function usernameColorStyle(evt) {
    const color = getExtra(evt)?.color;
    return typeof color === 'string' && HEX_COLOR_RE.test(color) ? ` style="color:${color}"` : '';
  }

  function renderLine(evt) {
    const cat = eventCategory(evt);
    const div = document.createElement('div');
    div.className = 'chat-line' + (cat === 'donation' ? ' donation' : cat === 'system' ? ' system' : '');
    const dt = new Date(evt.received_at);
    const time = dt.toLocaleTimeString('zh-TW', { hour12: false });
    const fullDateTime = dt.toLocaleString('zh-TW', { hour12: false }); // hover 用,含日期,跨天監聽也看得出來
    const amount = formatAmount(evt);
    const msg = renderMessageBody(evt);
    // 一般聊天訊息(event_type 'chat')每則都會重複同一個灰色「一般訊息」標籤,量大時是純雜訊,
    // 省略不顯示;抖內/會員/系統通知等特殊事件的類型標籤還是保留,因為那才是使用者想一眼看到的資訊。
    const typeTag = evt.event_type === 'chat' ? '' : `<span class="tag type">${eventLabel(evt)}</span>`;
    // 每行時間戳顏色一致,要不要顯示交給使用者用工具列的「顯示時間戳」勾選框控制
    // (CSS 用 .chat-log.hide-timestamps .time { display:none } 整批切換,不用重繪)。
    div.innerHTML = `<span class="time" title="${fullDateTime}">${time}</span>`
      + `<span class="tag ${evt.platform}">${L.platformLabel(evt.platform)}</span>`
      + typeTag
      + (evt.username ? `<span class="uname"${usernameColorStyle(evt)}>${escapeHtml(evt.username)}</span>` : '')
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
    // OBS 疊加模式網址帶 &ts=0/1 可覆寫，優先於存起來的偏好設定(OBS 模式沒有勾選框可以按)。
    const showTimestamps = window.OBS_TIMESTAMPS_OVERRIDE ?? (prefs.showTimestamps ?? true); // 沒存過就預設顯示
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

  // 歷史訊息搜尋:獨立的彈跳視窗,不影響右側主聊天視窗正在即時顯示的內容——輸入條件後
  // 直接查 SQLite 全部歷史(GET /api/search,見 server.js),不是只在瀏覽器目前已經載入的
  // 這批事件裡篩選,搜尋結果顯示在視窗自己的清單裡,跟主畫面的即時聊天記錄是分開的兩份 UI。
  // 四個條件(關鍵字/開始時間/結束時間/特殊類型)都選用,任填幾個就送幾個,伺服器端(db.js
  // searchEvents())組成 AND 條件。

  // <input type=datetime-local> 給的是「本地時間、不帶時區」的字串(例如 "2026-08-14T02:30"),
  // 用 new Date() 建構子解析這種格式時,規範上就是當本地時間處理,再用 toISOString() 轉成
  // 資料庫存的 UTC ISO 格式,不用自己手算時區位移。
  function localDateTimeToIso(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  // 「現在」按鈕反過來:把目前本地時間格式化成 datetime-local 看得懂的 "YYYY-MM-DDTHH:mm"。
  function nowForDateTimeLocal() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 類型下拉選單依平台分組(<optgroup>),每個平台底下第一個選項是「全部訊息(含一般聊天)」
  // (值是 "平台:*",跟 CHAT_MONITOR_RAW_CAPTURE_SKIP 的 platform:* 萬用字元同樣的慣例),
  // 用來支援「YT 全部 + Twitch 只要特殊類型」這種混搭——因為 chat 這個 event_type 三個平台
  // 共用(labels.js 標 platform:null),沒辦法只靠 event_type 分辨「這是哪個平台的一般聊天」,
  // 「全部訊息」選項改用「只篩平台、不篩 event_type」的方式達成同樣效果。其餘選項是各平台
  // 專屬的特殊事件(例如 Twitch 的 chat_highlight、YouTube 的 superchat),值是 "平台:類型"。
  // 複選模式下「什麼都不選」本身就代表不篩選,不用另外一個「不限類型」佔位選項。
  function buildSearchEventTypeOptions() {
    const groups = {};
    for (const [type, info] of Object.entries(L.EVENT_TYPE_LABELS)) {
      if (!info.platform) continue;
      (groups[info.platform] ??= []).push({ type, label: info.label });
    }
    let html = '';
    for (const p of PLATFORMS) {
      html += `<optgroup label="${escapeHtml(L.platformLabel(p))}">`;
      html += `<option value="${p}:*">全部訊息(含一般聊天)</option>`;
      for (const { type, label } of (groups[p] || [])) html += `<option value="${p}:${escapeHtml(type)}">${escapeHtml(label)}</option>`;
      html += '</optgroup>';
    }
    $searchEventType.innerHTML = html;
  }

  function openSearchModal() {
    $keywordModalOverlay.hidden = false;
    $keywordInput.focus();
    $keywordInput.select();
  }
  function closeSearchModal() { $keywordModalOverlay.hidden = true; }

  async function runSearch() {
    const q = $keywordInput.value.trim();
    const fromIso = localDateTimeToIso($searchFrom.value);
    const toIso = localDateTimeToIso($searchTo.value);
    // 複選:選中的每個 <option> 值都是 "平台:類型" 或 "平台:*"(全部訊息),用逗號接成一個
    // 字串送給後端(跟 CHAT_MONITOR_RAW_CAPTURE_SKIP 同樣的逗號分隔慣例),db.js 那邊組成
    // OR 條件——這樣才能「YT 全部 + Twitch 只要特殊類型」這樣混搭選,不是單純比對 event_type。
    const typeTokens = Array.from($searchEventType.selectedOptions).map((o) => o.value);
    $searchResults.innerHTML = '';
    if (!q && !fromIso && !toIso && typeTokens.length === 0) {
      $searchResultHint.textContent = '輸入至少一個條件後按搜尋，或按 Enter。';
      return;
    }
    $searchResultHint.textContent = '搜尋中…';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (fromIso) params.set('from', fromIso);
    if (toIso) params.set('to', toIso);
    if (typeTokens.length) params.set('type', typeTokens.join(','));
    let rows;
    try {
      rows = await (await fetch(`/api/search?${params}`)).json();
    } catch (e) {
      $searchResultHint.textContent = '搜尋失敗：' + e.message;
      return;
    }
    if (rows.length === 0) {
      $searchResultHint.textContent = '沒有符合條件的訊息。';
      return;
    }
    $searchResultHint.textContent = `共 ${rows.length} 筆結果（最新的在最下面）：`;
    const frag = document.createDocumentFragment();
    for (const evt of rows.reverse()) frag.appendChild(renderLine(evt));
    $searchResults.appendChild(frag);
    $searchResults.scrollTop = $searchResults.scrollHeight;
  }

  $btnKeywordFilter.onclick = openSearchModal;
  $btnKeywordApply.onclick = runSearch;
  $btnKeywordClose.onclick = closeSearchModal;
  $btnSearchFromNow.onclick = () => { $searchFrom.value = nowForDateTimeLocal(); };
  $btnSearchToNow.onclick = () => { $searchTo.value = nowForDateTimeLocal(); };
  $keywordInput.onkeydown = (e) => {
    if (e.key === 'Enter') runSearch();
    else if (e.key === 'Escape') closeSearchModal();
  };
  // 點遮罩本身(不是點裡面的視窗內容)才關閉,避免點視窗裡的空白處誤觸關閉。
  $keywordModalOverlay.onclick = (e) => { if (e.target === $keywordModalOverlay) closeSearchModal(); };
  buildSearchEventTypeOptions();
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
