  /* ================= 任务栏播控 → 主窗口命令 ================= */

  /* 任务栏那条上的「播放模式」按钮点了以后，从这边去点 App 自己的按钮。
     汽水没给播放模式按钮暴露类名，只能按 title / aria-label 找；找不到就只保留
     任务栏那边的本地图标状态（日志里会说明）。 */
  /* 汽水源码里这个按钮长这样：
       <div class="button" @click="protocolOf(ServiceId.queue).togglePlayOrder()">
         <ListLoopSvg /> / <SingleLoopSvg /> / <ShuffleSvg />
       它没有 title / aria-label（提示是自定义 FloatingTip），只能按图标认。
       ListLoopSvg 的路径是两段 A8.3 圆弧，特征很稳定。 */
  function appPlayModeButton() {
    /* 1) 结构定位最稳：源码里顺序是「歌词 → 播放模式 → 音量(VolumeBox) → … → 播放队列」，
          音量按钮里一定有 .volume-box-wrapper，取它的前一个按钮就是播放模式 */
    try {
      var vol = document.querySelector('.bottom-player .volume-box-wrapper');
      if (vol) {
        var volBtn = vol.closest('.button');
        var prev = volBtn && volBtn.previousElementSibling;
        if (prev && prev.classList && prev.classList.contains('button')) return prev;
      }
    } catch (e) { /* ignore */ }

    /* 2) 按图标特征：ListLoopSvg 的路径里有这两段独有片段 */
    var cands;
    try { cands = document.querySelectorAll('.bottom-player .button'); } catch (e) { cands = []; }
    for (var i = 0; i < cands.length; i++) {
      var p = cands[i].querySelector('svg path');
      var d = (p && p.getAttribute('d')) || '';
      if (/l6\.363\s*4\.636/.test(d) || /H17v2\.864/.test(d)) return cands[i];
    }

    /* 3) 兜底：右侧工具区里「歌词、播放模式、音量、队列」的第三个 */
    var right = document.querySelector('.bottom-player .controls.actions.actions-right')
      || document.querySelector('.bottom-player .actions-right');
    if (right) {
      var btns = right.querySelectorAll('.button');
      if (btns.length >= 4) return btns[3];
    }
    return null;
  }

  /* 少推荐（不喜欢）：源码在底部条 actions-left，图标是 DisLikeSvg，
     路径以 M10.482 11.405 开头，据此定位原生按钮。 */
  function appDislikeButton() {
    var cands;
    try { cands = document.querySelectorAll('.bottom-player .button'); } catch (e) { return null; }
    for (var i = 0; i < cands.length; i++) {
      var p = cands[i].querySelector('svg path');
      var d = (p && p.getAttribute('d')) || '';
      if (d.indexOf('M10.482 11.405') >= 0) return cands[i];
    }
    return null;
  }

  /* 任务栏进度条 → 原生 slider。start / move / end 三段式，
     点一下是 start+end，按住拖就是 start → move… → end。 */
  var seekActive = false;

  function appSeek(phase, ratio) {
    var track = document.querySelector('.bottom-player .progress .slider-track');
    if (!track) return false;
    var tr;
    try { tr = track.getBoundingClientRect(); } catch (e) { return false; }
    if (!tr || tr.width <= 0) return false;
    var r = Math.max(0, Math.min(1, ratio || 0));
    var x = tr.left + r * tr.width;
    var y = tr.top + tr.height / 2;
    var fire = function (type, buttons) {
      var base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: buttons, which: 1 };
      try {
        track.dispatchEvent(new PointerEvent(type, Object.assign({
          pointerId: 7, pointerType: 'mouse', isPrimary: true
        }, base)));
      } catch (e) { /* ignore */ }
      try {
        track.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse'), base));
      } catch (e) { /* ignore */ }
    };

    if (phase === 'start') {
      fire('pointerdown', 1);
      seekActive = true;
    } else if (phase === 'move') {
      if (!seekActive) { fire('pointerdown', 1); seekActive = true; }
      fire('pointermove', 1);
    } else {
      if (seekActive) fire('pointermove', 1);
      fire('pointerup', 0);
      seekActive = false;
    }
    return true;
  }

  /* ================= 小键盘 ←/→ 微调进度 =================
   *
   * 播控条上的进度条能看能点，键盘调整走这里：Numpad4 / Numpad6
   * （NumLock 关掉时它们就是 ArrowLeft / ArrowRight），每次 ±5 秒。
   *
   * 注意：汽水根本没有 <audio>/<video> 元素（日志里 audio=0 video=0），
   * 播放走 Web Audio，所以「改媒体元素 currentTime」这条路从源头就不成立。
   * 它自己的底部条 .bottom-player 上绑了键盘处理：
   *   左 → protocolOf(player).seekSeconds(progressSeconds - 5)
   *   右 → protocolOf(player).seekSeconds(progressSeconds + 5)
   * 给它派发一个合成按键即可 —— 走 App 自己的 seek 通道，界面、进度、音质全都同步，
   * 窗口最小化时也一样有效（不依赖焦点）。
   */
  var SEEK_STEP = 5;

  function seekBy(delta) {
    var bar = null;
    try { bar = document.querySelector('.bottom-player'); } catch (e) { bar = null; }
    if (!bar) return false;
    var right = delta > 0;
    var times = Math.max(1, Math.round(Math.abs(delta) / SEEK_STEP));
    for (var i = 0; i < times; i++) {
      try {
        bar.dispatchEvent(new KeyboardEvent('keydown', {
          key: right ? 'ArrowRight' : 'ArrowLeft',
          code: right ? 'ArrowRight' : 'ArrowLeft',
          keyCode: right ? 39 : 37,
          which: right ? 39 : 37,
          bubbles: true,
          cancelable: true
        }));
      } catch (e) { return false; }
    }
    return true;
  }

  /* 按一下给个轻提示，免得分不清「没生效」和「跳了但进度条太细看不出来」 */
  var seekTipEl = null;
  var seekTipTimer = 0;

  function showSeekTip(sec) {
    try {
      if (!seekTipEl) {
        seekTipEl = document.createElement('div');
        seekTipEl.id = 'soda-seek-tip';
        seekTipEl.style.cssText = 'position:fixed;left:50%;bottom:96px;'
          + 'transform:translateX(-50%);z-index:2147483000;pointer-events:none;'
          + 'padding:6px 14px;border-radius:16px;background:rgba(20,20,22,.8);color:#fff;'
          + 'font-size:13px;font-weight:500;letter-spacing:.5px;opacity:0;'
          + 'transition:opacity .16s ease;box-shadow:0 4px 16px rgba(0,0,0,.28);';
        document.body.appendChild(seekTipEl);
      }
      seekTipEl.textContent = (sec > 0 ? '快进 ' : '后退 ') + Math.abs(sec) + ' 秒';
      seekTipEl.style.opacity = '1';
      if (seekTipTimer) clearTimeout(seekTipTimer);
      seekTipTimer = setTimeout(function () {
        if (seekTipEl) seekTipEl.style.opacity = '0';
      }, 700);
    } catch (e) { /* ignore */ }
  }

  /* 主进程用（主窗口最小化 / 收进托盘时，键盘事件到不了渲染层，
     由主进程的 globalShortcut 调这个入口） */
  window.__sodaSeekBy = function (d) {
    var ok = seekBy(d);
    if (ok) showSeekTip(d);
    return ok;
  };

  /* ================= 播控歌单面板：数据源 =================
   *
   * 歌单列表直接读左侧边栏 DOM（那里是 App 自己渲染的真实歌单）；
   * 歌曲列表没法直接查 —— 渲染层的接口都走主进程服务，页面里取不到，
   * 所以这里代点一下对应侧边栏项，等 MusicTable 渲染完成后把 medias 抓下来。
   */
  function sidebarPlaylists() {
    var side = null;
    try { side = document.querySelector('.sidebar'); } catch (e) { side = null; }
    if (!side) return [];
    var all = side.querySelectorAll('.item');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var lab = el.querySelector('.label');
      var name = lab ? String(lab.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!name) continue;
      var isMine = /^(我喜欢的音乐|抖音收藏的音乐|历史播放)$/.test(name);
      var isMade = el.classList.contains('simple');
      if (!isMine && !isMade) continue;
      out.push({ el: el, n: name, g: isMine ? 'mine' : 'list' });
    }
    return out;
  }

  function trackNameOf(m) {
    var t = trackOf(m);
    if (!t) return '';
    var v = t.name || t.title || '';
    return typeof v === 'string' ? v : '';
  }

  function artistsOf(m) {
    var t = trackOf(m);
    if (!t || !t.artists || !t.artists.length) return '';
    var out = [];
    for (var i = 0; i < t.artists.length; i++) {
      var a = t.artists[i];
      if (a && a.name) out.push(String(a.name));
    }
    return out.join(' / ');
  }

  /* 主窗口在后台（最小化 / 被盖住）时，抓完数据再把页面切回去：
     用户看不到跳转，原来在看的页面也还在。前台时不偷偷切，免得莫名其妙。 */
  function restoreHashIfHidden(beforeHash, delay) {
    if (!beforeHash || String(location.hash || '') === beforeHash) return;
    setTimeout(function () {
      if (document.visibilityState !== 'hidden') return;
      if (String(location.hash || '') === beforeHash) return;
      try { location.hash = beforeHash; } catch (e) { /* ignore */ }
    }, delay || 500);
  }

  /* 点一下侧边栏项，等列表换成本歌单后把 medias 交出来 */
  function clickPlaylistAndScrape(el, done) {
    var beforeHash = String(location.hash || '');
    var beforeName = '';
    try {
      var t0 = musicTables()[0];
      if (t0 && t0.medias && t0.medias.length) beforeName = trackNameOf(t0.medias[0]);
    } catch (e) { beforeName = ''; }

    /* 已经停在这个歌单上就不用再点一次，直接抓当前表格（快很多） */
    var alreadyActive = false;
    try { alreadyActive = el.classList.contains('router-link-active'); } catch (e) { alreadyActive = false; }
    if (!alreadyActive) {
      try { el.click(); } catch (e) { /* ignore */ }
    }

    var start = Date.now();
    var timer = setInterval(function () {
      var tables = [];
      try { tables = musicTables(); } catch (e) { tables = []; }
      var t = tables[0];
      var cur = (t && t.medias && t.medias.length) ? trackNameOf(t.medias[0]) : '';
      var waited = Date.now() - start;
      var changed = !!cur && cur !== beforeName;
      var hashChanged = String(location.hash || '') !== beforeHash;
      if (t && t.medias && t.medias.length
        && (changed || (alreadyActive && waited > 250) || (hashChanged && waited > 400) || waited > 2000)) {
        clearInterval(timer);
        done(t.medias);
        if (!alreadyActive) restoreHashIfHidden(beforeHash, 500);
        return;
      }
      if (waited > 8000) { clearInterval(timer); done(null); }
    }, 120);
  }

  /* 找某一行的元素：按曲目名匹配（行是虚拟滚动，只有可见的才在 DOM 里） */
  function rowByTrackName(root, name) {
    var rows = [];
    try { rows = root.querySelectorAll('.row'); } catch (e) { return null; }
    var want = String(name || '').replace(/\s+/g, ' ').trim();
    if (!want) return null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.classList && r.classList.contains('header')) continue;
      var el = r.querySelector('.col.track [title]') || r.querySelector('.col.track .ellipsis-text');
      var t = el ? String(el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (t === want) return r;
      if (t && t.indexOf(want) === 0 && want.length >= 4) return r;   // 行里可能带「视频」之类后缀
    }
    return null;
  }

  /* 表格的滚动容器（虚拟列表要靠它把目标行滚进可视区才会渲染出来） */
  function tableScroller(el) {
    var p = el;
    while (p && p !== document.body && p !== document.documentElement) {
      var cs;
      try { cs = getComputedStyle(p); } catch (e) { break; }
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
      p = p.parentElement;
    }
    return null;
  }

  /* 行上的播放是 onDblclick（客户端源码：onDblclick: …B(playable)） */
  function dblclickRow(row) {
    var target = row.querySelector('.col.track') || row;
    var r;
    try { r = target.getBoundingClientRect(); } catch (e) { return false; }
    var init = {
      bubbles: true, cancelable: true, view: window, detail: 2, button: 0,
      clientX: r.left + Math.min(40, Math.max(4, r.width / 2)),
      clientY: r.top + Math.max(4, r.height / 2),
    };
    try { target.dispatchEvent(new MouseEvent('dblclick', init)); return true; } catch (e) { return false; }
  }

  /* 播控面板里点某首歌：把主窗口切到该歌单，滚到那一行并双击 */
  function playPlaylistTrack(plIdx, k, name) {
    var start = Date.now();
    var clickedSidebar = false;
    var scrolled = false;
    var beforeHash = String(location.hash || '');
    var restored = false;

    var attempt = function () {
      var t = null;
      try { t = musicTables()[0]; } catch (e) { t = null; }
      if (!t) return false;

      var row = rowByTrackName(t.el, name);
      if (row) {
        var ok = dblclickRow(row);
        /* 起来之后再把页面切回去（后台才切，且留 1.5 秒让播放先走起来） */
        if (ok && !restored) {
          restored = true;
          restoreHashIfHidden(beforeHash, 1500);
        }
        return ok;
      }

      if (!scrolled) {
        var sc = tableScroller(t.el);
        if (sc) {
          scrolled = true;
          sc.scrollTop = Math.max(0, k * 48 - 80);
        }
      }
      return false;
    };

    var timer = setInterval(function () {
      if (attempt()) { clearInterval(timer); return; }
      var waited = Date.now() - start;
      /* 当前页不是这个歌单（比如用户中途切走了）：先点回侧边栏那一项 */
      if (!clickedSidebar && waited > 400) {
        clickedSidebar = true;
        scrolled = false;
        var pls = sidebarPlaylists();
        if (pls[plIdx]) { try { pls[plIdx].el.click(); } catch (e) { /* ignore */ } }
      }
      if (waited > 8000) clearInterval(timer);
    }, 220);
  }

  function pushPlaylistTracks(i, medias) {
    var items = [];
    if (medias) {
      for (var k = 0; k < medias.length && k < 400; k++) {
        var m = medias[k];
        var cover = '';
        try { cover = trackCoverUrl(m, 72) || ''; } catch (e) { cover = ''; }
        items.push({ n: trackNameOf(m), a: artistsOf(m), c: cover });
      }
    }
    try {
      ls('sodaSpeedMod.widgetTracks', JSON.stringify({ i: i, items: items }));
    } catch (e) { /* ignore */ }
  }

  function handleWidgetCmd(cmd) {
    if (cmd.t === 'seek') {
      if (!appSeek(cmd.phase || 'end', cmd.r)) logDbg('进度跳转: 没找到进度条');
      return;
    }
    if (cmd.t === 'seekRel') {
      /* 任务栏播控那边按的小键盘 ←/→：按秒数相对跳转 */
      if (!seekBy(cmd.d || 0)) logDbg('进度调节: 没找到可跳转的媒体元素');
      return;
    }
    if (cmd.t === 'plPanel') {
      /* 面板刚打开：把歌单列表推过去 */
      handleWidgetCmd({ t: 'plList' });
      return;
    }
    if (cmd.t === 'plList') {
      /* 播控面板展开：把侧边栏里的真实歌单推过去 */
      var pls = [];
      try { pls = sidebarPlaylists(); } catch (e1) { pls = []; }
      var list = [];
      for (var pi = 0; pi < pls.length; pi++) list.push({ i: pi, n: pls[pi].n, g: pls[pi].g });
      try { ls('sodaSpeedMod.widgetPlaylists', JSON.stringify(list)); } catch (err2) { /* ignore */ }
      logDbg('播控歌单: 侧边栏匹配 ' + list.length + ' 个'
        + (list.length ? '（' + list.slice(0, 4).map(function (x) { return x.n; }).join('，') + '）' : ''));
      return;
    }
    if (cmd.t === 'plTracks') {
      /* 播控面板选中某个歌单：点开它再把歌曲推过去 */
      var pls2 = [];
      try { pls2 = sidebarPlaylists(); } catch (e2) { pls2 = []; }
      var target = pls2[cmd.i];
      if (!target) {
        try { ls('sodaSpeedMod.widgetTracks', JSON.stringify({ i: cmd.i, items: [] })); } catch (err3) { /* ignore */ }
        logDbg('播控歌单: 第 ' + cmd.i + ' 项不存在（侧边栏 ' + pls2.length + ' 项）');
        return;
      }
      clickPlaylistAndScrape(target.el, function (medias) { pushPlaylistTracks(cmd.i, medias); });
      return;
    }
    if (cmd.t === 'plPlay') {
      /* 播控面板里点了某首歌：切到该歌单、滚到那一行、双击播放 */
      playPlaylistTrack(cmd.i, cmd.k, cmd.n);
      return;
    }
    if (cmd.t === 'dislike') {
      var dbtn = appDislikeButton();
      if (dbtn) {
        try { dbtn.click(); } catch (err) { /* ignore */ }
        logDbg('少推荐: 已转发到原生按钮');
      } else {
        logDbg('少推荐: 没找到原生按钮（应为带 M10.482 11.405 图标那个）');
      }
      return;
    }
    if (cmd.t !== 'mode') return;

    var btn = appPlayModeButton();
    if (btn) {
      try { btn.click(); } catch (err) { /* ignore */ }
      logDbg('播放模式: 已转发到原生按钮');
    } else {
      logDbg('播放模式: 没找到原生按钮（应为 .bottom-player 里带 A8.3 圆弧图标的那个）');
    }
  }

  /* 同一条命令只处理一次：storage 事件和下面的轮询都可能送到 */
  var lastWidgetCmdTs = 0;

  function acceptWidgetCmd(raw) {
    var cmd = null;
    try { cmd = JSON.parse(raw); } catch (err) { return; }
    if (!cmd) return;
    var ts = Number(cmd.ts) || 0;
    if (ts && ts <= lastWidgetCmdTs) return;
    if (ts) lastWidgetCmdTs = ts;
    try { handleWidgetCmd(cmd); } catch (e) { logDbg('播控命令处理失败: ' + ((e && e.message) || e)); }
  }

  window.addEventListener('storage', function (e) {
    if (!e || e.key !== 'sodaSpeedMod.widgetCmd' || !e.newValue) return;
    acceptWidgetCmd(e.newValue);
  });

  /* 兜底轮询：某些情况下跨窗口 storage 事件不一定准时送达，
     这里直接读 localStorage，保证播控条的点击 0.5 秒内一定能被处理 */
  setInterval(function () {
    var raw = null;
    try { raw = localStorage.getItem('sodaSpeedMod.widgetCmd'); } catch (e) { return; }
    if (raw) acceptWidgetCmd(raw);
  }, 500);

  function injectClearBgRow() {
    injectNativeRow(
      'data-soda-clearbg-row',
      '背景模式',
      '原样 = 不动 App 背景；黑底 = 清掉色块铺近黑实底（挡住宿主背景，可用下方「面板模糊」把评论区等面板做成毛玻璃）；透明 = 整层玻璃化，可透出桌面',
      function () { return buildBgModeSeg(); });
  }

  function setSurfaceAlpha(v) {
    surfaceAlpha = clamp(numOr(v, surfaceAlpha), 0, 1);
    ls(CFG.surfaceAlphaKey, String(surfaceAlpha));
    ensureClearBgStyle();
  }

  /* 面板/评论区毛玻璃半径：0 = 关闭（面板回到实底），越大越糊 */
  function setPanelBlur(v) {
    panelBlur = clamp(numOr(v, panelBlur), 0, 60);
    ls(CFG.panelBlurKey, String(panelBlur));
    clearBgGlassAt = 0;          // 允许下一轮立刻重新标记面板
    ensureClearBgStyle();
    scanGlassPanels();
  }

  /* 表面不透明度：0 = 完全透明（能看穿），1 = 完全不透明；面板模糊：评论区等大面板毛玻璃半径 */
  function injectClearBgCard() {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box || box.querySelector('[data-soda-clearbg-card]')) return;
    ensureFxStyle();

    var el = document.createElement('div');
    el.className = 'soda-fx-card';
    el.setAttribute('data-soda-clearbg-card', '1');

    var title = document.createElement('div');
    title.className = 'soda-fx-title';
    title.textContent = '整体不透明度（0 = 全透明）';
    el.appendChild(title);

    el.appendChild(buildFxRange('不透明', 0, 1, 0.05, surfaceAlpha,
      function (v) { setSurfaceAlpha(v); },
      function (v) { return Math.round(v * 100) + '%'; }));

    el.appendChild(buildFxRange('面板模糊', 0, 60, 1, panelBlur,
      function (v) { setPanelBlur(v); },
      function (v) { return v < 1 ? '关' : Math.round(v) + 'px'; }));

    box.appendChild(el);
  }

