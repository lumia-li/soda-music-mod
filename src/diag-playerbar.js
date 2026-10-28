  /* ================= 临时诊断：底部播放条结构 ================= */

  /* 移植 MusicBar 外观需要知道官方播放条里每个节点的类名 / 尺寸 / 层级，
     以及歌曲信息来源。只在第一次拿到播放条时打印一次，之后不再输出。 */
  var barDumpDone = false;
  function dumpPlayerBar() {
    if (barDumpDone) return;
    var bar = document.querySelector('.bottom-player');
    if (!bar) return;
    var r0;
    try { r0 = bar.getBoundingClientRect(); } catch (e) { return; }
    if (!r0 || r0.height < 20) return;
    barDumpDone = true;

    var out = [];
    (function walk(el, depth) {
      if (depth > 4 || out.length > 90) return;
      var cls = String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      var r;
      try { r = el.getBoundingClientRect(); } catch (e2) { r = { width: 0, height: 0 }; }
      out.push('  '.repeat(depth) + el.tagName.toLowerCase() + (cls ? '.' + cls : '')
        + '[' + Math.round(r.width) + 'x' + Math.round(r.height) + ']'
        + (txt ? ' "' + txt + '"' : '')
        + (el.tagName === 'IMG' ? ' src=' + String(el.currentSrc || el.src || '').slice(0, 60) : ''));
      for (var i = 0; i < el.children.length && i < 12; i++) walk(el.children[i], depth + 1);
    })(bar, 0);

    logDbg('播控结构[' + Math.round(r0.width) + 'x' + Math.round(r0.height) + ']:\n' + out.join('\n'));
    var ms = navigator.mediaSession && navigator.mediaSession.metadata;
    logDbg('MediaSession: ' + (ms
      ? ('title=' + ms.title + ' | artist=' + ms.artist + ' | artwork=' + ((ms.artwork && ms.artwork[0] && ms.artwork[0].src) || 'none'))
      : '无'));
    logDbg('媒体元素: audio=' + document.querySelectorAll('audio').length
      + ' video=' + document.querySelectorAll('video').length
      + ' playbackState=' + ((navigator.mediaSession && navigator.mediaSession.playbackState) || '-'));
  }

