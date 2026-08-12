// SOOP 連接器——社群模式(apiMode:'community')使用 soop-extension(跟 yuupeek/src/chatListener.js
// 同一顆套件),但這裡把它已經有實作、production 版沒接的事件全部攤開:表情/文字抖內/影片抖內/
// 廣告氣球抖內/訂閱/系統通知(soop-extension/dist/chat/event.d.ts 裡列的事件清單),外加套件完全
// 沒解析、自己反推封包格式接上去的「贈送禮物」(gift_item,見下面 GIFT_ITEM_TYPE 說明)。
// 官方模式(apiMode:'official')跟 chatListener.js 現況一致——尚未實作,直接回報原因。
//
// 2026-08-12 用 CHAT_MONITOR_DEBUG=1 實測(見下面 raw ws close 那段 log)確認:匿名(不登入)連
// SOOP 聊天室的 WebSocket 三不五時會被伺服器用 close code 1000(「正常關閉」,wasClean:true)
// 主動、乾淨地關掉——不是網路斷線。但撐多久沒有固定規律:同一顆頻道測到過連上 3 秒內就斷,
// 也測到過穩定撐了 4 分多鐘才斷,兩次都是同樣的 close code。soop-extension 本身沒有自動重連或
// 真正的保活機制(sendPing() 只送 ping,不檢查有沒有收到回應),斷線後完全要靠我們自己重連。
//
// 原本這裡對「連線中途斷線」做指數退避(以為連續快速斷線代表被伺服器懲罰性拒絕,退避才禮貌),
// 但實測發現快速斷線就只是剛好連續發生,不是會因為重連頻繁而惡化的懲罰機制——用指數退避反而在
// 那種連續快速斷線的區間裡,把大部分時間都花在「等」而不是「聽」,漏掉更多訊息(user 實測回報過)。
// 改成固定短延遲立刻重連,把「沒在監聽」的空窗壓到最小;真正的例外(網路壞掉、API 掛掉等
// attempt() 直接 throw 的情況)不受影響,仍然走下面 catch 區塊的 RETRY_INTERVAL_MS。
//
// 治本的解法是幫 SoopChat 加上登入帳密(soop-extension 的 login 選項)——有登入的連線會送完整
// metadata(見 node_modules/soop-extension/dist/chat/chat.js 的 getJoinPacket()),不會被這樣
// 短命地踢斷,但需要使用者自己的 SOOP 帳密,尚未實作。
const { DEBUG, debugLog } = require('../lib/debugLog');

const RETRY_INTERVAL_MS = 30_000; // 主播還沒開台時多久查一次(跟 youtube connector 的 RETRY_INTERVAL_MS 同數量級)
const RECONNECT_DELAY_MS = 500; // 連線中途斷線(見檔頭)時的重連延遲——刻意很短,把監聽空窗壓到最小

// soop-extension 的事件物件沒有唯一 id 欄位,dedup key 用「事件類型+收到時間+使用者+內容」組出來
// (同一次連線內幾乎不可能撞相同的四元組;reconnect 不會重送歷史,所以夠用)。
function dedupKeyFor(type, res) {
  const who = res.username ?? res.fromUsername ?? '';
  const what = res.comment ?? res.amount ?? res.notification ?? res.emoticonId ?? '';
  return `${type}:${res.receivedTime ?? ''}:${who}:${what}`;
}

// soop-extension 的 ChatType enum 裡沒有「贈送禮物」(快播Plus/訂閱禮物券等道具型贈禮,跟已經有
// 支援的星氣球/影片/廣告氣球抖內是不同的封包類型)這種事件,收到會直接落到 UNKNOWN,內容整個被丟掉。
// 2026-08-13 用 CHAT_MONITOR_DEBUG 抓包 + 比對使用者截圖(快播Plus 7天券,from 미오탱 to 정글대마법사)
// 反推出來的欄位對應——沒有官方文件,只有這一筆樣本核對過,[6]/[7] 意義不明,所以 extra 裡把完整
// 原始欄位陣列(raw)也存起來,萬一猜錯之後還查得到:
//   parts[0] 開頭(含 type code "0045") / [1] 疑似房間或直播編號 / [2] 頻道 ID /
//   [3] 送禮者暱稱 / [4] 送禮者 userId / [5] 收禮者暱稱 / [6][7] 意義不明(可能是禮物項目/數量代碼)
const GIFT_ITEM_TYPE = '0045';

function createSoopConnector({ channel, apiMode = 'community' }, onEvent, onStatus) {
  let soopChat = null;
  let stopped = true;
  let timer = null;
  let SoopClientCtor = null;
  let SoopChatEvent = null;
  let connectedAt = 0; // 只用來在 debug log 裡記錄這次連線撐了多久,不影響重連延遲

  // 「主播目前沒開台」是已知且很常見的狀態,不是異常——soop-extension 的 connect() 在這種情況下
  // 會自己 throw + console.error 一份完整 stack trace(它内部 errorHandling() 的固定行為,見
  // node_modules/soop-extension/dist/chat/chat.js:326-330,我們無法從外部關掉那個 log)。
  // 用 client.live.detail() 自己先查一次直播狀態,已知的「未開台」直接走乾淨的狀態訊息 + 排程重試,
  // 完全不呼叫 connect(),就不會觸發那段 log;真的遇到非預期錯誤才落到下面的 try/catch。
  async function isLive(client) {
    const detail = await client.live.detail(channel);
    return detail?.CHANNEL?.RESULT !== 0;
  }

  async function attempt() {
    if (stopped) return;
    try {
      const client = new SoopClientCtor();
      if (!(await isLive(client))) {
        onStatus({ connected: false, error: '目前未開台（尚未偵測到直播）' });
        timer = setTimeout(attempt, RETRY_INTERVAL_MS);
        return;
      }

      soopChat = client.chat({ streamerId: channel });

      const emit = (type, res, fields) => onEvent({
        platform: 'soop', sourceDetail: 'community', eventType: type,
        dedupKey: dedupKeyFor(type, res),
        receivedAt: res.receivedTime || new Date().toISOString(),
        ...fields,
      });

      soopChat.on(SoopChatEvent.CHAT, (res) => emit('chat', res, {
        username: res.username, message: res.comment, amount: null, extra: { userId: res.userId },
      }));
      soopChat.on(SoopChatEvent.EMOTICON, (res) => emit('emoticon', res, {
        username: res.username, message: null, amount: null, extra: { userId: res.userId, emoticonId: res.emoticonId },
      }));
      soopChat.on(SoopChatEvent.TEXT_DONATION, (res) => emit('text_donation', res, {
        username: res.fromUsername, message: null, amount: res.amount, extra: { fanClubOrdinal: res.fanClubOrdinal },
      }));
      soopChat.on(SoopChatEvent.VIDEO_DONATION, (res) => emit('video_donation', res, {
        username: res.fromUsername, message: null, amount: res.amount, extra: { fanClubOrdinal: res.fanClubOrdinal },
      }));
      soopChat.on(SoopChatEvent.AD_BALLOON_DONATION, (res) => emit('ad_balloon_donation', res, {
        username: res.fromUsername, message: null, amount: res.amount, extra: { fanClubOrdinal: res.fanClubOrdinal },
      }));
      // soop-extension 的 .d.ts 宣稱 SubscribeResponse 有 monthCount 欄位,但實際
      // parseSubscribe()(dist/chat/chat.js:169-173)回傳的物件裡月數其實叫 amount——
      // .d.ts 跟實作對不起來,讀 res.monthCount 永遠是 undefined,月數就顯示不出來
      // (user 實測回報「訂閱2個月但顯示沒有兩個月」)。改讀實際存在的 res.amount。
      soopChat.on(SoopChatEvent.SUBSCRIBE, (res) => emit('subscribe', res, {
        username: res.fromUsername, message: null, amount: res.amount, extra: { tier: res.tier },
      }));
      soopChat.on(SoopChatEvent.NOTIFICATION, (res) => emit('notification', res, {
        username: null, message: res.notification, amount: null, extra: null,
      }));
      // soop-extension 沒有解析這個類型(見檔頭 GIFT_ITEM_TYPE 說明),UNKNOWN 事件給的是
      // packet.split(SEPARATOR) 之後的完整陣列,parts[0] 開頭含 type code,自己抓出來判斷。
      soopChat.on(SoopChatEvent.UNKNOWN, (parts) => {
        const type = parts[0]?.substring(2, 6);
        if (type !== GIFT_ITEM_TYPE) return;
        const receivedTime = new Date().toISOString();
        const toUsername = parts[5] ?? null;
        // 禮物項目名稱(「1個月訂閱贈送券」之類的文字)沒解出來,[6]/[7] 意義不明(見檔頭說明);
        // 送禮者→收禮者是唯一確認過的資訊,比照 Twitch subgift(見 connectors/twitch.js)同樣
        // 用「→ 收禮者」當 message,demo 頁面才看得出來是送給誰,不是只顯示送禮者一個人名字。
        emit('gift_item', { receivedTime, fromUsername: parts[3] }, {
          username: parts[3] ?? null, message: toUsername ? `→ ${toUsername}` : null, amount: null,
          extra: { toUsername, fromUserId: parts[4] ?? null, raw: parts },
        });
      });

      soopChat.on(SoopChatEvent.CONNECT, () => {
        connectedAt = Date.now();
        debugLog('soop', 'connected');
        onStatus({ connected: true, error: null });
      });
      soopChat.on(SoopChatEvent.DISCONNECT, () => {
        // 斷線本身是預期中的事件(soop-extension 正常 emit,不是錯誤路徑)——可能是直播真的結束,
        // 也可能只是匿名連線被 SOOP 伺服器中途斷開(見檔頭註解),兩者從這個事件本身分不出來,
        // 所以一律用固定短延遲快速重連(見檔頭 RECONNECT_DELAY_MS 說明——這裡刻意不做指數退避)。
        onStatus({ connected: false, error: null });
        soopChat = null;
        if (stopped) return;
        debugLog('soop', 'disconnected', { stayedConnectedMs: Date.now() - connectedAt });
        timer = setTimeout(attempt, RECONNECT_DELAY_MS);
      });

      await soopChat.connect();

      // soop-extension 的 disconnect() 不會帶 WebSocket 原始的 close code/reason(chat.js 裡
      // ws.onclose 直接丟掉那個事件物件),要診斷「為什麼斷線」得自己在它裝好 onclose 之後外面再包一層。
      // 只在 DEBUG 模式做這個 monkey patch,平常不動 soopChat.ws,避免影響正常行為。
      if (DEBUG && soopChat?.ws) {
        const rawWs = soopChat.ws;
        const originalOnClose = rawWs.onclose;
        rawWs.onclose = (ev) => {
          debugLog('soop', 'raw ws close', { code: ev?.code, reason: ev?.reason || null, wasClean: ev?.wasClean });
          if (typeof originalOnClose === 'function') originalOnClose(ev);
        };
      }
    } catch (e) {
      // 這裡才是真的沒預期到的狀況(網路錯誤等)——soop-extension 仍會自己印一份 log,
      // 我們額外把訊息餵進 status API 讓 demo 頁看得到乾淨版本。
      debugLog('soop', 'attempt() threw', { message: e.message });
      // client.chat().connect() 內部會自己再打一次 live.detail()(跟我們前面 isLive() 那次是
      // 兩次獨立呼叫),兩次呼叫之間如果直播狀態剛好變化(例如剛好結束),第二次拿到的回應可能
      // 缺 CHANNEL.CHDOMAIN,soop-extension 內部 makeChatUrl() 對 undefined 呼叫 toLowerCase()
      // 就會炸出這種看不懂的原始 TypeError——換成人看得懂的訊息,原始錯誤還是留在 debugLog 裡。
      const error = e instanceof TypeError && /toLowerCase/.test(e.message)
        ? 'SOOP 直播狀態在確認的瞬間剛好變化(可能剛開台或剛結束),稍後會自動重試'
        : e.message;
      onStatus({ connected: false, error });
      soopChat = null;
      if (!stopped) timer = setTimeout(attempt, RETRY_INTERVAL_MS);
    }
  }

  async function start() {
    stopped = false;
    if (apiMode === 'official') {
      onStatus({ connected: false, error: '官方 API 模式尚未實作，請改用社群模式' });
      return;
    }
    if (!channel) { onStatus({ connected: false, error: '未設定 SOOP 主播 ID(streamerId)' }); return; }

    if (!SoopClientCtor) {
      const mod = await import('soop-extension');
      SoopClientCtor = mod.SoopClient;
      SoopChatEvent = mod.SoopChatEvent;
    }
    attempt();
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    // 2026-08-13 修正:soop-extension 其實有提供 disconnect()(見 dist/chat/chat.d.ts),
    // 之前這裡誤以為沒有,只把我們自己的 soopChat 參考設成 null——但事件監聽器是綁在原本那個
    // SoopChat 物件上,WebSocket 也還開著,只丟掉參考不會讓連線斷掉,訊息會繼續進來、繼續呼叫
    // onEvent(使用者回報「關閉監聽後訊息還是一直進來」就是這個 bug)。改成真的呼叫 disconnect()
    // 把底層 ws 關掉;disconnect() 內部會 emit DISCONNECT,但 stopped 已經是 true,不會誤觸發重連。
    soopChat?.disconnect();
    soopChat = null;
  }

  return { start, stop };
}

module.exports = { createSoopConnector };
