  /* ================= 弹出式控制条 ================= */

  var POP_CSS =
    '.bar{box-sizing:border-box;width:330px;padding:13px 18px 11px;' +
    'font:13px/1.4 "Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;' +
    'color:rgba(255,255,255,.92);' +
    'background:rgba(24,24,28,.62);' +
    '-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);' +
    'border:1px solid rgba(255,255,255,.10);border-radius:16px;' +
    'box-shadow:0 16px 44px rgba(0,0,0,.5);}' +
    '.head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;}' +
    '.title{font-size:12px;letter-spacing:.06em;color:rgba(255,255,255,.5);}' +
    '.val{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;' +
    'color:#fff;cursor:pointer;transition:color .15s;}' +
    '.val:hover{color:#7ccfff;}' +
    // 数字单独成元素，弹跳时不带动右侧「复位」小字
    '.val b{font-weight:inherit;font-size:inherit;display:inline-block;' +
    'transform-origin:50% 58%;will-change:transform;}' +
    '.val small{font-size:12px;font-weight:400;opacity:.5;margin-left:4px;}' +
    '.foot{display:flex;gap:6px;margin-top:10px;}' +
    '.chip{flex:1;text-align:center;font-size:11px;line-height:1;padding:7px 0;border-radius:9px;' +
    'cursor:pointer;color:rgba(255,255,255,.5);background:rgba(255,255,255,.06);' +
    'transition:background .15s,color .15s;-webkit-user-select:none;user-select:none;}' +
    '.chip:hover{background:rgba(255,255,255,.13);color:#fff;}' +
    '.chip.on{color:#0d0d10;background:#7ccfff;font-weight:600;}' +
    '.chip.warn{color:#ffd479;background:rgba(255,212,121,.14);font-weight:600;}' +
    'input[type=range]{-webkit-appearance:none;appearance:none;display:block;width:100%;height:20px;' +
    'margin:0;background:transparent;outline:none;cursor:pointer;}' +
    'input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;' +
    'background:linear-gradient(to right,rgba(124,207,255,.95) 0%,rgba(124,207,255,.95) var(--fill,42%),' +
    'rgba(255,255,255,.16) var(--fill,42%),rgba(255,255,255,.16) 100%);}' +
    'input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;' +
    'border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transition:transform .12s;}' +
    'input[type=range]:active::-webkit-slider-thumb{transform:scale(1.15);}' +
    // 刻度按数值绝对定位（等距排布会与线性滑块对不上）
    '.ticks{position:relative;height:15px;margin-top:6px;}' +
    '.ticks span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap;' +
    'font-size:11px;color:rgba(255,255,255,.4);cursor:pointer;padding:3px 1px;' +
    'transition:color .12s;font-variant-numeric:tabular-nums;}' +
    '.ticks span:hover{color:#7ccfff;}' +
    '.ticks span.on{color:#7ccfff;font-weight:600;}' +
    // 未标数字的刻度：只画一根短竖线，但 hit 区域仍有 12x15px
    '.ticks span.mark{width:12px;height:15px;padding:0;}' +
    '.ticks span.mark::before{content:"";position:absolute;left:5px;top:5px;width:2px;height:6px;' +
    'border-radius:1px;background:rgba(255,255,255,.26);}' +
    '.ticks span.mark:hover::before{background:#7ccfff;}' +
    '.ticks span.mark.on::before{background:#7ccfff;top:4px;height:8px;}';

  function buildPopup() {
    if (popHost) return popHost;
    popHost = document.createElement('div');
    popHost.id = 'soda-speed-pop';
    popHost.style.cssText =
      'position:fixed;left:50%;bottom:96px;z-index:' + CFG.zIndex + ';display:none;' +
      'transform:translate(-50%,10px);opacity:0;pointer-events:none;' +
      'transition:opacity .2s ease,transform .2s cubic-bezier(.22,.8,.3,1);';

    var root = popHost.attachShadow({ mode: 'open' });
    /* 滑块圆点直径 14px，其圆心只在 [7px, 宽度-7px] 之间移动；
       刻度用同一个线性映射定位，数字中心才会正好落在滑块停靠点上。 */
    var THUMB = 14;
    var tickHtml = CFG.ticks.map(function (t) {
      var p = (t - CFG.min) / (CFG.max - CFG.min);
      var pose = 'left:calc(' + (THUMB / 2) + 'px + (100% - ' + THUMB + 'px)*' + p.toFixed(4) + ')';
      var labeled = CFG.tickLabels.indexOf(t) >= 0;
      return '<span data-t="' + t + '"' + (labeled ? '' : ' class="mark" title="' + fmt(t) + '"')
        + ' style="' + pose + '">' + (labeled ? fmt(t) : '') + '</span>';
    }).join('');

    root.innerHTML = '<style>' + POP_CSS + '</style>'
      + '<div class="bar">'
      + '<div class="head">'
      + '<span class="title">播放倍速</span>'
      + '<span class="val" id="val"><b>1.0x</b><small>复位</small></span>'
      + '</div>'
      + '<input type="range" id="rng" min="' + CFG.min + '" max="' + CFG.max + '" step="' + CFG.step + '">'
      + '<div class="ticks" id="ticks">' + tickHtml + '</div>'
      + '<div class="foot">'
      + '<span class="chip" id="chip-pitch">原调</span>'
      + '<span class="chip" id="chip-vis">频谱</span>'
      + '<span class="chip" id="chip-sleep">定时</span>'
      + '</div>'
      + '</div>';

    var rngEl = root.getElementById('rng');
    var valEl = root.getElementById('val');
    var ticksEl = root.getElementById('ticks');
    var chipPitch = root.getElementById('chip-pitch');
    var chipVis = root.getElementById('chip-vis');
    var chipSleep = root.getElementById('chip-sleep');

    rngEl.addEventListener('input', function () { setRate(Number.parseFloat(rngEl.value)); });
    valEl.addEventListener('click', function () { setRate(1); });
    ticksEl.addEventListener('click', function (e) {
      var t = e.target && e.target.getAttribute && e.target.getAttribute('data-t');
      if (t !== null && t !== undefined) setRate(Number.parseFloat(t));
    });
    chipPitch.addEventListener('click', function () { setKeepPitch(!CFG.keepPitch); });
    chipVis.addEventListener('click', function () { setSpectrum(!spectrumOn); });
    chipSleep.addEventListener('click', function () { setSleep(nextSleepMinutes()); });

    (document.body || document.documentElement).appendChild(popHost);
    return popHost;
  }

  function placePopup() {
    if (!popHost) return;
    // 锚定到播放条上方（底部中央的播放按钮）
    var best = null, bestW = 0;
    var nodes;
    try { nodes = document.querySelectorAll('div,button'); } catch (e) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var r;
      try { r = el.getBoundingClientRect(); } catch (err) { continue; }
      if (r.top < window.innerHeight * 0.8) continue;
      if (r.width < 36 || r.width > 72) continue;
      if (r.height < 30 || r.height > 72) continue;
      if (Math.abs(r.left + r.width / 2 - window.innerWidth / 2) > 60) continue;
      if (r.width > bestW) { bestW = r.width; best = r; }
    }
    var bottom = best ? (window.innerHeight - best.top + 16) : 96;
    popHost.style.bottom = Math.round(clamp(bottom, 56, window.innerHeight - 120)) + 'px';
  }

  /* 数值变化时弹一下。元素每次渲染都会重建，故动画不会互相叠加；
     仍显式 cancel 旧动画，避免同一元素被复用时的累积。 */
  function bounceNum(el) {
    if (!el || typeof el.animate !== 'function') return;
    try {
      if (el.__bounce) el.__bounce.cancel();
      el.__bounce = el.animate([
        { transform: 'scale(1)', offset: 0 },
        { transform: 'scale(1.34)', offset: 0.32 },
        { transform: 'scale(.93)', offset: 0.68 },
        { transform: 'scale(1)', offset: 1 }
      ], { duration: 330, easing: 'ease-out' });
    } catch (e) { /* 动画失败不影响功能 */ }
  }

  function renderPopup() {
    if (!popHost) return;
    var root = popHost.shadowRoot;
    if (!root) return;
    var rngEl = root.getElementById('rng');
    var valEl = root.getElementById('val');
    var ticksEl = root.getElementById('ticks');
    if (!rngEl) return;

    if (Number.parseFloat(rngEl.value) !== rate) rngEl.value = String(rate);
    var fill = ((rate - CFG.min) / (CFG.max - CFG.min) * 100).toFixed(1) + '%';
    rngEl.style.setProperty('--fill', fill);

    valEl.innerHTML = '<b>' + fmt(rate) + '</b><small>' + (suspended ? '已停用' : '复位') + '</small>';
    if (shownRate !== null && shownRate !== rate) bounceNum(valEl.firstChild);
    shownRate = rate;
    popHost.style.opacity = suspended ? '0.55' : '1';

    for (var i = 0; i < ticksEl.children.length; i++) {
      var s = ticksEl.children[i];
      s.classList.toggle('on', Math.abs(Number.parseFloat(s.getAttribute('data-t')) - rate) < 1e-6 && !suspended);
    }

    var chipPitch = root.getElementById('chip-pitch');
    if (chipPitch) chipPitch.classList.toggle('on', !!CFG.keepPitch);
    var chipVis = root.getElementById('chip-vis');
    if (chipVis) chipVis.classList.toggle('on', spectrumOn);

    var chipSleep = root.getElementById('chip-sleep');
    if (chipSleep) {
      var left = sleepRemainMs();
      chipSleep.classList.toggle('on', left > 0);
      chipSleep.classList.toggle('warn', left > 0 && left <= SLEEP_FADE_MS);
      chipSleep.textContent = left > 0 ? '定时 ' + mmss(left) : '定时';
    }

  }

  var popOpen = false;
  var popHideTimer = 0;

  function showPopup() {
    buildPopup();
    placePopup();
    renderPopup();
    popOpen = true;
    if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = 0; }
    popHost.style.display = '';
    requestAnimationFrame(function () {
      /* 可能在动画帧之前就被关掉了。这里必须再确认一次：
         否则会把 pointer-events 又设回 auto —— 弹窗看不见，却一直挡着
         下面那排播放按钮，表现就是「关不掉、点什么都没反应」。 */
      if (!popOpen || !popHost) return;
      popHost.style.opacity = suspended ? '0.55' : '1';
      popHost.style.transform = 'translate(-50%,0)';
      popHost.style.pointerEvents = 'auto';
    });
  }

  function hidePopup() {
    popOpen = false;
    if (!popHost) return;
    popHost.style.opacity = '0';
    popHost.style.transform = 'translate(-50%,10px)';
    popHost.style.pointerEvents = 'none';
    if (popHideTimer) clearTimeout(popHideTimer);
    popHideTimer = setTimeout(function () {
      popHideTimer = 0;
      /* 淡出结束后整块移出布局：即便有别的代码把 pointer-events 改回 auto，
         也不会再拦住下面的点击 */
      if (!popOpen && popHost) popHost.style.display = 'none';
    }, 240);
  }

  function togglePopup() {
    if (popOpen) hidePopup();
    else showPopup();
  }

  document.addEventListener('mousedown', function (e) {
    if (!popOpen || !popHost) return;
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(popHost) >= 0) return;
    hidePopup();
  }, true);

  /* Esc 也能关：万一点击落空，至少还有键盘这条退路 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popOpen) hidePopup();
  }, true);

  /* 兜底守护：已经关闭却还在接收点击时强制复位，避免整块界面被一个看不见的弹窗挡住 */
  setInterval(function () {
    if (popOpen || !popHost) return;
    if (popHost.style.pointerEvents === 'auto') popHost.style.pointerEvents = 'none';
  }, 1000);

