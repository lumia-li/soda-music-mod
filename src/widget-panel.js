  /* ================= 歌单面板（左：歌单 / 右：歌曲） =================
   *
   * 播控窗本身只有 430x46，装不下两栏面板：点按钮时由主进程把窗口撑高
   * （下方放得下就向下展开，放不下就向上展开，播控条屏幕位置不变），
   * 页面里再用 .soda-panel-* 类决定播控条贴窗口顶部还是底部。
   *
   * 数据全部来自主窗口：
   *   歌单列表 —— 读主窗口侧边栏 DOM；
   *   歌曲列表 —— 让主窗口点一下对应侧边栏项，等 MusicTable 渲染后抓取，
   *              再通过 localStorage 推过来（跨窗口靠 storage 事件）。
   */
  var WIDGET_PL_KEY = 'sodaSpeedMod.widgetPlaylists';
  var WIDGET_TRACK_KEY = 'sodaSpeedMod.widgetTracks';
  var WIDGET_PANEL_H = 360;
  var PL_BTN_ICON = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="2" rx="1"></rect>'
    + '<rect x="3" y="11" width="12" height="2" rx="1"></rect>'
    + '<rect x="3" y="17" width="15" height="2" rx="1"></rect></svg>';

  var plPanelOpen = false;
  var plPanelMode = '';
  var plList = [];
  var plTracks = [];
  var plActive = -1;
  var plLoading = false;
  var plTimer = 0;
  var plPlayingCached = '';

  function plBtnEl() { return document.querySelector('.soda-mb-list'); }

  function widgetEnsurePanelButton() {
    var side = document.querySelector('.side-wrapper');
    if (!side) return;
    if (widgetIsHidden('list')) {
      var hideOld = side.querySelector('.soda-mb-list');
      if (hideOld && hideOld.parentNode) hideOld.parentNode.removeChild(hideOld);
      return;
    }
    var exist = side.querySelector('.soda-mb-list');
    if (exist) { widgetAttachHold(exist, 'list'); return; }
    var b = document.createElement('button');
    b.className = 'soda-mb-list';
    b.type = 'button';
    b.title = '歌单';
    b.innerHTML = PL_BTN_ICON;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      plToggle();
    });
    widgetAttachHold(b, 'list');
    side.insertBefore(b, side.firstChild);
  }

  function plEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function plPanelEl() {
    var el = document.getElementById('soda-widget-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'soda-widget-panel';
    el.innerHTML = '<div class="soda-pl-left" id="soda-pl-left"></div>'
      + '<div class="soda-pl-right" id="soda-pl-right"></div>';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  /* 左栏图标直接用汽水侧边栏那四个 SVG（CollectSvg / DouyinSvg / HistorySvg / PlaylistSvg） */
  var PL_ICON_HEART = '<svg viewBox="0 0 48 48" fill="none"><path stroke="currentColor" '
    + 'stroke-linejoin="round" stroke-width="4" d="M32 7c-4 0-6.5 2.5-8 4-1.5-1.5-4-4-8-4-5 0-8 2-10 5s-3.19 '
    + '9.296 1 16c5 8 13 13 17 15 4-2 12-7 17-15 4.559-7.295 3-13 1-16s-5-5-10-5Z"></path></svg>';
  var PL_ICON_DOUYIN = '<svg viewBox="0 0 20 20" fill="none"><path fill="currentColor" '
    + 'd="M12.581 2.32a1.125 1.125 0 0 0-2.248.059v11.043a2.637 2.637 0 1 1-2.637-2.637 1.125 1.125 0 0 0 '
    + '0-2.25 4.887 4.887 0 1 0 4.887 4.887V7.029a5.9 5.9 0 0 0 3.67 1.274 1.125 1.125 0 1 0 '
    + '0-2.25A3.67 3.67 0 0 1 12.58 2.32"></path></svg>';
  var PL_ICON_HISTORY = '<svg viewBox="0 0 20 20" fill="none"><path fill="currentColor" '
    + 'fill-rule="evenodd" clip-rule="evenodd" d="M17.5 10a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 '
    + '0m1.667 0A9.167 9.167 0 1 1 .833 10a9.167 9.167 0 0 1 18.334 0M10 6.25a.833.833 0 0 0-1.667 '
    + '0v4.583c0 .46.373.834.834.834h4.583a.833.833 0 0 0 0-1.667H10z"></path></svg>';
  var PL_ICON_LIST = '<svg viewBox="0 0 20 20" fill="none"><path fill="currentColor" '
    + 'fill-rule="evenodd" d="M2.917 2.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5m4.166.417a.833.833 0 1 0 '
    + '0 1.666h10a.833.833 0 1 0 0-1.666zM1.667 10a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 '
    + '0m1.25 5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5m3.333-5c0-.46.373-.833.833-.833h10a.833.833 '
    + '0 1 1 0 1.666h-10A.833.833 0 0 1 6.25 10m.833 5.417a.833.833 0 1 0 0 1.666h10a.833.833 0 1 0 '
    + '0-1.666z"></path></svg>';

  function plIconOf(name) {
    var n = String(name || '');
    if (n.indexOf('我喜欢的音乐') === 0) return PL_ICON_HEART;
    if (n.indexOf('抖音收藏') === 0) return PL_ICON_DOUYIN;
    if (n.indexOf('历史播放') === 0) return PL_ICON_HISTORY;
    return PL_ICON_LIST;
  }

  function plItemHtml(it) {
    return '<div class="soda-pl-item' + (it.i === plActive ? ' on' : '') + '" data-i="' + it.i + '">'
      + plIconOf(it.n) + '<span>' + plEsc(it.n) + '</span></div>';
  }

  /* 播控条上当前显示的曲名 —— 用来给面板里的「正在播放」行打标记 */
  function plPlayingTitle() {
    var el = document.querySelector('.title');
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /* 曲名比对：去空白、去括号标点、忽略大小写后比，避免「有棵里里 - 怪怪的歌」这类差异 */
  function plNormName(s) {
    return String(s == null ? '' : s)
      .replace(/\s+/g, '')
      .replace(/[()（）[\]【】·・\-—_]/g, '')
      .toLowerCase();
  }

  function plSameName(a, b) {
    var x = plNormName(a);
    var y = plNormName(b);
    if (!x || !y) return false;
    return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
  }

  /* 曲名变化时重画面板；等的那首一开始播，就把 pending 状态撤掉 */
  function plSyncPlaying() {
    if (!plPanelOpen) return;
    var cur = plPlayingTitle();
    if (cur !== plPlayingCached) {
      plPlayingCached = cur;
      /* 诊断：当前曲名与行内曲名的匹配情况（只在曲名变化时打一条） */
      var hit = 0;
      for (var i = 0; i < plTracks.length; i++) if (plSameName(plTracks[i].n, cur)) hit++;
      try {
        console.log('[倍速Mod] 播控播放态: 当前="' + cur + '" 行数=' + plTracks.length + ' 命中=' + hit);
      } catch (e) { /* ignore */ }
      plRender();
    }
  }

  function plRender() {
    if (!plPanelOpen) return;
    plPanelEl();
    var left = document.getElementById('soda-pl-left');
    var right = document.getElementById('soda-pl-right');
    if (!left || !right) return;

    var mine = [], made = [];
    for (var i = 0; i < plList.length; i++) {
      (plList[i].g === 'mine' ? mine : made).push(plList[i]);
    }
    var html = '<div class="soda-pl-sec">我的音乐</div>';
    for (var a = 0; a < mine.length; a++) html += plItemHtml(mine[a]);
    if (made.length) {
      html += '<div class="soda-pl-sec">创建的歌单</div>';
      for (var b = 0; b < made.length; b++) html += plItemHtml(made[b]);
    }
    if (!plList.length) html += '<div class="soda-pl-tip">没有读到歌单</div>';
    left.innerHTML = html;

    var items = left.querySelectorAll('.soda-pl-item');
    for (var k = 0; k < items.length; k++) {
      items[k].addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var idx = Number(this.getAttribute('data-i'));
        if (!isNaN(idx)) plChoose(idx);
      });
    }

    if (plLoading) {
      right.innerHTML = '<div class="soda-pl-tip">正在读取歌单…</div>';
      return;
    }
    if (!plTracks.length) {
      right.innerHTML = '<div class="soda-pl-tip">'
        + (plActive < 0 ? '从左侧选一个歌单' : '这个歌单里没有歌曲') + '</div>';
      return;
    }
    var curTitle = plPlayingTitle();
    var rows = '';
    for (var t = 0; t < plTracks.length; t++) {
      var s = plTracks[t];
      var isPlaying = !!curTitle && plSameName(s.n, curTitle);
      var cls = 'soda-pl-song' + (isPlaying ? ' playing' : '');
      rows += '<div class="' + cls + '" data-k="' + t + '">'
        + '<span class="soda-pl-idx">'
        + (isPlaying ? '<span class="soda-pl-wave"><i></i><i></i><i></i></span>' : (t + 1))
        + '</span>'
        + (s.c ? '<img src="' + plEsc(s.c) + '" loading="lazy" alt="">' : '<img alt="">')
        + '<div class="t"><b>' + plEsc(s.n) + '</b><small>' + plEsc(s.a || '') + '</small></div>'
        + '</div>';
    }
    right.innerHTML = rows;

    /* 点歌直接播：让主窗口在列表里双击对应那一行（和 App 自己的操作一致） */
    var songs = right.querySelectorAll('.soda-pl-song');
    for (var sk = 0; sk < songs.length; sk++) {
      songs[sk].addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var k = Number(this.getAttribute('data-k'));
        var item = plTracks[k];
        if (!item) return;
        plAsk({ t: 'plPlay', i: plActive, k: k, n: item.n, ts: Date.now() });
      });
    }
  }

  /* 命令时间戳必须严格递增：主窗口按 ts 去重，同一毫秒发两条会被当成重复丢掉 */
  var plCmdTs = 0;
  function plNextTs() {
    plCmdTs = Math.max(Date.now(), plCmdTs + 1);
    return plCmdTs;
  }

  function plAsk(cmd) {
    var out = cmd || {};
    out.ts = plNextTs();
    try { localStorage.setItem(WIDGET_CMD_KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
  }



  /* 主窗口推来的数据用轮询兜底：storage 事件偶尔不一定准时，
     直接比对字符串，变了才重画 */
  var plRawList = '';
  var plRawTracks = '';
  var plCache = {};    // 每个歌单的歌曲列表缓存，来回切不用重新等

  function plPoll() {
    if (!plPanelOpen) return;
    var a = '';
    try { a = localStorage.getItem(WIDGET_PL_KEY) || ''; } catch (e) { a = ''; }
    if (a && a !== plRawList) {
      plRawList = a;
      try { plList = JSON.parse(a) || []; } catch (err) { plList = []; }
      plRender();
    }
    var b = '';
    try { b = localStorage.getItem(WIDGET_TRACK_KEY) || ''; } catch (e) { b = ''; }
    if (b && b !== plRawTracks) {
      plRawTracks = b;
      var payload = null;
      try { payload = JSON.parse(b); } catch (err2) { payload = null; }
      if (payload) {
        var items2 = payload.items || [];
        plCache[payload.i] = items2;
        if (payload.i === plActive) {
          plTracks = items2;
          plLoading = false;
          if (plTimer) { clearTimeout(plTimer); plTimer = 0; }
          plRender();
        }
      }
    }
  }

  function plChoose(i) {
    if (i === plActive) return;
    plActive = i;
    var cached = plCache[i];
    plTracks = cached ? cached.slice() : [];
    plLoading = !cached;                    // 有缓存就先显示，后台再刷新
    plRender();
    plAsk({ t: 'plTracks', i: i });
    if (plTimer) clearTimeout(plTimer);
    plTimer = setTimeout(function () {
      plTimer = 0;
      if (!plLoading) return;
      plLoading = false;
      plRender();
    }, 12000);
  }

  var plToggleAt = 0;
  function plToggle() {
    /* 按钮可能因为 App 重建侧栏被重复挂监听，250ms 内只认一次 */
    var now = Date.now();
    if (now - plToggleAt < 250) return;
    plToggleAt = now;
    if (plPanelOpen) plClose(); else plOpen();
  }

  function plOpen() {
    var root = document.documentElement;
    plPanelOpen = true;
    plLoading = plActive >= 0 && !plTracks.length;
    /* 下方放得下就向下展开；放不下再看上方，两边都不够就向下（顶部会略微超出） */
    var top = window.screenY || 0;
    var bottom = top + (window.outerHeight || 0);
    var availBelow = ((window.screen && window.screen.availHeight) || 1080) - bottom;
    var availAbove = top - ((window.screen && window.screen.availTop) || 0);
    plPanelMode = availBelow >= WIDGET_PANEL_H + 12 ? 'down'
      : (availAbove >= WIDGET_PANEL_H + 12 ? 'up' : 'down');
    root.classList.add('soda-panel-open');
    root.classList.toggle('soda-panel-down', plPanelMode === 'down');
    root.classList.toggle('soda-panel-up', plPanelMode === 'up');
    plPanelEl();
    plRender();
    try { document.title = 'SODAPANEL:' + plPanelMode; } catch (e) { /* ignore */ }
    var btn = plBtnEl();
    if (btn) btn.classList.add('on');
    plAsk({ t: 'plPanel' });                  // 主窗口回：歌单列表 + 当前打开的那个
    if (plActive >= 0) plAsk({ t: 'plTracks', i: plActive });
    try {
      console.log('[倍速Mod] 播控面板: 打开，当前曲名="' + plPlayingTitle() + '"，歌单行数=' + plTracks.length);
    } catch (e) { /* ignore */ }

    /* 自检：开完 0.5 秒看一眼面板到底在不在、有多大、是不是被隐藏了 */
    setTimeout(function () {
      var el = document.getElementById('soda-widget-panel');
      var r = null, disp = '-';
      try { r = el ? el.getBoundingClientRect() : null; } catch (e2) { r = null; }
      try { disp = el ? getComputedStyle(el).display : 'none'; } catch (e3) { disp = '?'; }
      try {
        console.log('[倍速Mod] 面板自检: open=' + plPanelOpen
          + ' 节点=' + (el ? 1 : 0)
          + ' display=' + disp
          + ' 位置=' + (r ? (Math.round(r.left) + ',' + Math.round(r.top) + ' ' +
            Math.round(r.width) + 'x' + Math.round(r.height)) : '-')
          + ' 按钮数=' + document.querySelectorAll('.soda-mb-list').length
          + ' 视口=' + window.innerWidth + 'x' + window.innerHeight);
      } catch (e4) { /* ignore */ }
    }, 500);
  }

  function plClose() {
    if (!plPanelOpen) return;
    try {
      var st = String((new Error()).stack || '').split('\n').slice(1, 4).join(' | ');
      console.log('[倍速Mod] 播控面板: 关闭，调用栈=' + st.replace(/\s+/g, ' ').slice(0, 200));
    } catch (e) { /* ignore */ }
    plPanelOpen = false;
    plLoading = false;
    if (plTimer) { clearTimeout(plTimer); plTimer = 0; }

    var root = document.documentElement;
    var el = document.getElementById('soda-widget-panel');
    var btn = plBtnEl();
    if (btn) btn.classList.remove('on');

    var finish = function () {
      root.classList.remove('soda-panel-open');
      root.classList.remove('soda-panel-down');
      root.classList.remove('soda-panel-up');
      var node = document.getElementById('soda-widget-panel');
      if (node && node.parentNode) node.parentNode.removeChild(node);
      /* 窗口要等退出动画放完再收，否则面板会被瞬间裁掉 */
      try { document.title = 'SODAPANEL:off'; } catch (e) { /* ignore */ }
    };

    if (el) {
      el.classList.add('soda-pl-closing');
      setTimeout(finish, 150);
    } else {
      finish();
    }
  }

  /* 歌名跑马灯：完全没有溢出就静态显示；溢出时按 MusicBar 的参数滚动
     （ScrollSpeed 40px/s、两份文本之间留 30px Gap），第二份由 .title:after 复制。 */
  var MBAR_MARQUEE_SPEED = 24;   // MusicBar 原值 40，实际看下来偏快，放慢一些
  var MBAR_MARQUEE_GAP = 30;

  function widgetMarquee() {
    var title = document.querySelector('.title');
    var wrap = document.querySelector('.title-wrapper');
    if (!title || !wrap) return;

    var text = (title.textContent || '').replace(/\s+/g, ' ').trim();
    if (title.getAttribute('data-mb') !== text) {
      title.setAttribute('data-mb', text);
      title.style.animation = 'none';
    }

    var avail = wrap.clientWidth;
    if (!avail) return;

    /* 用 Range 量「第一份』文本的真实宽度：伪元素 ::after 不在选区里，
       拿到的就是纯文本宽度，比从 scrollWidth 折算靠谱。 */
    var textW = 0;
    try {
      var range = document.createRange();
      range.selectNodeContents(title);
      textW = range.getBoundingClientRect().width;
    } catch (e) {
      textW = 0;
    }
    if (!textW) textW = Math.max(0, (title.scrollWidth - MBAR_MARQUEE_GAP) / 2);

    if (textW <= avail + 2) {                        // 放得下：静态显示，不滚
      title.setAttribute('data-scroll', '0');
      if (wrap.classList.contains('soda-mb-scroll')) wrap.classList.remove('soda-mb-scroll');
      if (title.style.animationName !== 'none') title.style.animation = 'none';
      return;
    }

    title.setAttribute('data-scroll', '1');
    if (!wrap.classList.contains('soda-mb-scroll')) wrap.classList.add('soda-mb-scroll');
    var shift = textW + MBAR_MARQUEE_GAP;
    var dur = Math.max(2, shift / MBAR_MARQUEE_SPEED);
    title.style.setProperty('--mb-shift', '-' + shift.toFixed(0) + 'px');
    if (title.style.animationName !== 'soda-mb-marquee') {
      title.style.animation = 'soda-mb-marquee ' + dur.toFixed(2) + 's linear infinite';
    }
  }

  function widgetSyncIcons() {
    if (!document.documentElement.classList.contains(WIDGET_MBAR_CLASS)) return;
    widgetEnsureDislikeButton();
    widgetEnsureModeButton();
    widgetEnsurePanelButton();
    var wrap = document.querySelector('.action-wrapper');
    if (!wrap) return;
    var btns = wrap.querySelectorAll('.action-button');
    if (btns.length >= 3) {
      widgetSetIcon(btns[0], 'prev');
      widgetSetIcon(btns[btns.length - 1], 'next');
    }
    /* 播放/暂停不覆盖图标：状态来自主进程推送，暂停时 AudioContext 往往还是 running，
       判断不可靠，会出现「明明暂停了却显示暂停图标」。原生图标本身一定是对的，
       这里只把之前盖上去的层撤掉，尺寸交给 CSS 统一。 */
    var playBtn = wrap.querySelector('.action-button--playback');
    if (playBtn && playBtn.getAttribute('data-soda-mb')) {
      playBtn.removeAttribute('data-soda-mb');
      var old = playBtn.querySelector('.soda-mb-icon');
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }

    widgetMarquee();
  }

  var widgetData = null;
  var widgetUI = null;
  var widgetSeekEndHook = null;   // 当前这条进度条的拖拽收尾函数
  var widgetSeekEndBound = false; // 窗口级松手监听只挂一次
  var widgetSeekDragging = false; // 拖拽中：跨重绘也要保住手指位置

  function widgetReadData() {
    try {
      var raw = localStorage.getItem(WIDGET_DATA_KEY);
      widgetData = raw ? JSON.parse(raw) : null;
    } catch (e) { widgetData = null; }
  }

  /* 底部进度条：插一次就够，容器重建后补回 */
  function widgetBuildUI() {
    var app = document.getElementById('app');
    if (!app) return null;
    var host = app.querySelector('.container');
    if (!host) return null;
    if (!document.getElementById('soda-widget-vis')) {
      var vis = document.createElement('canvas');
      vis.id = 'soda-widget-vis';
      host.appendChild(vis);
    }
    var prog = document.getElementById('soda-widget-progress');
    if (prog && host.contains(prog)) { widgetUI = host; return host; }
    prog = document.createElement('div');
    prog.id = 'soda-widget-progress';
    prog.title = '小键盘 ← / → 微调进度（5 秒）';
    prog.innerHTML = '<i></i><b class="soda-mb-hot"></b>';
    /* 进度条：点一下跳过去，按住拖也跟手（边拖边发 move，主窗口同步给原生 slider） */
    var seekDragging = false;
    var seekAt = 0;
    var lastRatio = 0;
    var ratioOf = function (e) {
      var r = prog.getBoundingClientRect();
      if (r.width <= 0) return 0;
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    var paintBar = function (r) {
      lastRatio = r;
      var i = prog.querySelector('i');
      if (i) i.style.width = (r * 100).toFixed(2) + '%';
    };
    var sendSeek = function (phase, r) {
      try {
        localStorage.setItem(WIDGET_CMD_KEY, JSON.stringify({
          t: 'seek', phase: phase, r: r, ts: Date.now()
        }));
      } catch (err) { /* ignore */ }
    };

    prog.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      seekDragging = true;
      widgetSeekDragging = true;
      prog.setAttribute('data-dragging', '1');    // 拖拽期间别让主窗口推的进度覆盖手指位置
      var barEl = prog.querySelector('i');
      if (barEl) barEl.style.transition = 'none';
      try { prog.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var r = ratioOf(e);
      paintBar(r);
      sendSeek('start', r);
    });
    prog.addEventListener('pointermove', function (e) {
      if (!seekDragging) return;
      /* 松手事件可能被别的层吃掉，这里按「按键已松开」兜底收尾 */
      if (e.buttons === 0) { seekEnd(e); return; }
      e.preventDefault();
      var r = ratioOf(e);
      paintBar(r);
      var now = Date.now();
      if (now - seekAt < 70) return;   // 70ms 节流，别把 localStorage 写爆
      seekAt = now;
      sendSeek('move', r);
    });
    var seekEnd = function (e) {
      if (!seekDragging) return;
      seekDragging = false;
      widgetSeekDragging = false;
      prog.removeAttribute('data-dragging');
      var barEl = prog.querySelector('i');
      if (barEl) barEl.style.transition = '';
      var r = (e && typeof e.clientX === 'number' && e.clientX > 0) ? ratioOf(e) : lastRatio;
      lastRatio = r;
      paintBar(r);
      sendSeek('end', r);
    };
    prog.addEventListener('pointerup', seekEnd);
    prog.addEventListener('pointercancel', seekEnd);
    /* 指针可能被别的元素 / 别的层截走（窗口重绘时尤其容易），
       所以在窗口级再兜一层，保证松手一定能结束拖拽。
       监听只挂一次，通过 hook 指向当前这条进度条的处理函数。 */
    widgetSeekEndHook = seekEnd;
    if (!widgetSeekEndBound) {
      widgetSeekEndBound = true;
      var winSeekEnd = function (e) {
        if (widgetSeekEndHook) widgetSeekEndHook(e);
      };
      window.addEventListener('pointerup', winSeekEnd, true);
      window.addEventListener('pointercancel', winSeekEnd, true);
      window.addEventListener('mouseup', winSeekEnd, true);
      window.addEventListener('blur', function () { winSeekEnd(null); });
    }
    host.appendChild(prog);
    widgetUI = host;
    return host;
  }

  /* 小键盘 ←/→ 微调进度。播控窗口自己不发声音，只能把命令写进 localStorage，
     由主窗口读 storage 事件去改播放器（和拖动进度条走的是同一条通道）。 */
  var WIDGET_SEEK_STEP = 5;

  function widgetSeekBy(delta) {
    try {
      localStorage.setItem(WIDGET_CMD_KEY, JSON.stringify({
        t: 'seekRel', d: delta, ts: Date.now()
      }));
    } catch (e) { /* ignore */ }
  }

  /* 封面主色 → 背景渐变（主窗口取好色传过来，这里只写 CSS 变量） */
  var widgetColorKey = '';

  function widgetApplyColors(c) {
    var root = document.documentElement;
    var key = c ? JSON.stringify(c) : '';
    if (key === widgetColorKey) return;
    widgetColorKey = key;
    try {
      /* 取色偶尔会失败（切歌瞬间、页面正在重建），这时保留上一次的颜色，
         不要 remove 掉变量 —— 一 remove 就回落成默认青绿，看着像「不识别封面」。 */
      if (!c || c.length < 2) return;
      var rgb = function (a) { return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; };
      root.style.setProperty('--mb-c0', rgb(c[0]));
      root.style.setProperty('--mb-c1', rgb(c[1]));
    } catch (e) { /* ignore */ }
  }

  function widgetDraw() {
    if (!document.documentElement.classList.contains(WIDGET_MBAR_CLASS)) return;
    widgetBuildUI();
    widgetApplyColors(widgetData && widgetData.c);
    /* 正在拖进度条：别用主窗口推来的进度覆盖手指位置 */
    var progEl = document.getElementById('soda-widget-progress');
    /* 高潮点：位置是「占整首的比例」，由主窗口读 App 原生进度条的 .slider-dot 推过来 */
    var hotEl = progEl && progEl.querySelector('.soda-mb-hot');
    if (hotEl) {
      var hot = widgetData && typeof widgetData.h === 'number' ? widgetData.h : 0;
      hot = Math.max(0, Math.min(1, hot));
      if (hot > 0) {
        hotEl.style.display = 'block';
        hotEl.style.left = (hot * 100).toFixed(2) + '%';
      } else {
        hotEl.style.display = 'none';
      }
    }
    if (widgetSeekDragging) return;      // 拖拽中：别让推来的进度覆盖手指位置
    if (progEl && progEl.getAttribute('data-dragging') === '1') return;
    var bar = document.querySelector('#soda-widget-progress i');
    if (!bar) return;
    var p = widgetData && typeof widgetData.p === 'number' ? widgetData.p : 0;
    p = Math.max(0, Math.min(1, p));
    bar.style.width = (p * 100).toFixed(2) + '%';
  }

  /* 顶部频谱：26 根条形，取主窗口推来的频段值。
     平滑系数 0.45 与 MusicBar 的 `smoothed += (target - smoothed) * 0.45` 一致，
     刷新 80ms 也对齐它的 DispatcherTimer 间隔。 */
  var mbarVisSmooth = [];

  function widgetDrawVis() {
    if (!document.documentElement.classList.contains(WIDGET_MBAR_CLASS)) return;
    var cv = document.getElementById('soda-widget-vis');
    if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var vals = (widgetData && widgetData.v) || [];
    /* MusicBar 的 MainSpectrumVisual：100 根、每根 2px、两侧各 1px 边距（间距 2），
       高度 = 2 + energy * 14（2~16px）。照这个来，不要自己改比例。 */
    var n = 100;
    var bw = 2;
    var gap = 2;

    var peak = 0;
    for (var k = 0; k < n; k++) {
      if ((vals[k] || 0) > peak) peak = vals[k];
    }
    /* 安静时不再「立刻清空」，而是让柱子自然收回去 —— 硬清空再出现就是闪烁 */
    var quiet = peak < 8;

    var total = n * (bw + gap);
    var x0 = Math.max(0, (w - total) / 2);

    /* 颜色：MusicBar 是「背景色提亮」——亮度低于 0.45 补 92，否则补 52，alpha 232 */
    var c = widgetData && widgetData.c && widgetData.c[0];
    if (c) {
      var br = (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255;
      var lift = br < 0.45 ? 92 : 52;
      g.fillStyle = 'rgba('
        + Math.min(255, c[0] + lift) + ','
        + Math.min(255, c[1] + lift) + ','
        + Math.min(255, c[2] + lift) + ',0.91)';
    } else {
      g.fillStyle = 'rgba(232,232,234,.91)';
    }

    /* 平滑：不再乘自动增益（AGC 会整体放大/缩小，看上去就是整排一起「呼吸」、
       像在闪），改成按每根柱子自己的速度收放，安静时缓慢归零。 */
    var maxCur = 0;
    for (var s = 0; s < n; s++) {
      var t0 = quiet ? 0 : (vals[s] || 0) / 255;
      var c0 = mbarVisSmooth[s] || 0;
      var kk = quiet ? 0.18 : (0.50 + ((s * 7) % 4) * 0.05);   // 0.50 ~ 0.65
      c0 += (t0 - c0) * kk;
      mbarVisSmooth[s] = c0;
      if (c0 > maxCur) maxCur = c0;
    }
    if (maxCur < 0.006) return;              // 已经收干净，什么都不画

    for (var i = 0; i < n; i++) {
      var v2 = Math.min(1, mbarVisSmooth[i] || 0);
      var bh = 2 + v2 * 14;                  // 2px 底线 + 14px 动态，和 CreateBar 一致
      /* 倒过来：贴着上沿、向下垂 */
      g.fillRect(x0 + i * (bw + gap), 0, bw, bh);
    }
  }

  function widgetApplyStyle() {
    var root = document.documentElement;
    if (!root) return;
    var v = '';
    try { v = localStorage.getItem(WIDGET_STYLE_KEY) || ''; } catch (e) { v = ''; }
    var on = v === 'musicbar';
    if (on) widgetInjectStyle();
    if (root.classList.contains(WIDGET_MBAR_CLASS) !== on) {
      root.classList.toggle(WIDGET_MBAR_CLASS, on);
    }

    /* 切回官方样式：把 MusicBar 专属的节点全部摘掉。
       留着它们只会变成裸元素 —— canvas 没有 CSS 尺寸时默认 300×150，
       自定义按钮没有样式也撑成灰块（就是截图里那两个方块）。 */
    if (!on) {
      if (plPanelOpen) plClose();      // 切回官方样式时把展开的窗口收回去
      var junk = ['soda-widget-vis', 'soda-widget-progress', 'soda-mb-mode', 'soda-mb-dislike',
        'soda-mb-list', 'soda-widget-panel'];
      for (var j = 0; j < junk.length; j++) {
        var node = document.getElementById(junk[j]) || document.querySelector('.' + junk[j]);
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
      var styleEl = document.getElementById('soda-widget-mbar-style');
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    }
  }

  if (isWidgetPage) {
    enableWidgetDragRegion();
    widgetApplyStyle();
    widgetReadData();
    /* 主窗口会持续写频谱/进度快照，storage 事件在另一个窗口触发 → 即时可见 */
    window.addEventListener('storage', function (e) {
      if (!e) return;
      if (e.key === WIDGET_STYLE_KEY || e.key === WIDGET_DATA_KEY || e.key === null) {
        widgetApplyStyle();
        widgetReadData();
        widgetDraw();
      }
      /* 主窗口推来的歌单 / 歌曲列表 */
      if (e.key === WIDGET_PL_KEY && e.newValue) {
        try { plList = JSON.parse(e.newValue) || []; } catch (err) { plList = []; }
        plRender();
      }
      if (e.key === WIDGET_TRACK_KEY && e.newValue) {
        var payload = null;
        try { payload = JSON.parse(e.newValue); } catch (err2) { payload = null; }
        if (payload) {
          var items = payload.items || [];
          plCache[payload.i] = items;
          if (payload.i === plActive) {
            plTracks = items;
            plLoading = false;
            if (plTimer) { clearTimeout(plTimer); plTimer = 0; }
            plRender();
          }
        }
      }
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', widgetApplyStyle, { once: true });
    }
    /* 诊断：打印页面视口尺寸，用来确认「窗口 430 但内容仍 388」的问题 */
    var lastVp = '';
    var logViewport = function () {
      var v = window.innerWidth + 'x' + window.innerHeight;
      if (v === lastVp) return;
      lastVp = v;
      try { console.log('[倍速Mod] 播控视口: ' + v + ' | dpr=' + (window.devicePixelRatio || 1)); } catch (e) { /* ignore */ }
    };
    logViewport();
    window.addEventListener('resize', logViewport);

    /* 小键盘 ←/→ 调进度：Numpad4 / Numpad6（NumLock 关闭时它们就是方向键），每次 5 秒。
       用哪套键由设置里的「进度调节键」决定（numpad / arrows），和主窗口那份一致。
       播控窗通常不是焦点窗口，真正按键盘时多半是主窗口在收事件 —— 那边也有一份。 */
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var code = e.code || '';
      var dir = 0;
      if (code === 'Numpad4') dir = -1;
      else if (code === 'Numpad6') dir = 1;
      if (!dir) return;
      e.preventDefault();
      widgetSeekBy(dir * WIDGET_SEEK_STEP);
    });



    setInterval(function () {
      widgetApplyStyle();
      widgetReadData();
      widgetSyncIcons();
      logViewport();
    }, 1000);
    /* 隐藏状态每秒对一次（原生按钮 + 全隐藏后的双击区域） */
    setInterval(function () {
      if (!document.documentElement.classList.contains(WIDGET_MBAR_CLASS)) return;
      widgetApplyHidden();
    }, 1000);
    /* 面板开着时用更快的节奏跟随主窗口（切换歌单 / 播放状态） */
    setInterval(function () {
      if (!plPanelOpen) return;
      plPoll();
      plSyncPlaying();
    }, 250);
    (function loop() {
      widgetDraw();
      window.requestAnimationFrame(loop);
    })();
    setInterval(widgetDrawVis, 55);     // 比 MusicBar 的 80ms 更快一点，响应更跟手
    return;
  }

  if (isWidgetShadowPage) {
    return;
  }

  var CFG = {
    rateKey: 'sodaSpeedMod.rate',
    min: 0.5,
    max: 3,
    step: 0.05,
    ticks: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3],
    /* 只给这些刻度标数字；其余（0.75 / 1.25）画短刻度线仍可点击。
       0.25 步的两个文字标签在 330px 面板内会重叠 0.55px，故不标注。 */
    tickLabels: [0.5, 1, 1.5, 2, 2.5, 3],
    keepPitch: true,
    wheelKey: 'sodaSpeedMod.wheelSwitch',
    pitchKey: 'sodaSpeedMod.keepPitch',
    visKey: 'sodaSpeedMod.spectrum',
    visColorKey: 'sodaSpeedMod.spectrumColor',   // 频谱配色是否跟随背景 / 封面取色
    clearBgKey: 'sodaSpeedMod.clearBg',          // 旧开关（仅用于迁移）
    bgModeKey: 'sodaSpeedMod.bgMode',            // 背景模式：off 原样 / black 黑底 / transparent 透明
    surfaceAlphaKey: 'sodaSpeedMod.surfaceAlpha',  // 表面不透明度：0 完全透明(看穿) ~ 1 完全不透明
    panelBlurKey: 'sodaSpeedMod.panelBlur',      // 面板/评论区毛玻璃半径(px)：0 = 关闭
    widgetStyleKey: 'sodaSpeedMod.widgetStyle',  // 任务栏播控样式：native 官方 / musicbar MusicBar
    widgetDataKey: 'sodaSpeedMod.widgetData',    // 推给任务栏播控的频谱/进度快照（跨窗口用 localStorage 传）
    brandName: 'liyue',             // 侧边栏 logo 下方显示的名字
    brandFace: ' (∪.∪ )...zzz',     // 跟在名字后的颜文字（真正的取值由下方 BRAND_FACES 随机挑，见那里）
    fxKey: 'sodaSpeedMod.brandFx',           // 品牌名特效模式: off / flow / hue / breathe
    fxSpeedKey: 'sodaSpeedMod.brandFxSpeed', // 特效速度倍率 0.2 ~ 3
    fxSatKey: 'sodaSpeedMod.brandFxSat',     // 特效浓度（饱和度）0 ~ 2
    rowCoverKey: 'sodaSpeedMod.rowCover',    // 歌单曲目行左侧封面 开/关
    hideUnKey: 'sodaSpeedMod.hideUnplayable', // 隐藏不可播放曲目 开/关
    zIndex: 2147483646
  };

  /* 跟在名字后面的颜文字池：每次进站（脚本注入一次）随机挑一个，整个会话内固定不变，
     节点被 Vue 重建时也用同一个，不会来回跳。前置空格一并写进池子里 ——
     名字与颜文字之间靠它分隔，灰色样式只作用在颜文字那一段上。
     第一项是原先一直在用的那个，保留不删。 */
  var BRAND_FACES = [
    ' (∪.∪ )...zzz',    // 原先一直在用的，保留
    ' (￣y▽,￣)╭',
    ' <(＿　＿)>',
    ' (/≧▽≦)/',
    ' (╹ڡ╹ )',
    ' (⊙x⊙;)╮',
    ' （╯＿╰）',
    ' ╭(☆-ｖ-)',
    ' :P',
    ' :-D',
    ' O.O',
    ' OwO',
    ' O_O',
    ' >_<',
    ' =D',
    ' >.<'
  ];
  CFG.brandFace = BRAND_FACES[Math.floor(Math.random() * BRAND_FACES.length)];
  logDbg('品牌颜文字: ' + CFG.brandFace.trim() + '（共 ' + BRAND_FACES.length + ' 个随机池）');

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function snap(v) { return Math.round(clamp(v, CFG.min, CFG.max) / CFG.step) * CFG.step; }
  function fmt(v) { return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')) + 'x'; }
  function ls(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
      return true;
    } catch (e) { return null; }
  }

  var rate = snap(Number.parseFloat(ls(CFG.rateKey) || '') || 1);
  var suspended = false;
  var popHost = null;
  var shownRate = null;   // 上一次渲染的倍速，用于判断「变化」才弹跳
  var wheelOn = ls(CFG.wheelKey) !== '0';    // 滚轮切歌，默认开启
  CFG.keepPitch = ls(CFG.pitchKey) !== '0';  // 变速不变调，默认开启
  var spectrumOn = ls(CFG.visKey) !== '0';   // 频谱浮层，默认开启
  var spectrumColorOn = ls(CFG.visColorKey) !== '0';   // 频谱跟随背景取色，默认开启（关掉用固定蓝白）
  /* 背景模式：off = 不动 App 背景 / black = 清掉色块铺近黑底 / transparent = 整层玻璃化 */
  var BG_MODES = ['off', 'black', 'transparent'];
  function normBgMode(v) { return BG_MODES.indexOf(v) >= 0 ? v : 'transparent'; }
  var bgMode = (function () {
    var saved = ls(CFG.bgModeKey);
    if (saved) return normBgMode(saved);
    return ls(CFG.clearBgKey) === '0' ? 'off' : 'transparent';   // 兼容旧开关
  })();
  var surfaceAlpha = clamp(numOr(ls(CFG.surfaceAlphaKey), 0.35), 0, 1);   // 整体不透明度（0=全透明）
  var panelBlur = clamp(numOr(ls(CFG.panelBlurKey), 24), 0, 60);   // 面板/评论区毛玻璃半径（px，0 = 关闭）
  var rowCoverOn = ls(CFG.rowCoverKey) !== '0';   // 歌单曲目行封面，默认开启
  var hideUnplayable = ls(CFG.hideUnKey) === '1'; // 隐藏不可播放曲目，默认关闭（页面上有按钮可开）

