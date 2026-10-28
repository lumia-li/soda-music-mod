  /* ================= 频谱配色：跟着背景 / 封面走 ================= */

  /* 柱子颜色不再写死蓝白，改成从「背景」取色，两级来源：
     1) 优先解析页面背景那层渐变（App 按封面取色生成的 linear-gradient）——
        纯读计算样式，不碰画布，没有跨域问题，也最贴近用户看到的背景；
     2) 拿不到就把封面图缩到 6x6 取两个差异最大的颜色；
     3) 两者都失败（例如封面跨域把画布污染了）就沿用原来的蓝白，功能不受影响。 */
  var visPalette = null;      // [[r,g,b],[r,g,b]]，内环 → 外环
  var visPaletteKey = '';
  var visPaletteAt = 0;
  var visPaletteSettleUntil = 0;   // 换封面后的「过渡期」截止时间，期间允许重算
  var visPaletteRetryAt = 0;       // 彻底取不到色时的重试时间（退避，别每帧重算）
  var visPaletteLog = '';
  var visCoverTaintLogged = false;

  function rgbToCss(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  /* 朝白色混合：背景取到的颜色通常偏暗，不提亮会在深色底上看不见 */
  function lighten(c, amount) {
    return [
      Math.round(c[0] + (255 - c[0]) * amount),
      Math.round(c[1] + (255 - c[1]) * amount),
      Math.round(c[2] + (255 - c[2]) * amount)
    ];
  }

  function parseCssColor(text) {
    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text || '');
    if (m) return [+m[1], +m[2], +m[3]];
    var h = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/.exec(text || '');
    if (!h) return null;
    var s = h[1];
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  /* 一组颜色里挑差异最大的一对，别把整段渐变取成同一种色 */
  function pickPair(colors) {
    var best = null, bestD = -1;
    for (var i = 0; i < colors.length; i++) {
      for (var j = i + 1; j < colors.length; j++) {
        var a = colors[i], b = colors[j];
        var d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        if (d > bestD) { bestD = d; best = [a, b]; }
      }
    }
    return bestD >= 24 ? best : null;
  }

  /* 颜色的「鲜艳度」：三通道极差。灰阶接近 0，纯色最大 */
  function colorfulness(c) {
    return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  }

  /* 只从足够鲜艳的颜色里挑一对，避免挑到「白 + 深灰」这种高对比但没颜色的组合 */
  function pickVividPair(colors, minVivid) {
    var vivid = [];
    for (var i = 0; i < colors.length; i++) {
      if (colorfulness(colors[i]) >= (minVivid || 28)) vivid.push(colors[i]);
    }
    return vivid.length >= 2 ? pickPair(vivid) : null;
  }

  /* 拉开与自身均值的差距 = 提高饱和度，色相基本不动。
     背景那层是封面重度模糊 + 降饱和的产物，不提纯出来就是一坨灰白。 */
  function punch(c, amount) {
    var m = (c[0] + c[1] + c[2]) / 3;
    return [
      Math.round(clamp(c[0] + (c[0] - m) * amount, 0, 255)),
      Math.round(clamp(c[1] + (c[1] - m) * amount, 0, 255)),
      Math.round(clamp(c[2] + (c[2] - m) * amount, 0, 255))
    ];
  }

  /* 页面背景里最鲜艳的那层大渐变（不是最大的那层：顶层常压着一层近灰遮罩） */
  function paletteFromBackground(requireVivid) {
    var stage = playerStage();
    var cands = [document.body, document.documentElement, document.querySelector('#app'), stage];
    if (stage && stage.children) {
      for (var s = 0; s < stage.children.length; s++) cands.push(stage.children[s]);   // 背景层常是舞台的直接子节点
    }
    try {
      var extra = document.querySelectorAll('[class*="bg"],[class*="backdrop"],[class*="background"],[class*="gradient"]');
      for (var k = 0; k < extra.length && k < 40; k++) cands.push(extra[k]);
    } catch (e) { /* 选择器不支持就算了 */ }

    var minArea = window.innerWidth * window.innerHeight * 0.12;
    var best = null, bestVivid = 0, bestArea = 0;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (!el) continue;
      var r, cs;
      try { r = el.getBoundingClientRect(); cs = getComputedStyle(el); } catch (e) { continue; }
      var area = r.width * r.height;
      if (area < minArea) continue;                      // 太小的不算「背景」

      var colors = [];
      var bg = cs.backgroundImage || '';
      var re = /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/g, m;
      while ((m = re.exec(bg))) {
        if (/,\s*0(\.0+)?\s*\)\s*$/.test(m[0])) continue;   // 全透明色标（遮罩层）
        var c = parseCssColor(m[0]);
        if (c) colors.push(c);
      }
      if (colors.length < 2) {                            // 纯色背景也能当一档用
        var solid = parseCssColor(cs.backgroundColor);
        if (solid) colors.push(solid);
      }
      if (colors.length < 2) continue;

      var pair = requireVivid ? pickVividPair(colors, 26) : pickPair(colors);
      if (!pair) continue;

      if (requireVivid) {
        /* 只比鲜艳度：顶层那层近灰遮罩面积最大，但几乎没有颜色，不该赢 */
        var vivid = Math.max(colorfulness(pair[0]), colorfulness(pair[1]));
        if (vivid > bestVivid) { bestVivid = vivid; best = pair; }
      } else if (area > bestArea) {
        bestArea = area; best = pair;                     // 退让模式：面积最大者
      }
    }
    return best;
  }

  /* 封面图取色：缩到 6x6 后找差异最大的一对。minVivid > 0 时只接受鲜艳像素；
     传 0 表示黑白封面也认——用封面自身的灰白，而不是掉回蓝白兜底。 */
  function paletteFromCover(minVivid) {
    var el = coverEl();
    if (!el) return null;
    var img = el.tagName === 'IMG' ? el : (el.querySelector ? el.querySelector('img') : null);
    if (!img || !img.complete || !img.naturalWidth) return null;
    try {
      var cv = document.createElement('canvas');
      cv.width = 6; cv.height = 6;
      var cg = cv.getContext('2d');
      cg.drawImage(img, 0, 0, 6, 6);
      var data = cg.getImageData(0, 0, 6, 6).data;
      var px = [];
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue;
        px.push([data[i], data[i + 1], data[i + 2]]);
      }
      return minVivid > 0 ? pickVividPair(px, minVivid) : pickPair(px);
    } catch (e) {
      // 画布被跨域污染：封面这条路整体走不通，日志里只说一次
      if (!visCoverTaintLogged) {
        visCoverTaintLogged = true;
        logDbg('频谱配色: 封面画布受跨域限制，改用背景渐变取色');
      }
      return null;
    }
  }

  /* App 自己有一套「按封面算好的调色板」：每个 playable 带着 colors.base_colors，
     渲染层把它写成 --color-base-1..9（值形如 "242, 242, 242" 或带 alpha）。
     这是最靠谱的取色来源 —— 不碰画布、没有跨域限制，而且正就是我们清掉的那层背景
     原本用的颜色。挂在哪个元素上不固定，所以从封面往上找第一个带这个变量的祖先。 */
  var themeVarHost = null;
  var themeVarAt = 0;

  function parseTriplet(text) {
    var m = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(text || '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  function hasBaseVars(el) {
    try {
      var v = getComputedStyle(el).getPropertyValue('--color-base-3');
      return !!(v && v.trim());
    } catch (e) { return false; }
  }

  function themeVarRoot() {
    var el = coverEl();
    while (el && el !== document.documentElement) {
      if (hasBaseVars(el)) return el;
      el = el.parentElement;
    }
    /* 不在播放页（没有封面）时的兜底：这几个容器都可能挂着整套主题色 */
    var cands = ['#app', '.player-box', '.main', '.page', 'body', 'html'];
    for (var i = 0; i < cands.length; i++) {
      var el2 = document.querySelector(cands[i]);
      if (el2 && hasBaseVars(el2)) return el2;
    }
    return null;
  }

  function paletteFromThemeVars(minVivid) {
    var now = Date.now();
    if (!themeVarHost || !themeVarHost.isConnected) {
      if (now - themeVarAt < 1000) return null;   // 找不到时限频，别每帧都遍历祖先
      themeVarAt = now;
      themeVarHost = themeVarRoot();
    }
    if (!themeVarHost) return null;

    var cs;
    try { cs = getComputedStyle(themeVarHost); } catch (e) { return null; }
    var list = [];
    for (var i = 1; i <= 9; i++) {
      var c = null;
      try { c = parseTriplet(cs.getPropertyValue('--color-base-' + i)); } catch (e) { c = null; }
      if (c) list.push(c);
    }
    if (list.length < 2) return null;
    /* 没拿到服务端配色时这 9 个是默认灰阶（F2F2F2…1A1A1A），
       这时 minVivid 会让它返回 null，交回封面/背景那条路 */
    return minVivid > 0 ? pickVividPair(list, minVivid) : pickPair(list);
  }

  /* 两组调色板的差距（6 个通道差之和），用来做抖动抑制 */
  function pairDiff(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return 999;
    var d = 0;
    for (var i = 0; i < 2; i++) {
      for (var k = 0; k < 3; k++) d += Math.abs(a[i][k] - b[i][k]);
    }
    return d;
  }

  /* 换歌时重取一次就够了：取到色之后同一张封面不再周期性重算 ——
     以前每 4 秒重算，主题色在切歌过渡动画里有微小变化，pickVividPair 会在两套
     相近颜色之间来回跳，看起来就是「颜色不稳定」。
     换歌后 2.5 秒内允许重算几次（等主题色过渡到位）；取色失败时保留上一次的颜色。 */
  function refreshVisPalette() {
    if (!spectrumColorOn) return null;   // 设置里关掉取色：直接用固定蓝白
    var now = Date.now();
    var el = coverEl();
    var img = el && (el.tagName === 'IMG' ? el : (el.querySelector ? el.querySelector('img') : null));
    var key = (img && (img.currentSrc || img.src)) || '';

    if (key !== visPaletteKey) {
      visPaletteKey = key;
      visPaletteAt = 0;
      visPaletteSettleUntil = now + 2500;   // 换歌过渡期：多算几次，之后定格
    }
    if (visPalette && now > visPaletteSettleUntil) return visPalette;
    if (!visPalette && now < visPaletteRetryAt) return null;   // 一直取不到：退避，别每 350ms 扫一遍背景
    if (now - visPaletteAt < 350) return visPalette;
    visPaletteAt = now;

    /* 分级取色，越靠前越理想：
       ① App 自己的 --color-base-* 调色板（服务端按封面算好的，最准且有颜色）
       ② 封面像素里的鲜艳色（跨域画布会失败）
       ③ 背景里最鲜艳的那层（背景被我们清掉时拿不到）
       ④ 封面自身的高对比组合 —— 黑白封面走这条，得到灰白而不是掉回蓝白
       ⑤ 面积最大的那层背景
       取到的颜色再提纯一次饱和度（灰阶不受影响）。 */
    var pair = null, source = '';
    if (!pair) { pair = paletteFromThemeVars(24); source = '主题色'; }
    if (!pair) { pair = paletteFromCover(28); source = '封面'; }
    if (!pair) { pair = paletteFromBackground(true); source = '背景'; }
    if (!pair) { pair = paletteFromCover(0); source = '封面(灰阶)'; }
    if (!pair) { pair = paletteFromBackground(false); source = '背景(灰阶)'; }

    if (pair) {
      pair = [punch(pair[0], 1.35), punch(pair[1], 1.35)];
      if (visPalette && pairDiff(visPalette, pair) < 60) pair = visPalette;   // 变化太小就别换
      visPalette = pair;
      visPaletteRetryAt = 0;
    } else if (!visPalette) {
      visPaletteRetryAt = now + 3000;
    }
    /* 取不到就保留上一次：切歌瞬间、页面重建都会短暂失败，
       以前这里直接清空并回落蓝白，视觉上就是「闪一下蓝」。 */
    var desc = pair
      ? (source + ' ' + rgbToCss(pair[0]) + ' → ' + rgbToCss(pair[1]))
      : (visPalette ? '本次取色失败，沿用上一次' : '取色失败，沿用蓝白');
    if (desc !== visPaletteLog) {
      visPaletteLog = desc;
      logDbg('频谱配色: ' + desc);
    }
    return visPalette;
  }

  /* 环形柱状：从内半径向外长，柱子快起慢落 */
  function drawRing(L) {
    var g = vis2d, W = L.W;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.translate(W / 2, W / 2);

    var r0 = L.inner, ring = L.ring;
    var usable = Math.floor(visData.length * 0.62);   // 高频基本是空的
    if (!visSmooth || visSmooth.length !== VIS_BARS) visSmooth = new Float32Array(VIS_BARS);

    /* 柱宽按周长与柱数换算，留出 40% 空隙，别糊成一圈 */
    var spacing = (2 * Math.PI * (r0 + ring / 2)) / VIS_BARS;
    g.lineWidth = Math.max(1, Math.min(spacing * 0.6, 2.6 * L.dpr));
    g.lineCap = 'round';
    g.lineJoin = 'round';

    /* 内外两档颜色来自背景 / 封面的取色；取不到才回退到原来的蓝白。
       背景色通常偏暗，统一往白色提一点，保证在深色底上看得清。 */
    var grad = g.createRadialGradient(0, 0, r0, 0, 0, r0 + ring);
    var pal = refreshVisPalette();
    if (pal) {
      grad.addColorStop(0, rgbToCss(lighten(pal[0], 0.2)));
      grad.addColorStop(0.6, rgbToCss(lighten(pal[1], 0.35)));
      grad.addColorStop(1, rgbToCss(lighten(pal[1], 0.55)));
    } else {
      grad.addColorStop(0, 'rgba(124,207,255,1)');
      grad.addColorStop(0.6, 'rgba(190,235,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,1)');
    }
    g.strokeStyle = grad;

    for (var i = 0; i < VIS_BARS; i++) {
      var v = visData[Math.floor(i / VIS_BARS * usable)] / 255;
      v = v * 0.55 + v * v * 0.45;
      var cur = visSmooth[i];
      visSmooth[i] = v > cur ? cur + (v - cur) * 0.5 : cur + (v - cur) * 0.12;
      var len = (2 + visSmooth[i] * ring) * L.dpr;
      var a = -Math.PI / 2 + (i / VIS_BARS) * Math.PI * 2;
      var ca = Math.cos(a), sa = Math.sin(a);

      g.globalAlpha = 0.32 + 0.68 * Math.min(1, visSmooth[i] * 1.7);
      g.beginPath();
      g.moveTo(ca * (r0 + 1.5 * L.dpr), sa * (r0 + 1.5 * L.dpr));
      g.lineTo(ca * (r0 + len), sa * (r0 + len));
      g.stroke();
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------- 只在「正在播放」详情页显示 ---------- */

  /* 详情页判定直接复用 playerBoxRoot()（定义见「滚轮切歌」一节）：
     它是 PlayerBoxAudioFrame 的根 div.container[data-v-b8d357b5] / 歌词容器，
     详情页没打开时节点不存在或不可见。
     注意不能用 .fullscreen-player —— 那是外层布局的常驻容器，任何页面都在。
     歌单 / 榜单 / 推荐流等页面同样有大尺寸正方形封面，会被 coverEl() 当成播放页封面，
     所以必须先过这道页面闸门。 */
  var visPageOn = null;   // null = 尚未判定过，保证第一次一定写一行日志

  function onPlayerPage() {
    var root = playerBoxRoot();
    if (!root) return false;
    try {
      var r = root.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }

  /* 每帧朝目标不透明度逼近：回到播放页自然渐显，离开 / 静音时渐隐。
     按真实时间差推进而不是固定每帧步长，120Hz 屏幕上速度也一样。 */
  function visFadeTo(target) {
    var now = Date.now();
    var dt = visFadeAt ? Math.min(64, now - visFadeAt) : 16;
    visFadeAt = now;
    var step = dt / VIS_FADE_MS;
    if (visAlpha < target) visAlpha = Math.min(target, visAlpha + step);
    else if (visAlpha > target) visAlpha = Math.max(target, visAlpha - step);

    var s = visAlpha >= 0.999 ? '1' : (visAlpha < 0.002 ? '0' : visAlpha.toFixed(3));
    if (visHost.style.opacity !== s) visHost.style.opacity = s;
  }

  function renderVis() {
    visRaf = 0;
    if (!spectrumOn) return;
    if (visHost && !visHost.isConnected) {   // 页面重挂 body 时画布会被清掉，重建
      visHost = null; visCanvas = null; vis2d = null;
      visPos = { x: -1, y: -1, s: -1 };
    }
    if (!visHost || !vis2d) ensureVis();

    /* 不在详情页：直接隐藏，不采样也不画；回到详情页后下一帧自动恢复 */
    var onPage = onPlayerPage();
    if (onPage !== visPageOn) {
      visPageOn = onPage;
      if (onPage) visAlpha = 0;   // 每次回到播放页都从全透明开始，保证一定有渐显
      logDbg('频谱: ' + (onPage
        ? '已进入播放页，恢复显示'
        : '不在播放页（hash=' + String(location.hash || '(空)') + '），隐藏'));
    }
    if (!onPage) {
      visFadeTo(0);   // 离开播放页：渐隐（画布保留上一帧内容一起淡下去）
      visRaf = requestAnimationFrame(renderVis);
      return;
    }

    if (!visAnalyser) { visAlpha = 0; visHost.style.opacity = '0'; return; }

    if (!visData || visData.length !== visAnalyser.frequencyBinCount) {
      visData = new Uint8Array(visAnalyser.frequencyBinCount);
      visSmooth = null;
    }
    visAnalyser.getByteFrequencyData(visData);

    var sum = 0;
    for (var q = 0; q < visData.length; q++) sum += visData[q];
    var loud = sum / visData.length > 0.4;
    if (loud && !visGotData) { visGotData = true; logDbg('频谱: 已采到音频数据'); }
    visIdle = loud ? 0 : visIdle + 1;
    /* 回到播放页时从这里渐显（visAlpha 从 0 涨到 1）；静音时淡出，别留一圈死柱子 */
    visFadeTo(visIdle > 40 ? 0 : 1);

    /* 定位优先级：封面右下角的图标 → 标定偏移（每帧实时跟随封面，无缓存滞后） */
    var anchor = findLikeAnchor(false);
    var box = null, how = '';
    if (anchor) {
      try { box = anchor.getBoundingClientRect(); } catch (e) { box = null; }
      if (box && box.width > 0) how = '图标';
      else box = null;
    }
    if (!how) {
      box = geoBox();
      if (box) how = '标定偏移';
    }
    if (how !== visAnchorHow) {
      logDbg('频谱来源: ' + (how || '(没定位到封面右下)') +
        (visAnchorDist >= 0 ? (' 距封面右下=' + Math.round(visAnchorDist) + 'px') : ''));
    }
    visAnchorHow = how;
    if (how && box && box.width > 0) drawRing(layoutVis(box));
    else visFadeTo(0);   // 定位不到封面右下角（比如切页途中）：渐隐而不是硬切
    visRaf = requestAnimationFrame(renderVis);
  }

  /* 建立/唤醒频谱：开关打开、拿到新音源、启动时都走这里 */
  function startVis() {
    if (!spectrumOn) return;
    ensureVis();
    visIdle = 0;
    /* 不在这里直接点亮：是否可见统一交给 renderVis 判断（非播放页必须保持隐藏） */
    if (!visRaf) visRaf = requestAnimationFrame(renderVis);
  }

  function setSpectrum(on) {
    spectrumOn = !!on;
    ls(CFG.visKey, spectrumOn ? '1' : '0');
    if (spectrumOn) {
      startVis();
      if (!visAnalyser) logDbg('频谱: 还没接管到 AudioContext，出声后会自动出现');
    } else {
      if (visRaf) { cancelAnimationFrame(visRaf); visRaf = 0; }
      if (visHost) { visAlpha = 0; visHost.style.opacity = '0'; }
    }
    renderPopup();
  }

  /* 频谱配色开关：只切换取色，不重启频谱。清掉缓存后下一帧就按新开关重画 */
  function setSpectrumColor(on) {
    spectrumColorOn = !!on;
    ls(CFG.visColorKey, spectrumColorOn ? '1' : '0');
    visPalette = null;
    visPaletteKey = '';
    visPaletteAt = 0;
    visPaletteSettleUntil = 0;
    visPaletteRetryAt = 0;
    logDbg('频谱配色: ' + (spectrumColorOn ? '跟随背景（取色）' : '固定蓝白'));
    renderPopup();
  }

  /* 频谱排障：把音频架构与频谱自身状态一次性写进 %TEMP%\soda-mod.log */
  function diagAudio(tag) {
    var els = allMedia();
    var playing = 0;
    for (var i = 0; i < els.length; i++) if (!els[i].paused) playing++;
    var info = {
      ctx: (window.__sodaAudioContexts || []).length,
      abs: (window.__sodaABSNodes || []).length,
      worklet: (window.__sodaWorklets || []).join(',') || '(无)',
      media: els.length,
      playing: playing,
      analyser: visAnalyser ? visAnalyser.constructor.name : '(无)',
      raf: visRaf ? 1 : 0,
      opacity: visHost ? visHost.style.opacity : '(未建)',
      size: visCanvas ? (visCanvas.width + 'x' + visCanvas.height) : '-',
      anchor: visAnchor ? (visAnchor.tagName + ' ' + classOf(visAnchor).split(/\s+/)[0] +
        ' ' + Math.round(visAnchor.getBoundingClientRect().width) + 'px') : '(未找到)',
      how: visAnchorHow || '-',
      dist: Math.round(visAnchorDist),
      peak: -1
    };
    if (visAnalyser) {
      try {
        var buf = new Uint8Array(visAnalyser.frequencyBinCount);
        visAnalyser.getByteFrequencyData(buf);
        info.peak = 0;
        for (var j = 0; j < buf.length; j++) if (buf[j] > info.peak) info.peak = buf[j];
      } catch (e) { info.peak = -1; }
    }
    logDbg('诊断[' + tag + '] ' + JSON.stringify(info));

    /* 锚点候选：万一定位错了，这里能看到真正的那个 */
    var cov = coverBox();
    logDbg('封面[' + tag + '] ' + (cov
      ? ('右下=(' + Math.round(cov.right) + ',' + Math.round(cov.bottom) + ')')
      : '(未找到)'));
    var cands = collectAnchors();
    var brief = [];
    for (var k = 0; k < cands.length && k < 6; k++) {
      brief.push({
        i: k,
        cls: cands[k].cls.split(/\s+/)[0] || '-',
        num: cands[k].num || '-',
        size: Math.round(cands[k].rect.width) + 'x' + Math.round(cands[k].rect.height),
        x: Math.round(cands[k].rect.left),
        y: Math.round(cands[k].rect.top),
        score: Math.round(cands[k].score),
        dist: cands[k].dist < 0 ? '-' : Math.round(cands[k].dist),
        d: cands[k].d.slice(0, 24)
      });
    }
    logDbg('锚点候选[' + tag + '] ' + JSON.stringify(brief));
    return info;
  }

  /* 一进「正在播放」详情页就自动记一次诊断，省得盯着 8s/25s 的时间点 */
  var detailDiagAt = 0;
  setInterval(function () {
    if (!spectrumOn) return;
    if (!playerBoxRoot()) return;
    if (Date.now() - detailDiagAt < 20000) return;
    detailDiagAt = Date.now();
    diagAudio('详情页');
  }, 1500);

