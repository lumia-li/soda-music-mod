  /* ================= 评论区图片：内嵌查看器 ================= */

  /* 汽水点评论区的图片会新开一个独立窗口（app://resources/imagePreview.asar），
     这里改成就地看：背景模糊、图片居中、右上角关闭、滚轮缩放、拖拽平移、双击复位、Esc 关闭。
     拦截挂在 document 的捕获阶段 —— 比 App 自己的 click 处理更早，stopPropagation 之后
     App 就不会再去创建那个独立窗口了。评论区容器的类名取自 App 的样式表
     （.comment-view-container / .comment-block-container / .comment-item-wrapper …）。 */
  var IV_ID = 'soda-img-viewer';
  var ivZoom = 1, ivX = 0, ivY = 0, ivDrag = null;

  function ensureIvStyle() {
    if (document.getElementById('soda-iv-style')) return;
    var css = ''
      + '#' + IV_ID + '{position:fixed;inset:0;z-index:2147483647;display:none;overflow:hidden;'
      + 'align-items:center;justify-content:center;}'
      /* 遮罩就是一层不透明深色底，不做透视、不做模糊：
         窗口是 transparent 的，backdrop-filter 采样透明区域会当成黑色，
         界面本身又是不透明/半透明面板，怎么调都只会得到一块纯色，不如直接用纯色。 */
      + '#' + IV_ID + ' .soda-iv-mask{position:absolute;inset:0;background:#0a0a0c;}'
      /* App 的全局样式是 img{pointer-events:none}，不显式打开的话图片收不到拖拽/双击，
         点击还会穿透到遮罩上（一点就关）。 */
      + '#' + IV_ID + ' .soda-iv-img{position:relative;max-width:92vw;max-height:88vh;border-radius:8px;'
      + 'box-shadow:0 20px 64px rgba(0,0,0,.55);cursor:grab;user-select:none;-webkit-user-drag:none;'
      + 'pointer-events:auto !important;}'
      + '#' + IV_ID + '.dragging .soda-iv-img{cursor:grabbing;}'
      + '#' + IV_ID + ' .soda-iv-close{position:absolute;top:16px;right:18px;width:36px;height:36px;'
      + 'border:none;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:16px;'
      + 'line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;'
      + 'transition:background .15s ease;}'
      + '#' + IV_ID + ' .soda-iv-close:hover{background:rgba(255,255,255,.28);}';
    var s = document.createElement('style');
    s.id = 'soda-iv-style';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function ivApply() {
    var box = document.getElementById(IV_ID);
    if (!box) return;
    var img = box.querySelector('.soda-iv-img');
    if (img) img.style.transform = 'translate(' + ivX + 'px,' + ivY + 'px) scale(' + ivZoom + ')';
  }

  function closeImageViewer() {
    var box = document.getElementById(IV_ID);
    if (!box) return;
    box.style.display = 'none';
    box.classList.remove('dragging');
    var img = box.querySelector('.soda-iv-img');
    if (img) img.removeAttribute('src');   // 断开图片引用
    ivZoom = 1; ivX = 0; ivY = 0; ivDrag = null;
  }

  function isImageViewerOpen() {
    var box = document.getElementById(IV_ID);
    return !!box && box.style.display !== 'none';
  }

  function openImageViewer(src) {
    ensureIvStyle();
    var box = document.getElementById(IV_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = IV_ID;
      box.innerHTML = '<div class="soda-iv-mask"></div>'
        + '<img class="soda-iv-img" draggable="false" alt="">'
        + '<button class="soda-iv-close" type="button" title="关闭（Esc）">✕</button>';
      document.body.appendChild(box);

      var im = box.querySelector('.soda-iv-img');

      /* 关闭按钮 / 遮罩：在 document 捕获阶段处理，并在原地把事件掐断。
         只靠 viewer 内部的冒泡 stopPropagation 不够 —— App 关评论抽屉的判断常常挂在
         更早的捕获阶段，那样点关闭按钮会被当成「点到抽屉外面」，连评论一起关掉。
         捕获阶段 stopImmediatePropagation 之后，App 完全看不到这次点击。
         注意必须「按下不关、click 才关」：若 pointerdown 就把 viewer 隐藏，
         随后的 click 目标会变成下面的页面元素，照样漏给 App。
         图片上的事件不能这样拦（会把拖拽/双击监听一起掐掉），那边只走冒泡阻止。 */
      function ivBlockClose(e) {
        if (!isImageViewerOpen()) return;
        var t = e.target;
        if (!t || !t.closest || !t.closest('#' + IV_ID)) return;
        if (!t.closest('.soda-iv-close') && !t.closest('.soda-iv-mask')) return;
        e.stopImmediatePropagation();
        if (e.type !== 'click') return;   // 按下阶段不 preventDefault，否则 click 可能不生成
        e.preventDefault();
        closeImageViewer();
      }
      document.addEventListener('pointerdown', ivBlockClose, true);
      document.addEventListener('mousedown', ivBlockClose, true);
      document.addEventListener('click', ivBlockClose, true);

      /* 滚轮缩放：以光标位置为锚点，缩放前后光标下的那个像素保持不动。
         锚点用图片的实际包围盒中心（getBoundingClientRect 已含平移/缩放），
         而不是「视口中心 + 平移量」——图片不在正中心时（拖过、或长宽比极端）那样算会偏。 */
      box.addEventListener('wheel', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var rect = im.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        /* deltaMode: 0=像素 1=行 2=页，统一换算成像素，避免不同设备滚一格跳一大截 */
        var step = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 100 : 1));
        var k = Math.exp(-step * 0.0012);
        var next = Math.min(8, Math.max(0.2, ivZoom * k));
        k = next / ivZoom;
        if (k === 1) return;
        ivX += (e.clientX - cx) * (1 - k);
        ivY += (e.clientY - cy) * (1 - k);
        ivZoom = next;
        ivApply();
      }, { passive: false });

      /* 把 viewer 内部的鼠标事件挡在 viewer 上：App 靠「点到抽屉外面」来关评论区，
         不挡的话点关闭按钮会连评论一起关掉。冒泡阶段停（按钮自身监听先执行）。 */
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']
        .forEach(function (t) {
          box.addEventListener(t, function (e) { e.stopPropagation(); }, false);
        });

      /* 拖拽平移（按住图片拖动） */
      im.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        ivDrag = { x: e.clientX, y: e.clientY, tx: ivX, ty: ivY };
        box.classList.add('dragging');
        try { im.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      im.addEventListener('pointermove', function (e) {
        if (!ivDrag) return;
        ivX = ivDrag.tx + (e.clientX - ivDrag.x);
        ivY = ivDrag.ty + (e.clientY - ivDrag.y);
        ivApply();
      });
      function endDrag() {
        ivDrag = null;
        box.classList.remove('dragging');
      }
      im.addEventListener('pointerup', endDrag);
      im.addEventListener('pointercancel', endDrag);

      /* 双击复位 */
      im.addEventListener('dblclick', function () {
        ivZoom = 1; ivX = 0; ivY = 0;
        ivApply();
      });

      /* Esc 关闭：捕获阶段拦下，别让 App 顺手把评论抽屉也关了 */
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !isImageViewerOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        closeImageViewer();
      }, true);
    }

    var img = box.querySelector('.soda-iv-img');
    ivZoom = 1; ivX = 0; ivY = 0;
    img.src = src;
    ivApply();
    box.style.display = 'flex';
  }

  /* 找出点击处那张「够大的」图片。
     App 的全局样式是 img{pointer-events:none}，所以 e.target 往往是包着图片的 div：
     旧版直接取容器里第一个 img，点到九宫格第二张时拿到的是第一张，尺寸也对不上，
     于是有的图看着没反应。这里改成按点击坐标命中 —— 遍历附近的 img，谁盖住了光标就用谁。
     小图（表情、头像、点赞图标）按 60px 门槛排除。 */
  function findImgAt(x, y, scope) {
    var list;
    try { list = (scope || document).querySelectorAll('img'); } catch (e) { return ''; }
    for (var i = 0; i < list.length; i++) {
      var im = list[i];
      var r;
      try { r = im.getBoundingClientRect(); } catch (e) { continue; }
      if (r.width < 60 || r.height < 60) continue;
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) {
        var s = im.currentSrc || im.src;
        if (s) return s;
      }
    }
    return '';
  }

  function findCommentImgSrc(el, x, y) {
    var scope = el.closest && el.closest('.comment-view-container,.comment-view-scroll-container,'
      + '.comment-block-container,.comment-item-wrapper,.subject-comment-wrapper,.side-panel,'
      + '[class*="comment"],[class*="reply"]');
    if (scope) {
      var src = findImgAt(x, y, scope);
      if (src) return src;

      /* 用 background-image 渲染的图片：从点击处往上找几层 */
      var n = el, depth = 0;
      while (n && n !== scope && depth < 6) {
        var cs = null;
        try { cs = getComputedStyle(n); } catch (e) { cs = null; }
        var bg = cs && cs.backgroundImage;
        if (bg && bg.indexOf('url(') === 0) {
          var m = bg.match(/url\(["']?(.+?)["']?\)/);
          var r2;
          try { r2 = n.getBoundingClientRect(); } catch (e2) { r2 = null; }
          if (m && r2 && r2.width >= 60 && r2.height >= 60) return m[1];
        }
        n = n.parentElement; depth++;
      }
    }
    /* 兜底：光标是 zoom-in 就说明这本来就是「点开看大图」的区域 */
    var style = null;
    try { style = getComputedStyle(el); } catch (e3) { style = null; }
    if (style && style.cursor === 'zoom-in') return findImgAt(x, y, null);
    return '';
  }

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    if (target.closest('#' + IV_ID)) return;      // viewer 自己的按钮各管各的
    var src = findCommentImgSrc(target, e.clientX, e.clientY);
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    logDbg('评论图片: 内嵌查看 ' + src.slice(0, 90));
    openImageViewer(src);
  }, true);

