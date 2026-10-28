  /* ================= 歌词「纯音乐，请欣赏」跟随进度条配色 ================= */

  /* 没有歌词时详情页显示这句提示，App 默认给灰字。
     颜色直接取底部播放条进度条的填充色（.slider-fill 的 background-color，
     App 是按封面动态算出来的 rgb(var(--color-base-3))）——歌曲一换、封面配色变了，
     这行字跟着变；取不到填充色再退回同一个 CSS 变量。 */
  var INS_LYRIC_TEXT = '纯音乐请欣赏';    // 比对时去掉空白与标点
  var INS_LYRIC_ATTR = 'data-soda-ins-lyric';

  function insStripPunct(s) {
    return String(s || '').replace(/[\s,，.。!！?？、:：;；~～]/g, '');
  }

  function progressFillColor() {
    var fill = document.querySelector('.bottom-player .slider-fill')
      || document.querySelector('.slider-fill');
    if (fill) {
      var cs = null;
      try { cs = getComputedStyle(fill); } catch (e) { cs = null; }
      var c = cs && cs.backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
    }
    return 'rgb(var(--color-base-3))';
  }

  var insObserver = null;      // 监听歌词容器：文字一出现就上色，不用等轮询
  var insObservedBox = null;   // 当前被监听的容器（切歌/换页会被重建）

  function paintInstrumentalLyric(box) {
    box = box || document.querySelector('.lyrics-container');
    if (!box) return;
    var color = progressFillColor();

    var nodes;
    try { nodes = box.querySelectorAll('div,span,p'); } catch (e) { return; }
    var hits = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (insStripPunct(el.textContent) !== INS_LYRIC_TEXT) continue;
      /* 只染最内层那个节点，别把整列歌词容器一起改了 */
      var hasInner = false;
      for (var k = 0; k < el.children.length; k++) {
        if (insStripPunct(el.children[k].textContent) === INS_LYRIC_TEXT) { hasInner = true; break; }
      }
      if (!hasInner) hits.push(el);
    }

    /* 上一次染过、这次不再匹配的（换歌后同一批 DOM 被复用成普通歌词）必须还原，
       否则内联颜色会残留到别的歌词行上。 */
    var marked;
    try { marked = box.querySelectorAll('[' + INS_LYRIC_ATTR + ']'); } catch (e) { marked = []; }
    for (var m = 0; m < marked.length; m++) {
      if (hits.indexOf(marked[m]) >= 0) continue;
      marked[m].removeAttribute(INS_LYRIC_ATTR);
      marked[m].style.removeProperty('color');
    }

    for (var h = 0; h < hits.length; h++) {
      hits[h].setAttribute(INS_LYRIC_ATTR, '1');
      /* 和进度条用同一个过渡时长（.slider-fill 上是 .4s），换歌时两边一起渐变，不会突兀 */
      hits[h].style.transition = 'color .4s ease';
      if (hits[h].style.color !== color) hits[h].style.color = color;
    }
  }

  /* 歌词容器一有增删/文字变化就立刻染（MutationObserver 回调是微任务，等于零延迟）；
     轮询只负责两件事：容器被重建时重新挂 observer、以及进度条换色后刷新文字颜色。 */
  function bindInsObserver(box) {
    if (insObserver) {
      try { insObserver.disconnect(); } catch (e) { /* ignore */ }
    }
    insObserver = new MutationObserver(function () { paintInstrumentalLyric(box); });
    insObserver.observe(box, { childList: true, subtree: true, characterData: true });
    insObservedBox = box;
  }

  setInterval(function () {
    var box = document.querySelector('.lyrics-container');
    if (!box) { insObservedBox = null; return; }
    if (box !== insObservedBox) bindInsObserver(box);
    paintInstrumentalLyric(box);
  }, 700);

