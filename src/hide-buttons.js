  /* ================= 长按隐藏按钮 ================= */

  /* 长按任意按钮 600ms → 它右上角出现红色圆叉，点叉即可把这个按钮隐藏。
     隐藏用 display:none，布局由 App 自己的 flex 让位，后面的元素实时补上来。
     隐藏项按「标签 + 首个类名 + 文本」记进 localStorage，Vue 重渲染后按钮回来了
     也会被重新隐藏；要全部恢复就在控制台执行 __sodaSpeedMod.showHiddenButtons()。 */
  var HIDE_STORE = 'sodaSpeedMod.hiddenButtons';
  var HIDE_MARK_ID = 'soda-hide-mark';
  var HIDE_TARGET_CLASS = 'soda-hide-target';
  var HIDE_TARGET_SEL = 'button,[role="button"],[class*="btn"],[class*="button"]';
  var hideTimer = 0, hidePressEl = null, hidePressPt = null;
  var hideEditEl = null, hideMarkRAF = 0, hideSwallowUntil = 0;
  var hideAppliedEls = [];     // 本轮真正被我们隐藏的元素，恢复时只动这些

  function hideReadList() {
    try {
      var raw = ls(HIDE_STORE);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      /* 只认新格式（key 有 4 段）。旧记录没有序号段，会匹配到一大批同类按钮，
         直接丢掉，免得「恢复」之前一直被打回原形。 */
      return arr.filter(function (k) {
        return typeof k === 'string' && k.split('|').length === 4;
      });
    } catch (e) { return []; }
  }

  function hideWriteList(list) {
    try { ls(HIDE_STORE, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  /* 指纹：标签 + 首个类名 + 文本/aria + 在父级中的序号。
     加序号是因为 App 里大量按钮共用同一个类名（.button / .icon 之类），
     只靠「标签+类名」会把同类按钮全部认成同一个，隐藏一个就会连带隐藏一批。 */
  function hideKeyOf(el) {
    if (!el || !el.tagName) return '';
    var cls = '';
    if (typeof el.className === 'string') {
      var parts = el.className.trim().split(/\s+/).filter(function (c) {
        return c && c.indexOf('soda-') !== 0;
      });
      cls = parts[0] || '';
    }
    var txt = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    if (!txt) txt = (el.textContent || '').replace(/\s+/g, '').slice(0, 12);
    var idx = 0;
    var p = el.parentElement;
    if (p) {
      for (var i = 0; i < p.children.length; i++) {
        if (p.children[i] === el) { idx = i; break; }
      }
    }
    return el.tagName + '|' + cls + '|' + txt + '|' + idx;
  }

  function hideTargetOf(node) {
    var el = node && node.closest ? node.closest(HIDE_TARGET_SEL) : null;
    if (!el) return null;
    if (el.closest('#' + IV_ID + ',#' + HIDE_MARK_ID + ',.soda-fx-card')) return null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return null;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return null; }
    if (r.width < 16 || r.height < 16) return null;
    return el;
  }

  function ensureHideStyle() {
    if (document.getElementById('soda-hide-style')) return;
    var s = document.createElement('style');
    s.id = 'soda-hide-style';
    s.textContent = ''
      + '.' + HIDE_TARGET_CLASS + '{outline:2px dashed rgba(255,64,80,.9) !important;'
      + 'outline-offset:2px;border-radius:4px;}'
      + '#' + HIDE_MARK_ID + '{position:fixed;z-index:2147483647;width:22px;height:22px;'
      + 'border:none;border-radius:50%;background:#e5484d;color:#fff;display:none;'
      + 'align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.45);transform:translate(50%,-50%);}'
      + '#' + HIDE_MARK_ID + ':hover{background:#f25a5f;}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* 叉按钮跟着目标元素走（编辑期间每帧对一次位置，滚动/动画都不会掉队） */
  function hideMarkFollow() {
    var mark = document.getElementById(HIDE_MARK_ID);
    if (!hideEditEl || !mark) { hideMarkRAF = 0; return; }
    var r = hideEditEl.getBoundingClientRect();
    mark.style.left = (r.right - 2) + 'px';
    mark.style.top = (r.top + 2) + 'px';
    hideMarkRAF = window.requestAnimationFrame(hideMarkFollow);
  }

  function stopHideEdit() {
    if (hideEditEl) hideEditEl.classList.remove(HIDE_TARGET_CLASS);
    hideEditEl = null;
    if (hideMarkRAF) { window.cancelAnimationFrame(hideMarkRAF); hideMarkRAF = 0; }
    var mark = document.getElementById(HIDE_MARK_ID);
    if (mark) mark.style.display = 'none';
  }

  function startHideEdit(el) {
    ensureHideStyle();
    stopHideEdit();
    hideEditEl = el;
    el.classList.add(HIDE_TARGET_CLASS);
    hideSwallowUntil = Date.now() + 500;   // 松手那一下的点击不要触发按钮本身

    var mark = document.getElementById(HIDE_MARK_ID);
    if (!mark) {
      mark = document.createElement('button');
      mark.id = HIDE_MARK_ID;
      mark.type = 'button';
      mark.title = '隐藏这个按钮';
      mark.textContent = '✕';
      mark.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var target = hideEditEl;
        if (target) {
          var key = hideKeyOf(target);
          var list = hideReadList();
          if (key && list.indexOf(key) < 0) {
            list.push(key);
            hideWriteList(list);
          }
          target.style.display = 'none';
          hideMarkApplied(target);
          logDbg('已隐藏按钮: ' + key + '（共 ' + list.length + ' 项，设置页可恢复）');
        }
        stopHideEdit();
      });
      document.body.appendChild(mark);
    }
    mark.style.display = 'flex';
    if (!hideMarkRAF) hideMarkRAF = window.requestAnimationFrame(hideMarkFollow);
  }

  /* 按记录重新隐藏（每 1.5s 补一次，抵消 Vue 重建）。
     每个 key 只处理「一处」—— 之前是只要 key 命中就把所有同类元素都隐藏，
     于是一个按钮被隐藏后，类名相同的其他按钮也跟着消失，看起来就是「长按别的按钮没反应」。 */
  function applyHiddenButtons() {
    var list = hideReadList();
    if (!list.length) return;
    var nodes;
    try { nodes = document.querySelectorAll(HIDE_TARGET_SEL); } catch (e) { return; }
    var done = {};
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = hideKeyOf(el);
      if (!key || list.indexOf(key) < 0 || done[key]) continue;
      if (el.style.display === 'none') {
        done[key] = 1;      // 已经隐藏着的那个就是它，这个 key 不再处理别的元素
        hideMarkApplied(el);
        continue;
      }
      done[key] = 1;
      el.style.display = 'none';
      hideMarkApplied(el);
    }
  }

  function hideMarkApplied(el) {
    if (el && hideAppliedEls.indexOf(el) < 0) hideAppliedEls.push(el);
  }

  /* 只恢复「我们隐藏过」的那些，不动 App 自己 display:none 的元素 */
  function showHiddenButtons() {
    var n = 0;
    for (var i = 0; i < hideAppliedEls.length; i++) {
      var el = hideAppliedEls[i];
      if (el && el.style && el.style.display === 'none') {
        el.style.display = '';
        n++;
      }
    }
    hideAppliedEls.length = 0;
    hideWriteList([]);
    logDbg('已恢复隐藏按钮 ' + n + ' 个');
  }

  /* 隐藏项的显示名：key 是 tag|首个类名|文本|序号，取文本那一段 */
  function hideKeyLabel(k) {
    var p = String(k || '').split('|');
    var text = (p[2] || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 12);
    if (p[1]) return p[1];
    return p[0] || '按钮';
  }

  /* 单独恢复某一个隐藏的按钮（按 key） */
  function showHiddenButtonByKey(key) {
    var list = hideReadList();
    var pos = list.indexOf(key);
    if (pos >= 0) {
      list.splice(pos, 1);
      hideWriteList(list);
    }

    for (var i = hideAppliedEls.length - 1; i >= 0; i--) {
      var el = hideAppliedEls[i];
      if (!el || !el.isConnected) { hideAppliedEls.splice(i, 1); continue; }
      if (hideKeyOf(el) === key) {
        if (el.style.display === 'none') el.style.display = '';
        hideAppliedEls.splice(i, 1);
      }
    }

    /* Vue 重建后记录里的元素可能已经换了一个，按 key 再扫一遍兜底 */
    var nodes = [];
    try { nodes = document.querySelectorAll(HIDE_TARGET_SEL); } catch (e) { nodes = []; }
    for (var j = 0; j < nodes.length; j++) {
      if (hideKeyOf(nodes[j]) === key && nodes[j].style.display === 'none') {
        nodes[j].style.display = '';
      }
    }
    logDbg('设置页: 已恢复隐藏按钮 ' + key);
  }

  /* 卡片内容：标题 + 说明 + 一排「点一下就能恢复的小按钮」 */
  function fillHiddenCard(el, titleText, items, onRestoreOne) {
    el.innerHTML = '';

    var title = document.createElement('div');
    title.className = 'soda-fx-title';
    title.textContent = titleText;
    el.appendChild(title);

    var tip = document.createElement('div');
    tip.className = 'soda-fx-line';
    tip.style.display = 'block';
    tip.style.lineHeight = '1.6';
    tip.textContent = '长按任意按钮，点它右上角的红色叉即可隐藏；点下面的小按钮可以单独恢复。';
    el.appendChild(tip);

    if (!items.length) {
      var none = document.createElement('div');
      none.className = 'soda-fx-line';
      none.style.display = 'block';
      none.style.lineHeight = '1.6';
      none.style.color = 'rgba(255,255,255,.4)';
      none.textContent = '暂无隐藏的按钮';
      el.appendChild(none);
      return;
    }

    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';
    for (var i = 0; i < items.length; i++) {
      (function (it) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = it.label;
        chip.title = '点击恢复';
        chip.style.cssText = 'padding:5px 12px;border:0;border-radius:8px;'
          + 'background:rgba(255,255,255,.09);color:#fff;font-size:12px;cursor:pointer;';
        chip.addEventListener('mouseenter', function () {
          chip.style.background = 'rgba(255,255,255,.18)';
        });
        chip.addEventListener('mouseleave', function () {
          chip.style.background = 'rgba(255,255,255,.09)';
        });
        chip.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          onRestoreOne(it.key);
        });
        wrap.appendChild(chip);
      })(items[i]);
    }
    el.appendChild(wrap);
  }

  /* 汽水音乐主窗口的按钮隐藏卡片：常驻显示，点小按钮单独恢复 */
  function injectHiddenButtonsCard() {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box) return;

    ensureFxStyle();

    var list = hideReadList();
    var items = [];
    for (var i = 0; i < list.length; i++) items.push({ key: list[i], label: hideKeyLabel(list[i]) });
    var sig = items.map(function (x) { return x.key; }).join(',');

    var el = box.querySelector('[data-soda-hiddenbtns-card]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'soda-fx-card';
      el.setAttribute('data-soda-hiddenbtns-card', '1');
      box.appendChild(el);
    }

    /* 播控那张卡固定排在「隐藏的按钮」下面 */
    var wcard = box.querySelector('[data-soda-widgetbtns-card]');
    if (wcard && el.nextSibling !== wcard) box.insertBefore(wcard, el.nextSibling);

    if (el.__sig === sig) return;
    el.__sig = sig;

    fillHiddenCard(el, '隐藏的按钮（' + list.length + ' 个）', items, function (key) {
      showHiddenButtonByKey(key);
      el.__sig = '';
      injectHiddenButtonsCard();
    });
  }

  document.addEventListener('pointerdown', function (e) {
    /* 编辑态下点到别处就退出（点到叉按钮自己不算） */
    if (hideEditEl && e.target !== document.getElementById(HIDE_MARK_ID)) {
      if (!hideEditEl.contains(e.target)) stopHideEdit();
    }
    if (e.button !== 0) return;
    var el = hideTargetOf(e.target);
    if (!el) return;
    hidePressEl = el;
    hidePressPt = { x: e.clientX, y: e.clientY };
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      hideTimer = 0;
      if (!hidePressEl) return;
      var target = hidePressEl;
      hidePressEl = null;
      startHideEdit(target);
    }, 600);
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!hideTimer || !hidePressPt) return;
    if (Math.abs(e.clientX - hidePressPt.x) > 8 || Math.abs(e.clientY - hidePressPt.y) > 8) {
      clearTimeout(hideTimer);
      hideTimer = 0;
      hidePressEl = null;
    }
  }, true);

  function hidePressEnd() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    hidePressEl = null;
    hidePressPt = null;
  }
  document.addEventListener('pointerup', hidePressEnd, true);
  document.addEventListener('pointercancel', function () {
    hidePressEnd();
    stopHideEdit();
  }, true);

  /* 长按刚生效时，松手产生的那次 click 要吞掉，否则会顺带触发按钮原本的功能 */
  document.addEventListener('click', function (e) {
    if (Date.now() > hideSwallowUntil) return;
    if (!hideEditEl || !hideEditEl.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && hideEditEl) {
      e.preventDefault();
      e.stopPropagation();
      stopHideEdit();
    }
  }, true);

  setInterval(applyHiddenButtons, 1500);

