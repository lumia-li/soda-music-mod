  /* ================= 任务栏播控样式（主窗口设置，widget 窗口应用） ================= */

  /* 只写一个 localStorage 键：widget 窗口在另一个文档里，通过 storage 事件立刻收到，
     不需要 IPC。外观的具体样式在脚本开头的 widget 分支里（WIDGET_MBAR_CSS）。 */
  function widgetStyleGet() {
    try { return ls(CFG.widgetStyleKey) === 'musicbar' ? 'musicbar' : 'native'; } catch (e) { return 'native'; }
  }

  function widgetStyleSet(v) {
    ls(CFG.widgetStyleKey, v === 'musicbar' ? 'musicbar' : 'native');
    logDbg('任务栏播控样式: ' + (v === 'musicbar' ? 'MusicBar' : '官方'));
  }

  function buildWidgetStyleSeg() {
    ensureFxStyle();
    var seg = document.createElement('div');
    seg.className = 'soda-fx-seg';
    var opts = [['native', '官方'], ['musicbar', 'MusicBar']];
    var cur = widgetStyleGet();
    for (var i = 0; i < opts.length; i++) {
      (function (code, label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (cur === code) b.classList.add('on');
        b.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          widgetStyleSet(code);
          var all = seg.querySelectorAll('button');
          for (var k = 0; k < all.length; k++) all[k].classList.remove('on');
          b.classList.add('on');
        });
        seg.appendChild(b);
      })(opts[i][0], opts[i][1]);
    }
    return seg;
  }

  function injectWidgetStyleRow() {
    injectNativeRow(
      'data-soda-widgetstyle-row',
      '任务栏播控样式',
      '官方 = 汽水原生迷你播控；MusicBar = 按 MusicBar 源码的尺寸与配色复刻（渐变底、顶部频谱、底部进度、28px 按钮），只换外观不动功能',
      function () { return buildWidgetStyleSeg(); });
  }

  /* 播控条隐藏按钮的「恢复」卡片：
     标题写明隐藏了几个，下面列出具体是哪几个，再给一个「恢复全部」按钮。 */
  var WIDGET_BTN_NAMES = {
    prev: '上一首', play: '播放/暂停', next: '下一首', collect: '收藏',
    list: '歌单', mode: '播放模式', dislike: '少推荐',
  };

  function hiddenWidgetKeys() {
    var raw = '';
    try { raw = ls('sodaSpeedMod.widgetHidden') || ''; } catch (e) { raw = ''; }
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
    } catch (e) { return []; }
  }


  function injectWidgetButtonsCard() {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box) return;

    ensureFxStyle();

    var keys = hiddenWidgetKeys();
    var items = [];
    for (var i = 0; i < keys.length; i++) {
      items.push({ key: keys[i], label: WIDGET_BTN_NAMES[keys[i]] || keys[i] });
    }
    var sig = keys.join(',');

    var el = box.querySelector('[data-soda-widgetbtns-card]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'soda-fx-card';
      el.setAttribute('data-soda-widgetbtns-card', '1');
      box.appendChild(el);
    }
    if (el.__sig === sig) return;
    el.__sig = sig;

    fillHiddenCard(el, '播控隐藏的按钮（' + keys.length + ' 个）', items, function (key) {
      /* 只从记录里去掉这一个，播控窗 1 秒内会自己把它补回来 */
      try {
        var list = hiddenWidgetKeys();
        var pos = list.indexOf(key);
        if (pos >= 0) list.splice(pos, 1);
        ls('sodaSpeedMod.widgetHidden', JSON.stringify(list));
      } catch (e) { /* ignore */ }
      el.__sig = '';
      injectWidgetButtonsCard();
      logDbg('播控按钮: 已恢复 ' + key);
    });
  }

  /* 进度调节键固定为小键盘 4 / 6。
     用 e.code 判断物理键位：NumLock 关闭时这两个键的 key 会变成 ArrowLeft/Right，
     但 code 仍然是 Numpad4/Numpad6，所以关不关 NumLock 都能用，也不会误吃方向键。 */
  function seekKeyDir(e) {
    var code = (e && e.code) || '';
    if (code === 'Numpad4') return -1;
    if (code === 'Numpad6') return 1;
    return 0;
  }

  /* 任务栏播控是独立窗口，拿不到音频流，所以由主窗口把「频谱 + 进度」快照写进 localStorage
     （同源、跨窗口；widget 那边靠 storage 事件即时收到）。只在 MusicBar 样式下推送。 */
  var widgetVisBuf = null;
  var widgetPushAt = 0;
  var playlistCtx = false;     // 是否「从歌单里放歌」（决定模式按钮 2 档还是 3 档）

  var widgetColors = null;
  var widgetPair = null;      // 未压暗的那一对，用来做抖动抑制
  var widgetColorAt = 0;
  var widgetHeavyAt = 0;

  /* 和「圆形频谱」用同一套配色：
     · 主源就是频谱正在用的 visPalette（refreshVisPalette 内部：背景渐变 → 封面 6x6 → 兜底），
       换封面 / 每隔几秒都会重算，所以两边颜色永远一致；
     · 频谱取色被关掉时，visPalette 为空，这里自己按同样顺序算一次。
     只做 0.9 秒节流，取不到就沿用上一次的颜色。 */
  var widgetColorSrc = '';

  function widgetPaletteColors() {
    var now = Date.now();

    /* 先看封面有没有换：换了就立刻重算，不等节流（这是「不同步」的主要来源） */
    var el = null;
    var img = null;
    var src = '';
    try {
      el = coverEl();
      img = el && (el.tagName === 'IMG' ? el : (el.querySelector ? el.querySelector('img') : null));
      src = (img && (img.currentSrc || img.src)) || '';
    } catch (e) { src = ''; }

    var changed = !!(src && src !== widgetColorSrc);
    if (!changed) {
      if (now - widgetColorAt < 300) return widgetColors;
      if (now - widgetHeavyAt < 1000) return widgetColors;   // 没换歌时，重取色限频 1 秒
    }
    widgetColorAt = now;
    widgetHeavyAt = now;
    if (src) widgetColorSrc = src;

    /* 优先级和圆形频谱一致：App 的主题调色板 → 封面像素 → 背景渐变 */
    var pair = null;
    try { pair = paletteFromThemeVars(28); } catch (e) { pair = null; }
    if (!pair || pair.length < 2) {
      try { pair = paletteFromCover(28); } catch (e) { pair = null; }
    }
    if (!pair || pair.length < 2) {
      try { pair = paletteFromBackground(true); } catch (e) { pair = null; }
    }
    if (!pair || pair.length < 2) {
      try { pair = paletteFromBackground(false); } catch (e) { pair = null; }
    }
    if (!pair || pair.length < 2) {
      try { pair = visPalette; } catch (e) { pair = null; }
    }
    if (!pair || pair.length < 2) return widgetColors;   // 取不到就沿用上一次，别闪

    pair = [punch(pair[0], 1.35), punch(pair[1], 1.35)];
    if (widgetPair && pairDiff(widgetPair, pair) < 60) pair = widgetPair;   // 抖动抑制：别一秒一变
    widgetPair = pair;
    var dim = function (c, k) {
      return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
    };
    widgetColors = [dim(pair[0], 0.62), dim(pair[1], 0.48)];
    return widgetColors;
  }

  function pushWidgetData() {
    if (widgetStyleGet() !== 'musicbar') return;
    var now = Date.now();
    /* 频谱刷新要跟得上，和绘制一样 55ms 推一次 */
    if (now - widgetPushAt < 55) return;
    widgetPushAt = now;

    /* 颜色：函数内部按封面地址缓存 + 0.8 秒节流，换歌后很快跟上 */
    widgetColors = widgetPaletteColors() || widgetColors;

    var p = 0;
    var fill = document.querySelector('.bottom-player .progress .slider-fill');
    var track = document.querySelector('.bottom-player .progress .slider-track');
    if (fill && track) {
      try {
        var fr = fill.getBoundingClientRect();
        var tr = track.getBoundingClientRect();
        if (tr.width > 0) p = fr.width / tr.width;
      } catch (e) { /* ignore */ }
    }
    /* 播放状态：优先看音频上下文，其次看 media 元素，任务栏播控那边靠它切换播放/暂停图标 */
    var playing = false;
    try {
      var actx = visAnalyser && visAnalyser.context;
      if (actx && actx.state === 'running') playing = true;
    } catch (e) { /* ignore */ }
    if (!playing) {
      try {
        var els = allMedia();
        for (var m = 0; m < els.length; m++) {
          if (els[m] && !els[m].paused && els[m].currentTime > 0) { playing = true; break; }
        }
      } catch (e) { /* ignore */ }
    }

    /* 当前是不是「从歌单里放歌」：决定任务栏那个模式按钮有几档
       （普通播放 2 档，歌单内多一个随机）。

       不能只看当前 hash —— 从歌单点开「左封面右歌词」的详情页后 hash 会变成播放页，
       按 hash 判断就会把三档打回两档。所以改成「记住来源」：
       进过歌单就置 true，只有明确回到首页/搜索这些非歌单页才置 false，
       详情页这种中间态沿用上一次的值。 */
    var inPlaylist = false;
    try {
      var hash = location.hash || '';
      if (/playlist|songlist|sheet|album|collect|favorite|my-like/i.test(hash)) {
        playlistCtx = true;
      } else if (/player-feed|home|discover|search|recommend|radio/i.test(hash)) {
        playlistCtx = false;
      }
      inPlaylist = playlistCtx;
    } catch (e) { inPlaylist = playlistCtx; }

    /* 播放模式的真实状态：直接看原生按钮当前的图标（三段路径各对应一档），
       这样在汽水界面里切档位、或者在任务栏那边切，两边都能保持一致 */
    var modeNow = '';
    try {
      var mb = appPlayModeButton();
      var mp = mb && mb.querySelector('svg path');
      var md = (mp && mp.getAttribute('d')) || '';
      if (md.indexOf('M42 19.492') >= 0) modeNow = 'list';
      else if (md.indexOf('M43.995 21.347') >= 0) modeNow = 'one';
      else if (md.indexOf('m37.23 4.516') >= 0) modeNow = 'shuffle';
    } catch (e) { modeNow = ''; }

    /* 频谱：和任务栏那边一样取 26 根，等宽对数分频（MusicBar 也是 FFT 分段 + 80ms 刷新） */
    var v = [];
    if (visAnalyser) {
      try {
        if (!widgetVisBuf || widgetVisBuf.length !== visAnalyser.frequencyBinCount) {
          widgetVisBuf = new Uint8Array(visAnalyser.frequencyBinCount);
        }
        visAnalyser.getByteFrequencyData(widgetVisBuf);
        /* MusicBar 是 100 根条，这里也推 100 个频段（对数分布，低频密一点） */
        for (var vi = 0; vi < 100; vi++) {
          var vidx = Math.floor(Math.pow((vi + 1) / 100, 1.7) * (widgetVisBuf.length * 0.55));
          v.push(widgetVisBuf[Math.min(widgetVisBuf.length - 1, vidx)]);
        }
      } catch (e) { v = []; }
    }

    /* 高潮点：App 原生底部进度条上的 .slider-dot 就是它，
       行内 left 是「占整首的百分比」—— 直接读过来换算成 0~1 推给播控条。 */
    var hot = 0;
    try {
      var dotEl = document.querySelector('.bottom-player .progress .slider-dot');
      if (dotEl) {
        var lf = parseFloat(dotEl.style.left);
        if (isFinite(lf)) hot = Math.max(0, Math.min(1, lf / 100));
      }
    } catch (e) { hot = 0; }

    try {
      ls(CFG.widgetDataKey, JSON.stringify({
        p: Math.round(p * 1000) / 1000,
        h: Math.round(hot * 1000) / 1000,
        c: widgetColors,
        pl: playing ? 1 : 0,
        ctx: inPlaylist ? 1 : 0,
        md: modeNow,
        v: v,
      }));
    } catch (e) { /* ignore */ }
  }

  setInterval(pushWidgetData, 250);

