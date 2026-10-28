  /* ================= 频谱浮层 ================= */

  var VIS_RING = 26;        // 环带厚度（CSS px）
  var VIS_GAP = 7;          // 环带内缘与按钮边缘的间距
  var VIS_BARS = 72;        // 柱数
  var VIS_ANCHOR_MAX = 70;  // 图标离封面右下角超过这个距离就认为不是目标

  var visHost = null;
  var visCanvas = null;
  var vis2d = null;
  var visRaf = 0;
  var visAnalyser = null;
  var visData = null;
  var visSmooth = null;     // 每根柱的平滑值（快起慢落，避免抖动）
  var visIdle = 0;
  var visGotData = false;   // 是否成功采到过非静音数据（用于排障日志，只报一次）
  var visAnchor = null;     // 锚点：点赞按钮里的那个心形 svg
  var visAnchorAt = 0;      // 上次重新找锚点的时间
  var visAnchorDist = -1;   // 当前锚点距封面右下角的距离
  var visAnchorHow = '';    // 锚点来源：图标 / 标定偏移
  var visPos = { x: -1, y: -1, s: -1 };   // 上次写进 style 的位置/尺寸，避免每帧写
  var visAlpha = 0;         // 当前不透明度（0~1），由脚本按时间插值 → 渐显 / 渐隐
  var visFadeAt = 0;        // 上次插值的时间戳，用于按真实帧间隔推进（与刷新率无关）
  var VIS_FADE_MS = 520;    // 渐显 / 渐隐时长

  /* ---------- 锚点定位：围绕点赞按钮画圈 ---------- */

  function svgPathOf(el) {
    try {
      var p = el.querySelector && el.querySelector('path');
      return (p && p.getAttribute('d')) || '';
    } catch (e) { return ''; }
  }

  function classOf(el) {
    try { return String((el && el.getAttribute && el.getAttribute('class')) || '').toLowerCase(); }
    catch (e) { return ''; }
  }

  /* 往上数层找「只有数字」的祖先：点赞按钮下面挂的就是点赞数 */
  function nearCountText(el) {
    var cur = el.parentElement;
    for (var i = 0; i < 4 && cur; i++, cur = cur.parentElement) {
      var t = (cur.textContent || '').replace(/[\s,]/g, '');
      if (/^\d{1,6}$/.test(t)) return t;
    }
    return '';
  }

  /* 详情页封面：视口内完整可见、面积最大的近似正方形图片。
     点赞爱心就贴在封面右下角，用这个几何关系定位比认图标可靠得多。
     这里只缓存「元素」本身，矩形每帧现取 —— 否则窗口缩放、点按钮引起的位置变化
     都会先画在旧坐标上，看起来就是圆圈先偏一下再自己回去。 */
  var visCoverEl = null, visCoverElAt = 0;

  function coverEl() {
    var now = Date.now();
    if (visCoverEl && visCoverEl.isConnected && now - visCoverElAt < 1500) return visCoverEl;
    visCoverElAt = now;
    var imgs;
    /* 封面可能渲染成 <img>，也可能是带背景图的 div，两类都看 */
    try {
      imgs = document.querySelectorAll('img,[class*="cover"],[class*="album"],[class*="poster"]');
    } catch (e) { visCoverEl = null; return null; }
    var best = null, bestA = 0;
    for (var i = 0; i < imgs.length; i++) {
      var r;
      try { r = imgs[i].getBoundingClientRect(); } catch (e) { continue; }
      if (r.width < 140 || r.height < 140) continue;
      var ratio = r.width / r.height;
      if (ratio < 0.85 || ratio > 1.18) continue;
      if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) continue;
      var a = r.width * r.height;
      if (a > bestA) { bestA = a; best = imgs[i]; }
    }
    visCoverEl = best;
    return visCoverEl;
  }

  function coverBox() {
    var el = coverEl();
    if (!el) return null;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return null; }
    if (r.width < 140 || r.height < 140) return null;
    if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  /* 布局变化时让封面元素也重新挑一次（圆环位置本身已经是实时的，不用管） */
  function invalidateVisLayout() {
    visCoverElAt = 0;
  }

  window.addEventListener('resize', invalidateVisLayout);
  if (window.ResizeObserver) {
    try { new ResizeObserver(invalidateVisLayout).observe(document.documentElement); } catch (e) { /* ignore */ }
  }

  var ANCHOR_SEL = 'svg,button,[class*="icon"],[class*="like"],[class*="heart"]';

  function collectAnchors() {
    var out = [];
    var list;
    try { list = document.querySelectorAll(ANCHOR_SEL); } catch (e) { return out; }
    var cover = coverBox();
    for (var i = 0; i < list.length; i++) {
      var svg = list[i], r;
      try { r = svg.getBoundingClientRect(); } catch (e) { continue; }
      if (r.width < 12 || r.width > 56) continue;
      if (Math.abs(r.width - r.height) > 8) continue;
      var ccx = r.left + r.width / 2, ccy = r.top + r.height / 2;
      if (ccx < 4 || ccy < 4 || ccx > window.innerWidth - 4 || ccy > window.innerHeight - 4) continue;
      var cls = classOf(svg) + ' ' + classOf(svg.parentElement);
      var num = nearCountText(svg);
      var d = svgPathOf(svg);

      /* 越像「封面右下角那个带计数的按钮」分越高 */
      var score = 0;
      if (num) score += 50;
      if (/like|heart|collect|favorite|praise/.test(cls)) score += 60;
      if (r.width >= 16 && r.width <= 32) score += 12;
      if (d.length > 80) score += 6;
      score += (r.top / window.innerHeight) * 8;

      var dist = -1;
      if (cover) {
        var dx = (r.left + r.width / 2) - cover.right;
        var dy = (r.top + r.height / 2) - cover.bottom;
        dist = Math.sqrt(dx * dx + dy * dy);
        score += Math.max(0, 150 - dist * 1.5);   // 贴合封面右下角 → 直接拿满
      }
      out.push({ el: svg, rect: r, num: num, cls: cls, d: d, score: score, dist: dist });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function describeAnchor(it) {
    if (!it) return '(未找到)';
    return it.el.tagName + '.' + (it.cls.split(/\s+/)[0] || '-') +
      ' 数字=' + (it.num || '-') +
      ' 尺寸=' + Math.round(it.rect.width) + 'x' + Math.round(it.rect.height) +
      ' 距封面右下=' + (it.dist < 0 ? '无封面' : Math.round(it.dist) + 'px');
  }

  /* 圆心相对封面右下角的偏移：实测标定值 —— 爱心在封面底边下方、与歌曲名同一行 */
  var VIS_ANCHOR_DX = -16;   // 相对封面右边缘：向内 16px
  var VIS_ANCHOR_DY = 45;    // 相对封面底边：向下 45px
  var VIS_ANCHOR_R = 11;     // 假想按钮半径，决定圆环内缘位置

  /* 几何定位：按标定偏移把圆心落在封面右下角下方的爱心处 */
  function geoBox() {
    var cov = coverBox();
    if (!cov || cov.right - cov.left < 180) return null;
    return {
      left: cov.right + VIS_ANCHOR_DX - VIS_ANCHOR_R,
      top: cov.bottom + VIS_ANCHOR_DY - VIS_ANCHOR_R,
      width: VIS_ANCHOR_R * 2,
      height: VIS_ANCHOR_R * 2
    };
  }

  function findLikeAnchor(force) {
    var now = Date.now();
    // 2 秒内直接复用上次结论（含「找不到锚点」的结论），否则一帧一次 DOM 遍历太贵
    if (!force && now - visAnchorAt < 2000) return visAnchor;
    var prev = visAnchor;
    visAnchorAt = now;
    var list = collectAnchors();
    if (list.length ? (list[0].dist >= 0 && list[0].dist <= VIS_ANCHOR_MAX) : false) {
      visAnchor = list[0].el;
      visAnchorDist = list[0].dist;
    } else {
      visAnchor = null;      // 离封面右下角太远（比如播放条那一排），不用它
      visAnchorDist = -1;
    }
    if (prev !== visAnchor) logDbg('频谱锚点: ' + describeAnchor(list.length ? list[0] : null));
    return visAnchor;
  }

  function ensureVis() {
    if (visHost) return;
    visHost = document.createElement('div');
    visHost.id = 'soda-speed-vis';
    visHost.style.cssText =
      'position:fixed;left:0;top:0;z-index:' + (CFG.zIndex - 3) + ';' +
      /* 不透明度改由脚本逐帧插值，不再交给 CSS 过渡（两者叠加会互相拖慢） */
      'pointer-events:none;opacity:0;will-change:transform,opacity;';
    visCanvas = document.createElement('canvas');
    visCanvas.style.cssText = 'display:block;width:100%;height:100%;';
    visHost.appendChild(visCanvas);
    (document.body || document.documentElement).appendChild(visHost);
    vis2d = visCanvas.getContext('2d');
  }

  /* 跟着锚点走：定位画布 + 同步像素尺寸 */
  function layoutVis(r) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var inner = Math.max(r.width, r.height) / 2 + VIS_GAP;
    var size = Math.ceil((inner + VIS_RING) * 2);
    var left = Math.round(r.left + r.width / 2 - size / 2);
    var top = Math.round(r.top + r.height / 2 - size / 2);

    if (visPos.s !== size) {
      visPos.s = size;
      visHost.style.width = size + 'px';
      visHost.style.height = size + 'px';
    }
    if (visPos.x !== left || visPos.y !== top) {
      visPos.x = left;
      visPos.y = top;
      visHost.style.transform = 'translate(' + left + 'px,' + top + 'px)';
    }
    var px = Math.round(size * dpr);
    if (visCanvas.width !== px) {
      visCanvas.width = px;
      visCanvas.height = px;
    }
    return { dpr: dpr, W: px, inner: inner * dpr, ring: VIS_RING * dpr };
  }

