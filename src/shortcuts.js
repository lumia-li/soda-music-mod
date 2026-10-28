  /* ================= 快捷键 ================= */

  /* 小键盘 ←/→（Numpad4 / Numpad6）：快进/后退 5 秒。
     Alt 组合键留给下面的倍速快捷键；输入框里不抢键。 */
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    /* seekBy 会往下派发合成按键，这里必须只处理真人按键，否则会自己触发自己 */
    if (e.isTrusted === false) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
    var dir = seekKeyDir(e);
    if (!dir) return;
    if (!seekBy(dir * SEEK_STEP)) {           // 没在播歌就把按键交还给 App
      logDbg('进度调节: 找不到 .bottom-player');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    showSeekTip(dir * SEEK_STEP);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    var handled = true;
    switch (e.key) {
      case 'ArrowUp': setRate(rate + CFG.step); showPopup(); break;
      case 'ArrowDown': setRate(rate - CFG.step); showPopup(); break;
      case 'ArrowRight': setRate(rate + 0.25); showPopup(); break;
      case 'ArrowLeft': setRate(rate - 0.25); showPopup(); break;
      case '0': case ')': setRate(1); showPopup(); break;
      case 'm': case 'M': suspend(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

