  /* ================= 音量区滚轮调节音量 ================= */

  /* 鼠标停在音量图标 / 音量弹层上滚轮，直接调音量。
     优先走 App 自己的音量滑块（.volume-box 里的垂直 slider）：
     模拟一次 pointerdown→move→up，让 App 的 store 自己更新，UI 和声音一起变；
     拿不到滑块（弹层还没展开）就退回去直接设 media.volume。 */
  var VOLUME_ZONE_SEL = '[class*="volume"],[class*="mute"],[aria-label*="音量"],[title*="音量"]';
  var volAnchor = null;   // 音量图标所在的小矩形（由弹层位置反推，见 captureVolumeAnchor）

  /* 音量弹层是贴在图标「正上方」弹出来的，而且弹层一出现就说明指针正在图标上。
     用它反推出图标那块区域：这样指针停在图标上（不必滑进弹层）滚轮也能调音量。
     每次滚轮/扫描都刷新一次锚点，弹层换了位置也跟着走。 */
  function captureVolumeAnchor() {
    var box = document.querySelector('.volume-box-wrapper');
    if (!box) return;
    var r;
    try { r = box.getBoundingClientRect(); } catch (e) { return; }
    if (r.width < 4 || r.height < 4) return;
    var cx = r.left + r.width / 2;
    volAnchor = {
      left: cx - 18,
      right: cx + 18,
      top: r.bottom - 2,
      bottom: r.bottom + 34
    };
  }

  function inVolumeAnchor(x, y) {
    return !!volAnchor && x >= volAnchor.left && x <= volAnchor.right
      && y >= volAnchor.top && y <= volAnchor.bottom;
  }

  function volumeTrack() {
    return document.querySelector('.volume-box .slider-track')
      || document.querySelector('.volume-box-wrapper .slider-track')
      || document.querySelector('.volume-box .slider')
      || document.querySelector('.volume-box-wrapper .slider');
  }

  function currentVolumeRatio() {
    var track = volumeTrack();
    if (track) {
      var fill = track.querySelector('.slider-fill');
      var tr;
      try { tr = track.getBoundingClientRect(); } catch (e) { tr = null; }
      if (fill && tr && tr.height > 4) {
        var fr = fill.getBoundingClientRect();
        if (tr.height > 0) return Math.max(0, Math.min(1, fr.height / tr.height));
      }
    }
    var media = document.querySelector('audio,video');
    if (media) return media.muted ? 0 : media.volume;
    return 0.5;
  }

  function setVolumeRatio(ratio) {
    ratio = Math.max(0, Math.min(1, ratio));
    var track = volumeTrack();
    var tr;
    if (track) {
      try { tr = track.getBoundingClientRect(); } catch (e) { tr = null; }
    }
    if (track && tr && tr.height > 4) {
      var x = tr.left + tr.width / 2;
      var y = tr.bottom - ratio * tr.height;
      var fire = function (type, buttons) {
        var base = {
          bubbles: true, cancelable: true, clientX: x, clientY: y,
          button: 0, buttons: buttons
        };
        try {
          if (type.indexOf('pointer') === 0) {
            track.dispatchEvent(new PointerEvent(type, Object.assign({
              pointerId: 1, pointerType: 'mouse', isPrimary: true
            }, base)));
          } else {
            track.dispatchEvent(new MouseEvent(type, base));
          }
        } catch (e) { /* ignore */ }
      };
      /* Slider 组件可能走 pointer 也可能走 mouse，两套都发一遍（值一样，不会重复生效） */
      fire('pointerdown', 1); fire('mousedown', 1);
      fire('pointermove', 1); fire('mousemove', 1);
      fire('pointerup', 0); fire('mouseup', 0);
      return true;
    }
    var media = document.querySelector('audio,video');
    if (media) {
      media.volume = ratio;
      media.muted = ratio <= 0.001;
      return true;
    }
    return false;
  }

  document.addEventListener('wheel', function (e) {
    var t = e.target;
    if (!t) return;
    /* 先把锚点刷新一遍：指针停在图标上时弹层通常已经弹出来了，据此拿到图标位置 */
    captureVolumeAnchor();
    var inZone = !!(t.closest && t.closest(VOLUME_ZONE_SEL));
    /* 类名匹配不到图标时（App 的音量按钮没有 volume 类名），退而用位置判定 */
    if (!inZone && !inVolumeAnchor(e.clientX, e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    var cur = currentVolumeRatio();
    /* 步长按滚动量自适应：鼠标滚轮一格（deltaY≈100）约 6%，触控板的小增量按比例缩小，
       否则触控板一次滑动会甩出几十个事件，音量直接冲到 0 或 100。 */
    var step = Math.min(0.08, Math.max(0.01, Math.abs(e.deltaY) * 0.0006));
    var next = cur + (e.deltaY < 0 ? step : -step);
    next = Math.max(0, Math.min(1, next));
    if (Math.abs(next - cur) < 0.002) return;
    setVolumeRatio(next);
  }, { passive: false, capture: true });

