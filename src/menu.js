  /* ================= 「更多」菜单注入 ================= */

  /* 自定义菜单项的图形。原生菜单项若不带图标容器，这些就不会被用上。 */
  var MENU_ICON =
    '<path d="M3.6 17.2a8.4 8.4 0 1 1 16.8 0"/>' +
    '<path d="M12 17.2l4.1-5.5"/>' +
    '<circle cx="12" cy="17.2" r="1.15" fill="currentColor" stroke="none"/>';

  var menuWindowUntil = 0;
  var menuScanTimer = 0;

  function logDbg(msg) {
    try { console.log('[倍速Mod] ' + msg); } catch (e) {}
  }

  function startMenuScanWindow() {
    menuWindowUntil = Date.now() + 4000;
    if (menuScanTimer) return;
    menuScanTimer = setInterval(function () {
      if (Date.now() > menuWindowUntil) {
        clearInterval(menuScanTimer);
        menuScanTimer = 0;
        return;
      }
      injectMenuItems();
    }, 250);
  }

  // 任何点击都开一小段菜单搜索窗口：底部播放条的「更多」在左下角，
  // 歌单/列表行的三点按钮在页面中部，统一覆盖，避免漏注入。
  // 扫描只先查 .menu 候选（见 collectMenus），开销很小。
  document.addEventListener('click', function () {
    startMenuScanWindow();
  }, true);

  /* 该客户端歌曲菜单的文案特征（用于精准识别，避免误伤侧栏 menu 等）。
     命中 2 个以上即认定为该菜单；词表同时覆盖列表行三点菜单与底部播放条「更多」。 */
  var MENU_WORDS = [
    '下一首播放', '添加到歌单', '查看歌手', '查看专辑', '分享', '复制曲名', '删除',
    '举报歌曲', '歌曲信息反馈', '播放倍速',
  ];

  function menuWordHits(el) {
    var txt = el.textContent || '';
    var n = 0;
    for (var i = 0; i < MENU_WORDS.length; i++) {
      if (txt.indexOf(MENU_WORDS[i]) >= 0) n++;
    }
    return n;
  }

  function looksLikeMenu(el) {
    try {
      if (el.nodeType !== 1) return false;
      if (el.id === 'soda-speed-pop') return false;
      if (el.hasAttribute('data-soda-mod-item')) return false;
      if (menuWordHits(el) < 2) return false;

      var r = el.getBoundingClientRect();
      if (r.width < 80 || r.width > 460) return false;
      if (r.height < 60 || r.height > 700) return false;
      if (r.bottom < 0 || r.top > window.innerHeight) return false;

      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (el.querySelector('input,textarea,select,video')) return false;

      // 需要有若干个高矮相仿的直接子项，append 进去才自然
      var kids = el.children;
      if (kids.length < 2 || kids.length > 16) return false;
      var h0 = kids[0].getBoundingClientRect().height;
      if (h0 < 18 || h0 > 110) return false;
      for (var i = 1; i < kids.length; i++) {
        var h = kids[i].getBoundingClientRect().height;
        if (Math.abs(h - h0) > h0 * 0.9) return false;
      }
      return true;
    } catch (e) { return false; }
  }

  /* 克隆菜单里的一个原生项当外观样本：沿用它的字号 / 内边距 / hover 效果，
     只替换文案、图标与右侧小字，注入项和原生项看不出差别。
       key      —— 落在 data-soda-mod-item 上，用于判断是否已注入
       iconPath —— 替换图标图形；null 表示沿用样本原样
       tailText —— 右侧小字（如当前倍速）；null 表示不加
       onRun    —— 点击回调，参数是注入进去的那个元素 */
  function buildMenuItem(menu, key, title, iconPath, tailText, onRun) {
    var sample = null;
    var menuRect = menu.getBoundingClientRect();
    for (var i = 0; i < menu.children.length; i++) {
      var k = menu.children[i];
      var kr;
      try { kr = k.getBoundingClientRect(); } catch (e) { continue; }
      if (kr.height >= 22 && kr.height <= 96 && kr.width >= menuRect.width * 0.5) { sample = k; break; }
    }
    if (!sample) return null;

    var item = sample.cloneNode(true);
    item.setAttribute('data-soda-mod-item', key);
    if (item.id) item.removeAttribute('id');
    item.classList.remove('danger');

    // 复用样本的图标容器，只替换内部图形，保持尺寸与描边风格一致
    if (iconPath) {
      var icon = item.querySelector('svg');
      if (icon) {
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '1.6');
        icon.setAttribute('stroke-linecap', 'round');
        icon.setAttribute('stroke-linejoin', 'round');
        icon.innerHTML = iconPath;
      }
    }

    // 把第一个非空文本替换成菜单标题
    var done = false;
    (function replaceText(node) {
      if (done) return;
      for (var n = 0; n < node.childNodes.length; n++) {
        var c = node.childNodes[n];
        if (c.nodeType === 3 && c.nodeValue.trim()) {
          c.nodeValue = title;
          done = true;
          return;
        }
        if (c.nodeType === 1) { replaceText(c); if (done) return; }
      }
    })(item);
    if (!done) item.appendChild(document.createTextNode(title));

    // 右侧小字（只有倍速项需要；样本自带右侧区域就复用，否则补一个）
    if (tailText !== null && tailText !== undefined) {
      var tail = null;
      for (var j = item.children.length - 1; j >= 0; j--) {
        var t = item.children[j];
        if (t.tagName === 'SPAN' || t.tagName === 'DIV') {
          var tr = t.getBoundingClientRect();
          if (tr.width > 0 && tr.width < 60) { tail = t; break; }
        }
      }
      var valueEl = document.createElement('span');
      valueEl.setAttribute('data-soda-mod-value', '1');
      valueEl.textContent = tailText;
      if (tail) {
        tail.parentNode.insertBefore(valueEl, tail.nextSibling);
        tail.style.marginLeft = 'auto';
      } else {
        valueEl.style.cssText = 'margin-left:auto;opacity:.55;font-size:12px;font-variant-numeric:tabular-nums;';
        item.appendChild(valueEl);
      }
    }

    item.addEventListener('click', function (e) {
      e.preventDefault();
      var v = item.querySelector('[data-soda-mod-value]');
      if (v) v.textContent = fmt(rate);
      try {
        onRun(item);
      } catch (err) {
        logDbg('菜单项「' + title + '」执行异常: ' + ((err && err.message) || err));
      }
    });

    return item;
  }

  /* 记录每个菜单上一次观察到的结构，用于等待渲染稳定 */
  var menuStable = new WeakMap();

  function describeMenu(menu) {
    var parts = [];
    for (var i = 0; i < menu.children.length; i++) {
      var k = menu.children[i];
      var t = (k.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 10) || '?';
      parts.push(t + (k.hasAttribute('data-soda-mod-item') ? '*' : ''));
    }
    return menu.children.length + ' 项[' + parts.join('/') + ']';
  }

  /* 注入后回看一次：用来区分「App 本来就没渲染该条目」与
     「我们 appendChild 之后被框架重渲染覆盖」。纯读取，不改动 DOM。 */
  function verifyAfterInject(menu, before) {
    setTimeout(function () {
      try {
        var hadSinger = before.indexOf('查看歌手') >= 0;
        var hasSinger = (menu.textContent || '').indexOf('查看歌手') >= 0;
        var mineAlive = !!menu.querySelector('[data-soda-mod-item]');
        logDbg('注入后复查: ' + describeMenu(menu)
          + ' | 我方项' + (mineAlive ? '在' : '已丢失'));
        if (hadSinger && !hasSinger) {
          logDbg('注意: 「查看歌手」出现在注入前列表、但注入后消失 —— 框架重渲染所致，非脚本删除');
        }
      } catch (e) { /* ignore */ }
    }, 180);
  }

  /* 菜单候选：先用 .menu（客户端 Menu 组件的根 class）粗筛，避免每轮全量扫 DOM；
     一个都没筛到时再退回全量遍历，防止 class 改名后功能整体失效。 */
  function collectMenus() {
    var out = [];
    var nodes;
    try { nodes = document.querySelectorAll('.menu'); } catch (e) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      if (looksLikeMenu(nodes[i])) out.push(nodes[i]);
    }
    if (out.length) return out;

    try { nodes = document.querySelectorAll('*'); } catch (e2) { return out; }
    for (var j = 0; j < nodes.length; j++) {
      if (looksLikeMenu(nodes[j])) out.push(nodes[j]);
    }
    return out;
  }

  /* 注入到歌曲菜单末尾的一项。run 在点击时才执行。 */
  var MOD_MENU_ITEMS = [
    {
      key: 'speed',
      title: '播放倍速',
      icon: MENU_ICON,
      tail: true,
      run: function () { togglePopup(); },
    },
  ];

  function injectMenuItems() {
    if (Date.now() > menuWindowUntil) return;

    var found = collectMenus();
    for (var j = 0; j < found.length; j++) {
      var menu = found[j];
      if (menu.querySelector('[data-soda-mod-item]')) continue;

      // 菜单刚弹出时可能还在逐项渲染，等结构连续两轮一致再插入，
      // 避免在框架 patch 中途动它的子节点。
      var key = menu.children.length + 'x' + Math.round(menu.getBoundingClientRect().height);
      if (menuStable.get(menu) !== key) {
        menuStable.set(menu, key);
        logDbg('等待菜单稳定: ' + describeMenu(menu));
        continue;
      }

      var before = describeMenu(menu);
      var added = 0;
      for (var d = 0; d < MOD_MENU_ITEMS.length; d++) {
        var def = MOD_MENU_ITEMS[d];
        var item = null;
        try {
          item = buildMenuItem(
            menu, def.key, def.title, def.icon, def.tail ? fmt(rate) : null,
            (function (m, dd) {
              return function () { dd.run(m); };
            })(menu, def)
          );
        } catch (e) { item = null; }
        if (item) { menu.appendChild(item); added++; }
      }

      if (added) {
        logDbg('注入前 ' + before + '  =>  注入后 ' + describeMenu(menu));
        verifyAfterInject(menu, before);
        menuWindowUntil = 0;
        return;
      }
    }
  }

