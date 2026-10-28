  /* ================= 滚动期诊断 ================= */

  /* 滚动时列表会不断复用 / 重建行。这里统计「到底是谁在改 DOM」：
       外部变动 —— App 自己重渲染（虚拟滚动固有行为，我们改不了）
       我方重排 / 封面写 —— 我们脚本动的手（能优化掉）
       自激忽略 —— 只由我们自己插封面 / 挪爱心引起的变动批次，被滤掉不再触发下一轮
     日志每 2 秒最多写一行，且只在有活动时写。 */
  var stat = null;
  function statReset() {
    stat = { passes: 0, batches: 0, recs: 0, add: 0, del: 0, moves: 0, cover: 0, selfBatches: 0, samples: [] };
  }
  statReset();

  function nodeBrief(n) {
    if (!n || n.nodeType !== 1) return '#' + ((n && n.nodeType) || '?');
    var c = (n.getAttribute && n.getAttribute('class')) || '';
    return n.tagName + (c ? '.' + c.split(/\s+/).slice(0, 2).join('.') : '');
  }

  /* 我们自己插的封面 / 菜单项、挪的爱心：这类变动不算「外部变动」 */
  function ourNode(n) {
    if (!n || n.nodeType !== 1 || !n.classList) return false;
    if (n.classList.contains('soda-row-cover')) return true;
    if (n.hasAttribute && n.hasAttribute('data-soda-unplay-item')) return true;
    return n.classList.contains('col') && n.classList.contains('collect');
  }
  function ourRecord(r) {
    var a = r.addedNodes, b = r.removedNodes;
    if (!a.length && !b.length) return false;
    for (var i = 0; i < a.length; i++) if (!ourNode(a[i])) return false;
    for (var j = 0; j < b.length; j++) if (!ourNode(b[j])) return false;
    return true;
  }

  setInterval(function () {
    if (!stat.passes && !stat.batches && !stat.selfBatches) return;
    logDbg('滚动诊断[2s]: 我方扫描=' + stat.passes + ' 外部变动=' + stat.batches + '批/' + stat.recs + '记录'
      + ' 增=' + stat.add + ' 删=' + stat.del
      + ' 我方重排=' + stat.moves + ' 封面写=' + stat.cover
      + ' 自激忽略=' + stat.selfBatches
      + (stat.samples.length ? ' 样例[' + stat.samples.join(' ') + ']' : ''));
    statReset();
  }, 2000);

