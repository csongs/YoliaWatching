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
const { RAW_CAPTURE, rawCapture } = require('../lib/rawCapture');

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
// 2026-08-13 一開始用 CHAT_MONITOR_DEBUG 抓包 + 比對使用者截圖(快播Plus 7天券,from 미오탱
// to 정글대마법사)反推出欄位對應,但只核對過送禮者/收禮者暱稱,[6]/[7] 當時意義不明。
// 2026-08-14 找到另一個不同語言的 SOOP 聊天協定重寫專案(github.com/getCurrentThread/soopapi,
// 非官方 Java 函式庫,獨立反推同一套協定)交叉核對:它的 ChatEvent enum 把 type code 45 命名為
// SEND_QUICK_VIEW(「Send Quick View Gift」),對應的 QuickViewEvent 欄位是
// senderId/senderNickname/receiverId/receiverNickname/itemType(int)——這個函式庫的 decoder
// 陣列索引比這裡的 parts 少 1(它拿到的 parts 已經被拆掉最前面的封包表頭,這裡的 parts 還留著),
// 換算回來後跟這裡原本用截圖核對過的「送禮者/收禮者暱稱」位置([3]/[5])完全吻合,間接證實了
// index 對應是對的,但也發現原本 [4] 標成「送禮者 userId」其實是**收禮者** userId(對照組是
// senderId/senderNickname/receiverId/receiverNickname 兩兩一組,[2]才是送禮者 userId、[4]
// 才是收禮者 userId,原本漏抓 [2]、把 [4] 誤標成送禮者)——已修正,並且原本「意義不明」的 [6]
// 現在確定是 itemType(整數,代表贈送的道具種類,例如快播Plus 幾天券,目前不知道數字對應表)。
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

      const emit = (type, res, fields) => {
        // CHAT_MONITOR_RAW_CAPTURE=1 才會寫:存 soop-extension 給的原始 res 物件(還沒被我們
        // 挑欄位、重新命名之前),不是存 fields 裡我們自己詮釋過的結果——像 SUBSCRIBE 那個
        // monthCount/amount 對不起來的 bug,只看我們自己輸出的結果看不出來,得比對原始物件。
        if (RAW_CAPTURE && type !== 'chat') rawCapture('soop', type, res);
        return onEvent({
          platform: 'soop', sourceDetail: 'community', eventType: type,
          dedupKey: dedupKeyFor(type, res),
          receivedAt: res.receivedTime || new Date().toISOString(),
          ...fields,
        });
      };

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
        // 不管認不認得這個 type 都先存下來(只要開了 RAW_CAPTURE)——GIFT_ITEM_TYPE 之外還有
        // 好幾種目前完全沒處理的未知封包(之前抓包時見過 0110/0054/0090/0094),讓它們自動被
        // 記下來,之後要查就不用重寫一次性診斷腳本。
        if (RAW_CAPTURE) rawCapture('soop', `unknown_${type}`, parts);
        if (type !== GIFT_ITEM_TYPE) return;
        const receivedTime = new Date().toISOString();
        // 欄位對應見檔頭說明(2026-08-14 拿 soopapi 這個 Java 函式庫的 QuickViewEvent 交叉核對過):
        // [2]送禮者 userId / [3]送禮者暱稱 / [4]收禮者 userId / [5]收禮者暱稱 / [6]itemType(整數,
        // 禮物種類代碼,目前不知道數字對應的道具名稱)。原本把 [4] 誤標成「送禮者 userId」,已修正成
        // 收禮者 userId,並補上原本「意義不明」的 [6](itemType)。禮物項目名稱本身(「1個月訂閱贈送券」
        // 之類的文字)還是沒解出來,只有數字代碼。
        const fromUserId = parts[2] ?? null;
        const fromUsername = parts[3] ?? null;
        const toUserId = parts[4] ?? null;
        const toUsername = parts[5] ?? null;
        const itemType = parts[6] ?? null;
        // 送禮者→收禮者是最直觀確認過的資訊,比照 Twitch subgift(見 connectors/twitch.js)同樣
        // 用「→ 收禮者」當 message,demo 頁面才看得出來是送給誰,不是只顯示送禮者一個人名字。
        emit('gift_item', { receivedTime, fromUsername }, {
          username: fromUsername, message: toUsername ? `→ ${toUsername}` : null, amount: null,
          extra: { toUsername, fromUserId, toUserId, itemType, raw: parts },
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
    // disconnect() 是 async function,理論上會 reject(例如它內部 emit(DISCONNECT) 時,我們自己
    // 掛的其中一個監聽器丟例外)——沒接 .catch() 就是未處理的 rejection,Node 預設會讓整個程序
    // 當掉(同一次修正見 connectors/twitch.js 的 stop(),那邊已經實測撞到真的當機)。
    soopChat?.disconnect().catch((e) => debugLog('soop', 'disconnect() threw', { message: e?.message }));
    soopChat = null;
  }

  return { start, stop };
}

module.exports = { createSoopConnector };
