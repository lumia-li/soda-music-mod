/* ================= 恢复上次播放 =================
 *
 * 保存：每 5 秒 + 关闭前，把「曲名 + 播放进度」写进 localStorage。
 *
 * 恢复（启动约 3 秒后开始，只跑一次），三种结果：
 *   A 队列续播 —— 底栏曲名和记录一致：让播控窗点它自己的播放按钮，再把进度拖回原处
 *   B 历史兜底 —— 队列没了（换账号 / 清缓存 / App 清空队列）：打开「历史播放」双击上次那首
 *   C 降级     —— 历史里也没有这首：播最近一首，并提示原曲不可用
 * 没有记录、记录超过 7 天、未登录（侧边栏没有「历史播放」）都直接跳过，首次启动无感。
 *
 * 为什么不直接调播放接口：渲染层的接口全走主进程服务，页面里拿不到，
 * 只能驱动界面（点播放按钮 / 双击行 / 拖进度条）达到同样效果。
 */

  var RESUME_KEY = 'sodaSpeedMod.resume';
  var RESUME_ON_KEY = 'sodaSpeedMod.resumeOn';
  var WIDGET_PLAY_KEY = 'sodaSpeedMod.widgetPlayAt';   // 请求播控窗点播放的信号
  var resumeOn = ls(RESUME_ON_KEY) === '1';            // 默认关闭，用户手动开启
  var resumeTried = false;
  var resumeSavedTitle = '';

  /* 底栏当前曲名 */
  function playerTitle() {
    var el = document.querySelector('.bottom-player .title');
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /* 当前进度：读底部进度条 fill 的宽度百分比（App 用 WebAudio，没有 <audio> 可读 currentTime） */
  function playerRatio() {
    var fill = document.querySelector('.bottom-player .progress .slider-fill');
    if (!fill) return 0;
    var w = parseFloat(String(fill.style.width || '0'));
    if (!isFinite(w)) return 0;
    return Math.max(0, Math.min(1, w / 100));
  }

  /* 曲名比对：去空白、括号、连接符后比，兼容「歌手 - 歌名」这类差异 */
  function resumeNormName(s) {
    return String(s || '')
      .replace(/\s+/g, '')
      .replace(/[()（）[\]【】·・\-—_]/g, '')
      .toLowerCase();
  }

  function resumeSave() {
    if (!resumeOn) return;
    var t = playerTitle();
    if (!t) return;
    var r = playerRatio();
    try {
      ls(RESUME_KEY, JSON.stringify({ n: t, r: r, ts: Date.now() }));
    } catch (e) { /* ignore */ }
    if (t !== resumeSavedTitle) {
      resumeSavedTitle = t;
      logDbg('恢复上次播放: 已记录「' + t + '」@' + Math.round(r * 100) + '%');
    }
  }

  function showModToast(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);'
      + 'z-index:2147483000;padding:10px 16px;border-radius:10px;background:rgba(20,20,24,.92);'
      + 'color:#fff;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.45);pointer-events:none;';
    (document.body || document.documentElement).appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
  }

  function setResumeOn(on) {
    resumeOn = !!on;
    ls(RESUME_ON_KEY, resumeOn ? '1' : '0');
    logDbg('恢复上次播放: ' + (resumeOn ? '已开启' : '已关闭'));
  }

  function injectResumeRow() {
    injectNativeRow(
      'data-soda-resume-row',
      '恢复上次播放',
      '启动时接着上次关闭的歌曲和进度继续播放；原曲不可用就改播最近播放的一首',
      function () { return buildSwitchEl(resumeOn, setResumeOn); });

    /* 开关下面补一行灰色小字，说明这个功能是怎么做到的 */
    var row = null;
    try { row = document.querySelector('[data-soda-resume-row]'); } catch (e) { row = null; }
    if (!row) return;
    var left = row.querySelector('.left');
    if (!left || left.querySelector('.soda-resume-note')) return;

    var note = document.createElement('div');
    note.className = 'soda-resume-note';
    note.textContent = '记录曲名与播放进度；启动时优先续播仍保留的队列，'
      + '队列已被清空则从「历史播放」找回，随后自动切回原来的页面。';
    note.style.cssText = 'margin-top:4px;font-size:11px;line-height:1.5;'
      + 'color:rgba(255,255,255,.36);max-width:560px;';
    left.appendChild(note);
  }

  function sidebarHistoryItem() {
    var items = [];
    try { items = sidebarPlaylists(); } catch (e) { items = []; }
    for (var i = 0; i < items.length; i++) {
      if (items[i].n === '历史播放') return items[i].el;
    }
    return null;
  }

  /* 起播后把进度拖回上次的位置；加载慢可能没吃进去，最多重试 3 次 */
  function resumeSeekTo(st) {
    var tries = 0;
    var run = function () {
      if (!st || st.r <= 0.02 || tries >= 3) return;
      tries++;
      appSeek('start', st.r);
      appSeek('end', st.r);
      setTimeout(function () {
        if (tries < 3 && Math.abs(playerRatio() - st.r) > 0.06) run();
      }, 1000);
    };
    setTimeout(run, 1400);
  }

  /* 让播控窗点一下它自己的播放按钮：同一个 App 协议，比在主窗口里猜按钮可靠 */
  function askWidgetPlay() {
    try {
      localStorage.setItem(WIDGET_PLAY_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }
  }

  /* A 队列还在：直接续播。点完播放要看进度有没有真的动，没动就退到历史那条路 */
  function resumeFromQueue(st) {
    var t = playerTitle();
    if (!t) return false;
    if (resumeNormName(t) !== resumeNormName(st.n)) return false;

    logDbg('恢复上次播放: 队列还在，直接续播「' + t + '」');
    var r0 = playerRatio();
    askWidgetPlay();

    setTimeout(function () {
      if (playerRatio() > r0 + 0.002) {
        resumeSeekTo(st);
        return;
      }
      logDbg('恢复上次播放: 队列没能起来，改走历史播放');
      var item = sidebarHistoryItem();
      if (item) resumeFromHistory(st, item);
    }, 2200);
    return true;
  }

  /* 起播后把页面切回原来的地方：用户在推荐页就还回推荐页，
     表现为「在推荐页上接着播」，只在页面上闪一下。 */
  function resumeReturnPage(beforeHash) {
    if (!beforeHash) return;
    setTimeout(function () {
      if (String(location.hash || '') === beforeHash) return;
      try { location.hash = beforeHash; } catch (e) { /* ignore */ }
    }, 1600);
  }

  /* B 队列没了：打开「历史播放」，双击上次那首 */
  function resumeFromHistory(st, item) {
    if (!item) return false;
    var beforeHash = String(location.hash || '');
    try { item.click(); } catch (e) { return false; }

    var start = Date.now();
    var timer = setInterval(function () {
      var table = null;
      try { table = musicTables()[0]; } catch (e) { table = null; }
      if (!table || !table.medias || !table.medias.length) {
        if (Date.now() - start > 8000) {
          clearInterval(timer);
          logDbg('恢复上次播放: 历史列表没加载出来');
        }
        return;
      }
      clearInterval(timer);

      var row = rowByTrackName(table.el, st.n);
      var degraded = false;
      if (!row) {
        var rows = table.el.querySelectorAll('.row');
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].classList && rows[i].classList.contains('header')) continue;
          row = rows[i];
          degraded = true;
          break;
        }
      }
      if (!row) {
        logDbg('恢复上次播放: 历史里没有任何曲目');
        return;
      }

      dblclickRow(row);
      resumeReturnPage(beforeHash);
      if (degraded) {
        showModToast('上次的歌曲不可用，已播放最近播放的一首');
        logDbg('恢复上次播放: 原曲「' + st.n + '」不可用，改播最近一首');
      } else {
        resumeSeekTo(st);
        logDbg('恢复上次播放: 从历史续播「' + st.n + '」@' + Math.round((st.r || 0) * 100) + '%');
      }
    }, 250);
    return true;
  }

  function resumeBoot() {
    if (resumeTried || !resumeOn) return;
    resumeTried = true;

    var raw = '';
    try { raw = ls(RESUME_KEY) || ''; } catch (e) { raw = ''; }
    if (!raw) {
      logDbg('恢复上次播放: 没有上次的记录，跳过');
      return;
    }

    var st = null;
    try { st = JSON.parse(raw); } catch (e) { st = null; }
    if (!st || !st.n) return;
    if (Date.now() - (st.ts || 0) > 7 * 24 * 3600 * 1000) {
      logDbg('恢复上次播放: 记录超过 7 天，跳过');
      return;
    }

    logDbg('恢复上次播放: 准备恢复「' + st.n + '」@' + Math.round((st.r || 0) * 100) + '%');

    /* 等界面稳定；「是否已经在播」看进度是否在走 —— 只看曲名会误判，
       重启后底栏往往还留着上次的曲名（暂停在 0 秒）。 */
    setTimeout(function () {
      var r1 = playerRatio();
      setTimeout(function () {
        if (playerRatio() > r1 + 0.002) {
          logDbg('恢复上次播放: 已经在播放，跳过');
          return;
        }
        if (resumeFromQueue(st)) return;

        var tries = 0;
        var fallback = function () {
          tries++;
          var item = sidebarHistoryItem();
          if (item) {
            resumeFromHistory(st, item);
            return;
          }
          if (tries < 10) { setTimeout(fallback, 1200); return; }
          logDbg('恢复上次播放: 找不到「历史播放」入口，跳过');
        };
        fallback();
      }, 700);
    }, 1500);
  }

  if (!isWidgetPage) {
    setInterval(resumeSave, 5000);
    window.addEventListener('beforeunload', resumeSave);
    setTimeout(resumeBoot, 1500);
  }

  /* ---------- 播控窗这一侧：收到续播请求就点自己的播放按钮 ---------- */

  var widgetPlaySeen = 0;

  function widgetHandlePlayRequest() {
    var v = 0;
    try { v = Number(localStorage.getItem(WIDGET_PLAY_KEY) || 0) || 0; } catch (e) { v = 0; }
    if (!v || v === widgetPlaySeen) return;
    widgetPlaySeen = v;

    if (widgetData && widgetData.pl) return;      // 已经在播，别按成暂停

    var btn = null;
    try {
      var nat = widgetNativeButtons();
      btn = nat && nat.play;
    } catch (e) { btn = null; }
    if (!btn) btn = document.querySelector('.action-wrapper .action-button--playback');
    if (!btn) return;

    try {
      btn.click();
      console.log('[倍速Mod] 播控: 收到续播请求，已点播放');
    } catch (e) { /* ignore */ }
  }

  if (isWidgetPage) setInterval(widgetHandlePlayRequest, 400);
