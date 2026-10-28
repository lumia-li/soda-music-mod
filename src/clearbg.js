  /* ================= 清掉背景绘制（只留文字与控件） ================= */

  var CLEARBG_BASE = 'rgb(18,18,18)';   // App 主窗口自身的底色

  /* 目标：去掉 App 的背景绘制，页面上只剩文字与控件。
     只用「清背景绘制 + 隐藏媒体节点」的写法，不整块 opacity:0 ——
     因为 .background 的尺寸等于整窗，万一它其实是包住全部 UI 的外壳，
     整块隐藏会把歌词也一起干掉；而 img/video/canvas 里不可能装文字，
     隐藏它们一定是安全的。
     透出来的是什么取决于窗口本身：窗口透明就是桌面，否则是窗口底色。 */
  var CLEARBG_STYLE_ID = 'soda-clearbg-style';
  var CLEARBG_CLASS = 'soda-clear-bg';
  var CLEARBG_PAINT_OFF = 'soda-paint-off';
  var CLEARBG_PAINT_FLAT = 'soda-paint-flat';  // 大面积容器：只铺实底，绝不套玻璃（否则切页会透出上一页）
  var CLEARBG_BAR_OFF = 'soda-bar-off';
  var CLEARBG_AMBIENT_OFF = 'soda-ambient-off';
  var CLEARBG_GLASS = 'soda-glass-on';   // 评论区/抽屉/弹层这类「大面板」，由类名关键词+面积扫出来
  var clearBgPaintAt = 0;      // 定时补扫的节流时间戳
  var clearBgGlassAt = 0;      // 毛玻璃面板补扫的节流时间戳
  /* 两种模式并存，由 bgMode 选择：
     · black        —— 近黑实底：根/body 铺不透明近黑，面板铺底色，表面比底下略亮。
                       开启「面板模糊」后表面与评论区/抽屉等大面板改半透明 + backdrop-filter，
                       压在它们下面的页面内容会被糊掉（毛玻璃），半径可调。
     · transparent  —— 玻璃化：根/面板/表面都半透明 + 背景模糊，主窗口透明时能直接看到桌面；
                       窗口不透明时看到的是窗口底色，不会比原来更糟（优雅降级）。
     两种模式共用同一套「清掉 App 自己的绘制」前置规则：
       · .background 外壳与其中的媒体节点隐掉；
       · 氛围层（整屏图片型绘制，即按封面生成的模糊背景）隐掉——否则会像一张大照片糊在所有页面上；
       · 空心细长条（歌词占位骨架条）去掉绘制。
     不透明度滑块两种模式都生效（black 模式下控制表面的亮度）；
     面板模糊滑块两种模式都生效（black 模式下 0 = 回到实底）。 */
  function blurDecl(px) {
    return 'backdrop-filter:blur(' + px + 'px) saturate(1.15) !important;'
      + '-webkit-backdrop-filter:blur(' + px + 'px) saturate(1.15) !important;';
  }

  function clearBgCss() {
    /* 共用的前置规则：先把 App 自己的背景绘制清干净 */
    var head = ''
      + 'html.' + CLEARBG_CLASS + ',html.' + CLEARBG_CLASS + ' body,html.' + CLEARBG_CLASS + ' #app{'
      + 'background:transparent !important;}'
      + 'html.' + CLEARBG_CLASS + ' .background{background:transparent !important;box-shadow:none !important;'
      + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}'
      + 'html.' + CLEARBG_CLASS + ' .background > *{background-image:none !important;box-shadow:none !important;}'
      + 'html.' + CLEARBG_CLASS + ' .background img,'
      + 'html.' + CLEARBG_CLASS + ' .background canvas,html.' + CLEARBG_CLASS + ' .background picture{opacity:0 !important;}'
      + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_AMBIENT_OFF + '{background:none !important;box-shadow:none !important;}'
      + 'html.' + CLEARBG_CLASS + ' img.' + CLEARBG_AMBIENT_OFF + ',html.' + CLEARBG_CLASS + ' video.' + CLEARBG_AMBIENT_OFF + ','
      + 'html.' + CLEARBG_CLASS + ' canvas.' + CLEARBG_AMBIENT_OFF + ',html.' + CLEARBG_CLASS + ' picture.' + CLEARBG_AMBIENT_OFF + '{opacity:0 !important;}'
      + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_BAR_OFF + '{background:none !important;box-shadow:none !important;}'
      /* 评论区「展开 / 回复」：App 在折叠评论底部盖一条 22px 高的 rgb(var(--color-base-8))
         实色条（颜色取自封面），清掉背景后就是一块突兀的彩色方块。
         这条实色原本正好压住正文第 11 行（行高 22px、容器 242px = 11 行），
         直接透明会把那行字露在按钮底下，所以改成：
           · 容器固定 242px，正文自己只排 10 行（220px），第 11 行空出来
           · 遮罩底色透明 —— 按钮正好落在空出来的那一行，没有色块也没有残字
         :has 用来只对「确实出现展开条」的评论生效。 */
      + 'html.' + CLEARBG_CLASS + ' .comment-block-container.collapsed .main-content:has(.main-content-expand-mask){'
      + 'height:242px !important;max-height:242px !important;}'
      + 'html.' + CLEARBG_CLASS + ' .main-content:has(.main-content-expand-mask) .main-content-text{'
      + 'display:block !important;max-height:220px !important;overflow:hidden !important;}'
      + 'html.' + CLEARBG_CLASS + ' .main-content-expand-mask{background-color:transparent !important;'
      + 'background-image:none !important;box-shadow:none !important;}'
      + 'html.' + CLEARBG_CLASS + ' .main-content-expand-mask:before{background:none !important;}';
    var panels = 'html.' + CLEARBG_CLASS + ' .main,html.' + CLEARBG_CLASS + ' .sidebar,'
      + 'html.' + CLEARBG_CLASS + ' .page,html.' + CLEARBG_CLASS + ' .player-box,'
      + 'html.' + CLEARBG_CLASS + ' .placeholder,html.' + CLEARBG_CLASS + ' .bottom-player{';

    if (bgMode === 'black') {
      /* 近黑实底：面板 = 纯底色；表面 = 底色再提一点（滑块给亮度），加发丝描边。
         窗口本身是 transparent（主进程补丁），所以黑底必须由页面自己画，
         否则面板之间的缝隙会漏出桌面。

         注意实底铺在 #app 上，不铺 html/body：
         根元素 html 的背景会被提升成「画布背景」，而画布背景不受 html 的 clip-path 裁剪，
         结果就是窗口圆角被这层实底重新填成方角（原样/透明模式没有这层实底，所以圆角正常）。
         body 背景在 html 背景为透明时同样会被传播到画布，同样不能用。 */
      var v = Math.round(18 + (255 - 18) * surfaceAlpha * 0.08);
      var solid = 'rgb(' + v + ',' + v + ',' + v + ')';
      var edge = 'box-shadow:inset 0 0 0 1px rgba(255,255,255,'
        + (0.02 + surfaceAlpha * 0.06).toFixed(3) + ') !important;';
      var base = 'html.' + CLEARBG_CLASS + ',html.' + CLEARBG_CLASS + ' body{'
        + 'background:transparent !important;}'
        + 'html.' + CLEARBG_CLASS + ' #app{background:' + CLEARBG_BASE + ' !important;}';
      var flat = 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_FLAT + '{';

      if (!(panelBlur > 0)) {
        /* 毛玻璃关闭：维持原来的实底，表面纯色、面板纯底色 */
        return head + base
          + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_OFF + '{background-color:' + solid
          + ' !important;background-image:none !important;' + edge + '}'
          + flat + 'background:' + CLEARBG_BASE + ' !important;box-shadow:none !important;}'
          + panels + 'background:' + CLEARBG_BASE + ' !important;box-shadow:none !important;}';
      }

      /* 毛玻璃开启：表面/小面板改成半透明 + backdrop-filter，
         压在这些层下面的内容（例如评论抽屉底下的歌单）会被糊掉；
         评论区/抽屉/弹层这类没有固定类名的「大面板」由 scanGlassPanels 打上
         CLEARBG_GLASS 标记，再套同一层玻璃。

         但「整屏容器」（.main / .page / .bottom-player / .sidebar / .player-box / .placeholder）
         必须保持不透明实底、且不挂 backdrop-filter：
         它们背后只有 #app 的黑底，玻璃没有视觉收益；而路由切换时新旧页面会短暂共存，
         容器一透明就透出上一页，再叠上整屏模糊就是「旧页残影 + 双播放条 + 整屏发糊」。
         这条规则写在「表面」规则之后，同特异性覆盖它。 */
      var glass = blurDecl(panelBlur);
      var surfA = clamp(0.35 + surfaceAlpha * 0.55, 0, 1).toFixed(3);
      return head + base
        + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_OFF + '{background-color:rgba(' + v + ',' + v + ',' + v + ','
        + surfA + ') !important;background-image:none !important;' + glass + edge + '}'
        + flat + 'background:' + CLEARBG_BASE + ' !important;box-shadow:none !important;'
        + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}'
        + panels + 'background:' + CLEARBG_BASE + ' !important;box-shadow:none !important;'
        + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}'
        + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_GLASS + '{background-color:rgba(' + v + ',' + v + ',' + v + ','
        + surfA + ') !important;background-image:none !important;' + glass + '}';
    }

    /* 透明模式：面板半透明 + 模糊；表面更透一点 + 发丝描边；
       大面积容器同样只做半透明、不挂 backdrop-filter（整屏模糊 == 切页残影）。

       弹窗（支付 / VIP）只把「最外层底板」做成半透明，内部元素一律不动：
       内部一旦半透明 + 模糊，就会露出弹窗自己的内容副本（重影）。
       所以这里只针对 markDialogRoots() 打出来的 .soda-dialog-root。 */
    var a = surfaceAlpha;
    var blur = panelBlur > 0 ? blurDecl(panelBlur) : '';
    var flatA = 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_FLAT + '{';
    return head
      + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_OFF + '{background-color:rgba(18,18,18,'
      + (a * 0.6).toFixed(3) + ') !important;background-image:none !important;' + blur
      + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06) !important;}'
      + flatA + 'background:rgba(18,18,18,' + a.toFixed(3) + ') !important;box-shadow:none !important;}'
      + panels + 'background:rgba(18,18,18,' + a.toFixed(3) + ') !important;box-shadow:none !important;' + blur + '}'
      + 'html.' + CLEARBG_CLASS + ' .' + DIALOG_ROOT_CLASS + '{background-color:rgba(18,18,18,'
      + a.toFixed(3) + ') !important;}';
  }

  /* 视频音乐（MV）的画面是「内容」，不是背景绘制：既不能被清掉，也不该被玻璃化。
     之前按面积把它当成「氛围层」隐掉了，结果视频背景模式下 MV 区域整块变透明。
     判据：<video> 本身 / 类名带 video、mv 的容器 / 内部含 <video> 的容器
     （querySelector 只在面积 ≥5% 视口的元素上做，避免整页遍历拖慢）。
     canvas 不能一概排除：App 的氛围背景也是 canvas 画的。 */
  function isVideoContent(el, area, vw, vh) {
    if (el.tagName === 'VIDEO') return true;
    var cls = ((el.className && String(el.className)) || '') + ' ' + (el.id || '');
    if (cls !== ' ' && /video|mv-?player|\bmv\b/i.test(cls)) return true;
    if (area >= vw * vh * 0.05 && el.querySelector && el.querySelector('video')) return true;
    return false;
  }

  /* 支付 / VIP 这类弹窗自带背景层和层级（.purchase、.offer-list、二维码等），
     把它们半透明化 + 模糊，会露出弹窗自己的内容副本，整块变成重影。
     所以整块跳过，任何清理/玻璃化都不碰。 */
  var DIALOG_SEL = '[class*="dialog"],[class*="modal"],[class*="popup"],[class*="purchase"],'
    + '[class*="vip"],[class*="qrcode"],[class*="offer"],[class*="payment"]';
  var DIALOG_ROOT_CLASS = 'soda-dialog-root';   // 弹窗最外层底板（透明模式下单独半透明化）
  var dialogRootAt = 0;

  function isDialogArea(el) {
    return !!(el && el.closest && el.closest(DIALOG_SEL));
  }

  /* 挑出弹窗里「够大的底板」打标记（排除 vip 徽标这类小东西）。
     之前限定「父级不能再属于弹窗区域」，结果弹窗外面还包着一层 .vip-xxx 容器时，
     真正的底板也被判成内层而跳过，整块弹窗就一点透明度都没有。
     现在按面积挑：弹窗里每一块够大的纯色底板都做半透明，层层透下来，
     视觉上就是「玻璃弹窗」；不做模糊，所以不会出现内容副本。 */
  function markDialogRoots() {
    var now = Date.now();
    if (now - dialogRootAt < 2500) return;
    dialogRootAt = now;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return;
    var list;
    try { list = document.querySelectorAll(DIALOG_SEL); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el || !el.classList || el.classList.contains(DIALOG_ROOT_CLASS)) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e2) { continue; }
      if (r.width * r.height < vw * vh * 0.05) continue;        // 小徽标不算
      el.classList.add(DIALOG_ROOT_CLASS);
    }
  }

  /* 清掉铺满视口的背景绘制：这类元素只可能是背景 / 根容器，不可能是按钮面板，
     所以清它是安全的。先只读收集候选、再统一写入，避免读写交错反复触发重排。
     走得通说明纯色是 DOM 画的；一处都扫不到，说明那是窗口自身的底色（CSS 管不到）。 */
  function clearViewportPaints() {
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return 0;

    var nodes;
    try { nodes = document.querySelectorAll('body, body *'); } catch (e) { return 0; }   // 底色可能画在 #app 之外

    /* 规则按「绘制类型」区分大小：
       · 纯色底 —— 门槛 1.5% 视口。评论输入框这类「表面」都在这条线上；
         再小的（播放按钮、角标、标签）是图标控件，清了会让图标在纯黑上看不见，所以放过。
       · 渐变 / 图片底 —— 仍要求够大（8% 视口），免得把卡片上的装饰渐变也抹了。
       带 url() 的背景一律不动：那是封面之类的图片内容，不是底色。 */
    var minArea = vw * vh * 0.015;
    var gradientMinArea = vw * vh * 0.08;
    var targets = [];
    var flats = [];
    var bars = [];
    var ambient = [];
    for (var i = 0; i < nodes.length && i < 4000; i++) {
      var el = nodes[i];
      /* html/body 不参与标记：
         · 它们的背景会被提升成「画布背景」，不受窗口圆角的 clip-path 裁剪（会把圆角填成方角）；
         · 它们已经被 head 规则统一设成 transparent，整窗实底由 #app 负责；
         · 给它们套半透明 + backdrop-filter 等于把整页做成玻璃层，
           路由切换时新旧页面共存 → 旧页透出来、整屏发糊，还多一层全屏合成。 */
      if (el.tagName === 'HTML' || el.tagName === 'BODY') continue;
      if (el.classList && (el.classList.contains(CLEARBG_PAINT_OFF) || el.classList.contains(CLEARBG_PAINT_FLAT)
        || el.classList.contains(CLEARBG_BAR_OFF) || el.classList.contains(CLEARBG_AMBIENT_OFF))) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      var area = r.width * r.height;
      if (area < vw * vh * 0.0004) continue;                      // 过小的一律不看（图标 / 角标）
      if (isVideoContent(el, area, vw, vh)) continue;             // MV 画面是内容，跳过
      if (isDialogArea(el)) continue;                             // 支付/VIP 等弹窗整块不动
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      var bgImage = cs.backgroundImage || 'none';
      var tag = el.tagName;

      /* 氛围层：整屏的「图片型」绘制 = App 按封面生成的模糊背景。
         真封面约占 16% 视口，够不到 25% 这条线，所以不会误伤。

         额外的内容保护：<img> 只有在 .background 背景壳里才可能是氛围层。
         评论区图片、歌词页封面这类「内容图」一旦被撑到 25% 视口（点开大图、
         长截图、窗口缩小），就会被误判成氛围层打上 opacity:0 —— 表现就是
         用着用着评论区的图全没了。 */
      var isMedia = tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'PICTURE';
      var inBackdrop = !!(el.closest && el.closest('.background'));
      if (area >= vw * vh * 0.25 && (isMedia || bgImage.indexOf('url(') >= 0)
        && (tag !== 'IMG' || inBackdrop)) {
        ambient.push(el);
        continue;
      }
      if (bgImage.indexOf('url(') >= 0) continue;                 // 封面等图片内容，不动

      var solidPaint = !!cs.backgroundColor
        && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
        && cs.backgroundColor !== 'transparent';
      if (!solidPaint && !(bgImage !== 'none' && area >= gradientMinArea)) continue;

      /* 空心细长条 = 歌词占位骨架条这类装饰。它们原本靠封面的模糊图当底才不显眼，
         换成纯色底后就会变成一条条明显色条，所以单独一档把绘制整个去掉。
         判据「无文字 + 无子元素 + 又细又长」，并排除播放条内部 ——
         进度条轨道也是空的长条，不能误伤。 */
      var thinEmpty = r.height > 0 && r.height < 30 && r.width > 120
        && (!el.textContent || !el.textContent.replace(/\s+/g, ''))
        && el.children.length === 0
        && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SELECT'
        && !(el.closest && el.closest('.bottom-player'));
      if (solidPaint && thinEmpty) { bars.push(el); continue; }

      if (area < minArea) continue;
      /* 大面积容器（≥40% 视口）单独归类：只铺实底，毛玻璃模式下也不做半透明/模糊。
         它们背后就是 #app 的黑底，玻璃没收益；而路由切换时新旧页面共存，
         一透明就透出上一页，再叠整屏模糊就是残影/错位。 */
      if (area >= vw * vh * 0.4) { flats.push(el); continue; }
      targets.push(el);
    }

    var names = [];
    for (var k = 0; k < targets.length; k++) {
      var t = targets[k];
      t.classList.add(CLEARBG_PAINT_OFF);
      names.push(t.tagName + '.' + (String(t.className || '').split(/\s+/)[0] || '-'));
    }
    var flatNames = [];
    for (var f = 0; f < flats.length; f++) {
      flats[f].classList.add(CLEARBG_PAINT_FLAT);
      flatNames.push(flats[f].tagName + '.' + (String(flats[f].className || '').split(/\s+/)[0] || '-'));
    }
    var barNames = [];
    for (var m = 0; m < bars.length; m++) {
      bars[m].classList.add(CLEARBG_BAR_OFF);
      barNames.push(bars[m].tagName + '.' + (String(bars[m].className || '').split(/\s+/)[0] || '-'));
    }
    var ambNames = [];
    for (var n = 0; n < ambient.length; n++) {
      ambient[n].classList.add(CLEARBG_AMBIENT_OFF);
      ambNames.push(ambient[n].tagName + '.' + (String(ambient[n].className || '').split(/\s+/)[0] || '-'));
    }
    if (names.length || barNames.length || ambNames.length || flatNames.length) {
      var brief = names.slice(0, 8).join(', ') + (names.length > 8 ? (' …共 ' + names.length + ' 处') : '');
      logDbg('背景清理: 表面 ' + names.length + ' 处[' + brief + '] 大容器 ' + flatNames.length +
        ' 处[' + flatNames.slice(0, 4).join(', ') + '] 空心条 ' + barNames.length +
        ' 处[' + barNames.slice(0, 6).join(', ') + '] 氛围层 ' + ambNames.length +
        ' 处[' + ambNames.slice(0, 4).join(', ') + ']');
    }
    return names.length + barNames.length + flatNames.length;
  }

  /* 评论区 / 抽屉 / 弹层这类「大面板」没有能钉死的类名，用「类名关键词 + 面积」兜底识别，
     打上 CLEARBG_GLASS 交给黑底模式的毛玻璃规则。只在真的需要糊的时候扫，并设数量上限，
     免得整页元素都挂上 backdrop-filter 把 GPU 吃满。
     面积门槛 3% 视口：评论里的小卡片也叫 comment，但它们糊了没意义；
     超过 90% 视口的大容器背后没有东西可糊，跳过。 */
  /* 只认评论区/抽屉这类「背后压着内容」的面板。
     弹窗（modal/dialog/popup/sheet）不在此列：它们自带背景与层级，
     再套一层半透明 + 模糊就是一团重影（见 DIALOG_SEL 的说明）。 */
  var GLASS_HINTS = ['comment', 'reply', 'drawer', 'panel'];
  function scanGlassPanels() {
    if (bgMode === 'off' || !(panelBlur > 0)) return 0;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return 0;
    var nodes;
    try { nodes = document.querySelectorAll('body *'); } catch (e) { return 0; }

    var found = [];
    for (var i = 0; i < nodes.length && i < 4000; i++) {
      var el = nodes[i];
      if (el.classList && el.classList.contains(CLEARBG_GLASS)) continue;
      var name = ((el.className && String(el.className)) || '') + ' ' + (el.id || '');
      name = name.toLowerCase();
      var hit = false;
      for (var h = 0; h < GLASS_HINTS.length; h++) {
        if (name.indexOf(GLASS_HINTS[h]) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      var area = r.width * r.height;
      if (area < vw * vh * 0.03 || area > vw * vh * 0.9) continue;
      if (isVideoContent(el, area, vw, vh)) continue;   // MV 播放器不当玻璃面板
      if (isDialogArea(el)) continue;                   // 支付/VIP 弹窗不做玻璃
      found.push(el);
      if (found.length >= 12) break;
    }

    var brief = [];
    for (var k = 0; k < found.length; k++) {
      found[k].classList.add(CLEARBG_GLASS);
      brief.push(found[k].tagName + '.' + (String(found[k].className || '').split(/\s+/)[0] || '-'));
    }
    if (brief.length) logDbg('毛玻璃面板: ' + brief.length + ' 处[' + brief.join(', ') + ']');
    return brief.length;
  }

  function ensureClearBgStyle() {
    var css = clearBgCss();
    var old = document.getElementById(CLEARBG_STYLE_ID);
    if (old && old.isConnected) {
      if (old.textContent !== css) old.textContent = css;   // 参数改了要跟着变
      return;
    }
    var s = document.createElement('style');
    s.id = CLEARBG_STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* 首次开启时把背景层的结构写进日志，方便确认到底遮干净了没有 */
  function describeClearBg() {
    var list = document.querySelectorAll('.background');
    var parts = [];
    for (var i = 0; i < list.length && i < 3; i++) {
      var el = list[i];
      var kids = [];
      for (var k = 0; k < el.children.length && k < 5; k++) {
        var c = el.children[k];
        kids.push(c.tagName + (c.className ? '.' + String(c.className).split(/\s+/)[0] : ''));
      }
      var cs = null;
      try { cs = getComputedStyle(el); } catch (e) { /* ignore */ }
      var paint = 'none';
      if (cs) {
        if (cs.backgroundImage && cs.backgroundImage !== 'none') paint = 'image';
        else if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') paint = cs.backgroundColor;
      }
      parts.push(el.tagName + '.' + (String(el.className || '').split(/\s+/)[0] || '-')
        + ' 绘制=' + paint + ' 子=[' + kids.join(', ') + ']');
    }
    return parts.length ? parts.join(' | ') : '(未找到 .background)';
  }

  function applyClearBg() {
    var root = document.documentElement;
    if (!root) return;
    if (bgMode === 'off') {
      if (root.classList.contains(CLEARBG_CLASS)) {
        root.classList.remove(CLEARBG_CLASS);
        logDbg('背景模式: 原样（不处理）');
      }
      return;
    }
    ensureClearBgStyle();
    if (!root.classList.contains(CLEARBG_CLASS)) {
      root.classList.add(CLEARBG_CLASS);
      logDbg('背景模式: ' + bgMode + ' | ' + describeClearBg());
    }
    var now = Date.now();
    if (now - clearBgPaintAt > 4000) {   // 每 4 秒补扫一次（Vue 重渲染后可能又画上底色）
      clearBgPaintAt = now;
      clearViewportPaints();
    }
    if (now - clearBgGlassAt > 4000) {   // 毛玻璃面板同理：面板重建后标记会丢，定期补
      clearBgGlassAt = now;
      scanGlassPanels();
    }
    /* 透明模式下弹窗底板也要跟着透明（黑底模式保持弹窗原样） */
    if (bgMode === 'transparent') markDialogRoots();
  }

  function setBgMode(mode) {
    bgMode = normBgMode(mode);
    ls(CFG.bgModeKey, bgMode);
    clearBgPaintAt = 0;          // 允许下一轮立刻补扫
    clearBgGlassAt = 0;
    applyClearBg();
    logDbg('背景模式: ' + bgMode);
  }

  /* 三档选择器：原样 / 黑底 / 透明（两种背景样式并存，随时切换） */
  function buildBgModeSeg() {
    ensureFxStyle();
    var seg = document.createElement('div');
    seg.className = 'soda-fx-seg';
    var opts = [['off', '原样'], ['black', '黑底'], ['transparent', '透明']];
    for (var i = 0; i < opts.length; i++) {
      (function (code, label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.setAttribute('data-mode', code);
        if (bgMode === code) b.classList.add('on');
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          setBgMode(code);
          for (var k = 0; k < seg.children.length; k++) {
            seg.children[k].classList.toggle('on', seg.children[k].getAttribute('data-mode') === bgMode);
          }
        });
        seg.appendChild(b);
      })(opts[i][0], opts[i][1]);
    }
    return seg;
  }

