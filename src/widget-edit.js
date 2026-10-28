  /* ================= 编辑态：每个按钮右上角一个红叉 ================= */

  var editMode = false;
  var editTimer = 0;

  function widgetEditTargets() {
    var nat = widgetNativeButtons();
    var side = document.querySelector('.side-wrapper');
    return [
      { key: 'prev', el: nat.prev },
      { key: 'play', el: nat.play },
      { key: 'next', el: nat.next },
      { key: 'collect', el: nat.collect },
      { key: 'list', el: side && side.querySelector('.soda-mb-list') },
      { key: 'mode', el: side && side.querySelector('.soda-mb-mode') },
      { key: 'dislike', el: side && side.querySelector('.soda-mb-dislike') },
    ].filter(function (x) { return x.el && x.el.isConnected; });
  }

  function widgetPaintEditBadges() {
    var old = document.querySelectorAll('.soda-hold-x');
    for (var i = 0; i < old.length; i++) {
      if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
    }
    if (!editMode) return;

    var list = widgetEditTargets();
    for (var j = 0; j < list.length; j++) {
      var el = list[j].el;
      var key = list[j].key;
      var r = null;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      if (!r || !r.width || !r.height) continue;

      var x = document.createElement('span');
      x.className = 'soda-hold-x';
      x.textContent = '✕';
      x.style.cssText = 'position:fixed;z-index:10;width:14px;height:14px;border-radius:50%;'
        + 'background:#FE2C55;color:#fff;font-size:9px;line-height:14px;text-align:center;'
        + 'cursor:pointer;-webkit-app-region:no-drag;'
        + 'left:' + Math.round(r.right - 9) + 'px;top:' + Math.round(r.top - 5) + 'px;';
      x.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      (function (k) {
        x.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          widgetHideBtn(k);
          widgetPaintEditBadges();
          widgetResetEditTimer();
        });
      })(key);
      (document.body || document.documentElement).appendChild(x);
    }
  }

  function widgetResetEditTimer() {
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(function () {
      editTimer = 0;
      widgetExitEdit();
    }, 8000);
  }

  function widgetEnterEdit() {
    if (editMode) { widgetPaintEditBadges(); widgetResetEditTimer(); return; }
    editMode = true;
    widgetPaintEditBadges();
    widgetResetEditTimer();
    try { console.log('[倍速Mod] 播控按钮: 编辑模式（点红叉隐藏）'); } catch (e) { /* ignore */ }
  }

  function widgetExitEdit() {
    editMode = false;
    if (editTimer) { clearTimeout(editTimer); editTimer = 0; }
    var old = document.querySelectorAll('.soda-hold-x');
    for (var i = 0; i < old.length; i++) {
      if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
    }
  }

  /* 点空白处退出编辑态 */
  document.addEventListener('pointerdown', function (e) {
    if (!editMode) return;
    var t = e.target;
    if (t && t.classList && t.classList.contains('soda-hold-x')) return;
    if (t && t.closest && t.closest('.soda-hold-x')) return;
    widgetExitEdit();
  }, true);

  /* Esc 也退出编辑态 */
  document.addEventListener('keydown', function (e) {
    if (editMode && e.key === 'Escape') {
      e.preventDefault();
      widgetExitEdit();
    }
  }, true);

  /* 七个按钮全隐藏后的双击区域：左半边上一首、右半边下一首 */
  var WIDGET_ALL_KEYS = ['prev', 'play', 'next', 'collect', 'mode', 'dislike', 'list'];

  function widgetSetDisp(el, hide) {
    if (!el) return;
    if (hide) {
      if (el.style.display !== 'none') el.style.display = 'none';
    } else if (el.style.display === 'none') {
      el.style.display = '';
    }
  }

  function widgetNativeButtons() {
    var out = { prev: null, play: null, next: null, collect: null };
    var wrap = document.querySelector('.action-wrapper');
    if (wrap) {
      var btns = wrap.querySelectorAll('.action-button');
      if (btns.length) {
        out.prev = btns[0];
        out.next = btns[btns.length - 1];
        out.play = wrap.querySelector('.action-button--playback') || (btns.length > 1 ? btns[1] : null);
      }
    }
    var side = document.querySelector('.side-wrapper');
    if (side) {
      var all = side.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) {
        var c = all[i].classList;
        if (!c) continue;
        if (c.contains('soda-mb-mode') || c.contains('soda-mb-dislike') || c.contains('soda-mb-list')) continue;
        out.collect = all[i];
        break;
      }
    }
    return out;
  }

  function widgetNativeClick(kind) {
    var nat = widgetNativeButtons();
    var el = kind === 'prev' ? nat.prev : (kind === 'next' ? nat.next : null);
    if (!el) return;
    try { el.click(); } catch (e) { /* ignore */ }
  }

  function widgetZones(on) {
    var el = document.getElementById('soda-widget-zones');
    if (!on) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    if (el) return;
    el = document.createElement('div');
    el.id = 'soda-widget-zones';
    el.innerHTML = '<i class="z-l"></i><i class="z-r"></i>';
    var bind = function (sel, kind) {
      var node = el.querySelector(sel);
      if (!node) return;
      node.addEventListener('dblclick', function (e) {
        e.preventDefault();
        e.stopPropagation();
        widgetNativeClick(kind);
      });
    };
    bind('.z-l', 'prev');
    bind('.z-r', 'next');
    (document.body || document.documentElement).appendChild(el);
  }

  function widgetApplyHidden() {
    var hidden = widgetHiddenList();
    var has = function (k) { return hidden.indexOf(k) >= 0; };

    var nat = widgetNativeButtons();
    widgetSetDisp(nat.prev, has('prev'));
    widgetSetDisp(nat.play, has('play'));
    widgetSetDisp(nat.next, has('next'));
    widgetSetDisp(nat.collect, has('collect'));

    /* 原生按钮也支持长按隐藏 */
    widgetAttachHold(nat.prev, 'prev');
    widgetAttachHold(nat.play, 'play');
    widgetAttachHold(nat.next, 'next');
    widgetAttachHold(nat.collect, 'collect');

    /* 七个全隐藏后才出现双击换歌区域 */
    var allHidden = true;
    for (var i = 0; i < WIDGET_ALL_KEYS.length; i++) {
      if (!has(WIDGET_ALL_KEYS[i])) { allHidden = false; break; }
    }
    widgetZones(allHidden);
  }

  function widgetEnsureDislikeButton() {
    var side = document.querySelector('.side-wrapper');
    if (!side) return;
    if (widgetIsHidden('dislike')) {
      var hideOld = side.querySelector('.soda-mb-dislike');
      if (hideOld && hideOld.parentNode) hideOld.parentNode.removeChild(hideOld);
      return;
    }
    var exist = side.querySelector('.soda-mb-dislike');
    if (exist) { widgetAttachHold(exist, 'dislike'); return; }
    var b = document.createElement('button');
    b.className = 'soda-mb-dislike';
    b.type = 'button';
    b.title = '少推荐';
    b.innerHTML = '<svg viewBox="0 0 48 48"><path fill="currentColor" fill-rule="evenodd" d="'
      + DISLIKE_PATH + '"></path></svg>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        localStorage.setItem(WIDGET_CMD_KEY, JSON.stringify({ t: 'dislike', ts: Date.now() }));
      } catch (err) { /* ignore */ }
    });
    widgetAttachHold(b, 'dislike');
    side.insertBefore(b, side.firstChild);
  }

  function widgetEnsureModeButton() {
    var side = document.querySelector('.side-wrapper');
    if (!side) return;
    if (widgetIsHidden('mode')) {
      var hideOld = side.querySelector('.soda-mb-mode');
      if (hideOld && hideOld.parentNode) hideOld.parentNode.removeChild(hideOld);
      return;
    }
    var exist = side.querySelector('.soda-mb-mode');
    if (exist) {
      widgetRenderMode(exist);    // 上下文变了（进出歌单）要重画
      widgetAttachHold(exist, 'mode');
      return;
    }
    var b = document.createElement('button');
    b.className = 'soda-mb-mode';
    b.type = 'button';
    b.innerHTML = '<svg viewBox="0 0 24 24"></svg>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      widgetCycleMode(b);
    });
    widgetAttachHold(b, 'mode');
    side.insertBefore(b, side.firstChild);
    widgetRenderMode(b);
  }

