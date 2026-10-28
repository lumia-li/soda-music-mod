  /* ================= 隐藏不可播放曲目（无版权 / 无音源 / 类型不支持） ================= */

  /* 判定对齐客户端源码：
       src/utils/track.ts —— checkPlayableUnplayable()
       src/services/queue/playable/constants.ts —— MEDIA_TYPE_PLAYABLE_TYPE_MAP
     客户端对这类行只在 <div class="row"> 上加 .invalid（opacity:.3）并在点击时弹提示，
     这里把它做成可以开关的过滤。 */
  var UNSUPPORTED_MEDIA_TYPE = {
    audio: 1, jay_mv: 1, live_room: 1, luna_post_video: 1, slot: 1,
    ads_video: 1, ads_live_room: 1, playlist: 1
  };

  /* 不可播放时返回原因（可播返回空串）。
     字段位置取自 src/services/queue/playable/convert.ts：
       track = entity.track ?? entity.track_wrapper.track，否则取 entity.video
       vid / status / label_info / media_type 都挂在上面取到的那个对象上 */
  function unplayableReason(media) {
    var e = media && media.entity;
    if (!e) return '无效的音乐';
    var track = e.track || (e.track_wrapper && e.track_wrapper.track);
    var item = track || e.video;
    if (!item) return '无效的音乐';
    var mt = track ? track.media_type : (item.type || '');
    if (UNSUPPORTED_MEDIA_TYPE[mt]) return '暂不支持播放';
    if (!item.vid) return '暂无音源';
    if (item.status) return '暂无音源';
    if (item.label_info && item.label_info.on_sale) return '付费专辑';
    return '';
  }

  var unplayLogKey = '';
  var unplayChkAt = 0;
  var lastUnplayBad = -1;   // 最近一次统计出的不可播数量（「…」菜单里的文案要用）

  /* ---------- 页面「…」菜单里的开关项 ---------- */

  /* MenuItem.vue 的 scoped id（从打包 CSS 的 .menu-item[data-v-…] 读到）：
     带上它新建的节点才能吃到 App 原生样式 —— 字号 14 / 高度 40 / hover 底色。 */
  var MENU_ITEM_SCOPE = 'data-v-6f2a15b2';

  /* 「…」菜单的文案特征（源码 components/PlaylistMoreAction.vue）。
     注意「我喜欢的音乐」的菜单只有「设置为公开 / 隐私」一条，不能要求命中多条。 */
  var PLAYLIST_MENU_WORDS = ['设置为公开', '设置为隐私', '删除歌单', '编辑歌单'];

  var EYE_OFF_SVG =
    '<path d="M3 3l18 18"/>' +
    '<path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 9 4 10 7-.4 1.2-1.4 3-3.2 4.5"/>' +
    '<path d="M6.2 6.6C3.9 8.1 2.4 10.2 2 12c1 3 5 7 10 7 1.6 0 3-.4 4.3-1"/>' +
    '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';

  function unplayItemLabel() {
    if (hideUnplayable) {
      return lastUnplayBad > 0 ? '显示不可播放（已隐藏 ' + lastUnplayBad + ' 首）' : '显示不可播放';
    }
    return lastUnplayBad > 0 ? '隐藏不可播放（' + lastUnplayBad + ' 首）' : '隐藏不可播放';
  }

  function buildUnplayMenuItem() {
    var item = document.createElement('div');
    item.className = 'menu-item normal';
    item.setAttribute(MENU_ITEM_SCOPE, '');
    item.setAttribute('data-soda-unplay-item', '1');

    var icon = document.createElement('div');
    icon.className = 'icon';
    icon.setAttribute(MENU_ITEM_SCOPE, '');
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"'
      + ' stroke-linecap="round" stroke-linejoin="round" ' + MENU_ITEM_SCOPE + '>' + EYE_OFF_SVG + '</svg>';
    item.appendChild(icon);

    var label = document.createElement('span');
    label.setAttribute('data-soda-unplay-label', '1');
    label.textContent = unplayItemLabel();
    item.appendChild(label);

    item.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setHideUnplayable(!hideUnplayable);
      /* App 的 Popper 只在点外部 / Esc 时收起，这里手动收起：列表的变化马上就能看见 */
      try { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); } catch (e) { /* ignore */ }
    });
    return item;
  }

  function updateUnplayMenuItem() {
    var label = document.querySelector('[data-soda-unplay-label]');
    if (!label) return;
    var txt = unplayItemLabel();
    if (label.textContent !== txt) label.textContent = txt;
  }

  /* 「…」菜单一弹出就补一项。查 .menu 很便宜（同屏最多一两个），
     并且只在文案命中歌单菜单时才出手，免得误伤播放条「更多」等其它菜单。 */
  function injectPlaylistMenu() {
    var menus;
    try { menus = document.querySelectorAll('.menu'); } catch (e) { return; }
    for (var i = 0; i < menus.length; i++) {
      var m = menus[i];
      if (!m.classList || m.querySelector('[data-soda-unplay-item]')) continue;
      var r;
      try { r = m.getBoundingClientRect(); } catch (e) { continue; }
      if (!r.width || !r.height) continue;          // 收起状态
      var txt = m.textContent || '';
      var hit = false;
      for (var k = 0; k < PLAYLIST_MENU_WORDS.length; k++) {
        if (txt.indexOf(PLAYLIST_MENU_WORDS[k]) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
      m.appendChild(buildUnplayMenuItem());
      logDbg('隐藏不可播放: 已加入页面「…」菜单（' + unplayItemLabel() + '）');
    }
  }

  /* 过滤表格的 medias（开关就是上面那个菜单项）。
     过滤走「改组件 props.medias」：行是绝对定位（translateY(index*48px)）、
     容器高度 = 条数×48，只做 display:none 会留下 48px 空洞、滚动条也对不上；
     换成过滤后的列表，虚拟列表 / 高度 / 滚动条就全自洽了。
     写回只在「被 App 重新渲染覆盖回原始数组」时发生（比数组引用），
     每轮无脑赋值会让 App 反复重渲染。 */
  function syncUnplayable(tables) {
    if (!tables) tables = musicTables();
    songMatchCount = 0;
    if (!tables.length) { updateSongSearchCount(); return; }

    var total = 0, bad = 0, why = {};
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var inst = t.inst;
      var src = t.medias;
      var cur = inst.props && inst.props.medias;
      inst.__sodaSrc = src;   // 记住原始列表，「复原」和封面匹配都用它

      for (var q = 0; q < src.length; q++) {
        var r = unplayableReason(src[q]);
        if (!r) continue;
        bad++;
        why[r] = (why[r] || 0) + 1;
      }
      total += src.length;

      /* 过滤 / 复原：不可播放 + 搜索关键字合并成一次计算，
         两个条件任一变化都要重算（关键字记在 fkey 里） */
      var qtext = songQuery ? songQuery.toLowerCase() : '';
      if (hideUnplayable || qtext) {
        var target = inst.__sodaFiltered;
        var fkey = (hideUnplayable ? '1' : '0') + '|' + qtext;
        if (!target || inst.__sodaFilterSrc !== src || inst.__sodaFilterKey !== fkey) {
          target = [];
          for (q = 0; q < src.length; q++) {
            var mm = src[q];
            if (hideUnplayable && unplayableReason(mm)) continue;
            if (qtext && mediaTitleOf(mm).toLowerCase().indexOf(qtext) < 0) continue;
            target.push(mm);
          }
          inst.__sodaFiltered = target;
          inst.__sodaFilterSrc = src;
          inst.__sodaFilterKey = fkey;
        }
        if (cur !== target) inst.props.medias = target;
        if (qtext) songMatchCount += target.length;
      } else if (inst.__sodaFiltered && cur === inst.__sodaFiltered) {
        inst.props.medias = src;
        inst.__sodaFiltered = null;
        inst.__sodaFilterSrc = null;
        inst.__sodaFilterKey = '';
      }
    }

    lastUnplayBad = bad;
    updateUnplayMenuItem();

    var key = total + '/' + bad + '/' + (hideUnplayable ? 1 : 0);
    if (key !== unplayLogKey) {
      unplayLogKey = key;
      var parts = [];
      for (var k2 in why) if (why[k2]) parts.push(k2 + ' ' + why[k2] + ' 首');
      logDbg('隐藏不可播放: 列表 ' + total + ' 首，不可播 ' + bad + ' 首'
        + (parts.length ? '（' + parts.join('，') + '）' : '')
        + '，当前' + (hideUnplayable ? '已隐藏' : '未过滤'));
    }

    updateSongSearchCount();   // 搜索框右侧显示匹配数量
    if (songQuery && songQuery !== songQueryLog) {
      songQueryLog = songQuery;
      logDbg('搜索: "' + songQuery + '" → ' + songMatchCount + ' 首');
    } else if (!songQuery) {
      songQueryLog = '';
    }
  }

  function setHideUnplayable(on) {
    hideUnplayable = !!on;
    ls(CFG.hideUnKey, hideUnplayable ? '1' : '0');
    logDbg('隐藏不可播放: ' + (hideUnplayable ? '已开启' : '已关闭'));
    syncUnplayable();
  }

  /* ================= 歌曲搜索框（歌单 / 我喜欢的音乐 / 抖音收藏 / 历史播放） =================
   *
   * 位置：详情页头部右侧那排按钮（.detail-header-actions，播放全部所在的行）末尾，
   *       跟着页面一起滚动，就是各歌单的「右上方」。
   * 过滤：和「隐藏不可播放」走同一条路 —— 直接改 MusicTable 的 props.medias。
   *       行是绝对定位（translateY(index*48px)）、容器高度按条数算，
   *       用 display:none 会留下空洞、滚动条也对不上。
   */
  var SONG_SEARCH_ID = 'soda-song-search';
  var SONG_SEARCH_STYLE_ID = 'soda-song-search-style';
  var SONG_SEARCH_CSS = ''
    + '.soda-song-search{display:flex;align-items:center;gap:6px;margin-left:auto;'
    + 'height:32px;padding:0 10px;border-radius:16px;background:rgba(255,255,255,.08);'
    + 'transition:background .15s ease;-webkit-app-region:no-drag;}'
    + '.soda-song-search:focus-within{background:rgba(255,255,255,.14);}'
    + '.soda-song-search svg{width:14px;height:14px;flex-shrink:0;opacity:.6;}'
    + '.soda-song-search input{width:150px;border:0;outline:none;background:transparent;'
    + 'color:#fff;font:inherit;font-size:13px;padding:0;}'
    + '.soda-song-search input::placeholder{color:rgba(255,255,255,.42);}'
    + '.soda-song-search .count{font-size:12px;color:rgba(255,255,255,.5);white-space:nowrap;}'
    + '.soda-song-search .clear{width:18px;height:18px;border:0;padding:0;border-radius:50%;'
    + 'background:rgba(255,255,255,.16);color:#fff;font-size:11px;line-height:18px;cursor:pointer;'
    + 'display:none;flex-shrink:0;}'
    + '.soda-song-search .clear:hover{background:rgba(255,255,255,.28);}'
    + '.soda-song-search.has-text .clear{display:block;}';

  var songQuery = '';
  var songMatchCount = 0;
  var songQueryLog = '';
  var lastSearchHash = '';

  function ensureSongSearchStyle() {
    var old = document.getElementById(SONG_SEARCH_STYLE_ID);
    if (old && old.isConnected) {
      if (old.textContent !== SONG_SEARCH_CSS) old.textContent = SONG_SEARCH_CSS;
      return;
    }
    var s = document.createElement('style');
    s.id = SONG_SEARCH_STYLE_ID;
    s.textContent = SONG_SEARCH_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* 表格每行的曲目名。数据是 mediaResourceLike，歌单页实际结构是
     {entity:{track_wrapper:{track:{name:…}}}}，普通页面是 {entity:{track:{name:…}}}，
     统一交给 trackOf() 取（它还兜了 video / 直接是 track 的情况）。 */
  function mediaTitleOf(m) {
    try {
      var t = trackOf(m);
      if (t) {
        var v = t.name || t.title || '';
        if (typeof v === 'string' && v) return v;
      }
      if (m && typeof m.name === 'string') return m.name;
      if (m && typeof m.title === 'string') return m.title;
    } catch (err) { /* ignore */ }
    return '';
  }

  function songSearchEl() { return document.getElementById(SONG_SEARCH_ID); }

  function updateSongSearchCount() {
    var box = songSearchEl();
    if (!box) return;
    var c = box.querySelector('.count');
    if (!c) return;
    c.textContent = songQuery ? (songMatchCount + ' 首') : '';
  }

  function buildSongSearchBox() {
    ensureSongSearchStyle();
    var box = document.createElement('div');
    box.id = SONG_SEARCH_ID;
    box.className = 'soda-song-search' + (songQuery ? ' has-text' : '');
    box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      + '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.6-3.6"></path></svg>'
      + '<input type="text" placeholder="搜索歌曲" spellcheck="false" autocomplete="off">'
      + '<span class="count"></span>'
      + '<button class="clear" type="button" title="清空">✕</button>';

    var input = box.querySelector('input');
    var clear = box.querySelector('.clear');
    input.value = songQuery;

    var apply = function () {
      songQuery = String(input.value || '').replace(/^\s+|\s+$/g, '');
      box.classList.toggle('has-text', !!songQuery);
      syncUnplayable();          // 立刻按新关键字重建列表
      updateSongSearchCount();
    };

    input.addEventListener('input', apply);
    /* 输入框里的按键别传给 App（方向键会被它当成上一首/下一首或进度调节） */
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        input.value = '';
        apply();
        try { input.blur(); } catch (err) { /* ignore */ }
      }
    });
    ['pointerdown', 'click', 'dblclick'].forEach(function (ev) {
      box.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
    clear.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      apply();
      try { input.focus(); } catch (err) { /* ignore */ }
    });
    return box;
  }

  /* 只在「有歌曲表格的详情页」插：我喜欢的音乐 / 抖音收藏 / 历史播放 / 各歌单
     （专辑、歌手页也是同一套 DetailHeader + MusicTable，一并支持） */
  function injectSongSearch() {
    if (!document.querySelector('.music-table')) return;
    var host = document.querySelector('.detail-header .detail-header-actions')
      || document.querySelector('.detail-header');
    if (!host) return;
    var exist = document.getElementById(SONG_SEARCH_ID);
    if (exist && host.contains(exist)) {
      updateSongSearchCount();
      return;
    }
    /* 页面重渲染把搜索框冲掉时要重建：记住是否正在输入，重建后把焦点和光标还回去 */
    var hadFocus = !!(exist && document.activeElement && exist.contains(document.activeElement));
    if (exist && exist.parentNode) exist.parentNode.removeChild(exist);
    var box = buildSongSearchBox();
    host.appendChild(box);
    if (hadFocus) {
      try {
        var inp = box.querySelector('input');
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      } catch (err) { /* ignore */ }
    }
    updateSongSearchCount();
  }

  /* 换页面（歌单之间跳转）时清空关键字：新列表不该继承上一个歌单的搜索词 */
  function resetSongQueryOnNav() {
    var h = String(location.hash || '');
    if (h === lastSearchHash) return;
    lastSearchHash = h;
    if (!songQuery) return;
    songQuery = '';
    var box = songSearchEl();
    if (box) {
      var input = box.querySelector('input');
      if (input) input.value = '';
      box.classList.remove('has-text');
      updateSongSearchCount();
    }
    syncUnplayable();
  }

  /* ---------- 设置页里的开关行（复刻 App 原生 SettingMenuItem + Switch） ---------- */

  function buildSwitchEl(on, onChange) {
    var el = document.createElement('div');
    el.className = 'switch' + (on ? ' switch-on' : '');
    el.setAttribute(SWITCH_SCOPE, '');
    el.setAttribute('role', 'switch');
    el.setAttribute('aria-checked', String(on));

    var node = document.createElement('div');
    node.className = 'node' + (on ? ' node-on' : '');
    node.setAttribute(SWITCH_SCOPE, '');
    el.appendChild(node);

    el.addEventListener('click', function (e) {
      e.stopPropagation();
      on = el.getAttribute('aria-checked') !== 'true';
      el.classList.toggle('switch-on', on);
      node.classList.toggle('node-on', on);
      el.setAttribute('aria-checked', String(on));
      onChange(on);
    });
    return el;
  }

  function injectRowCoverRow() {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box || box.querySelector('[data-soda-cover-row]')) return;

    var row = sample.cloneNode(true);
    row.setAttribute('data-soda-cover-row', '1');

    var title = row.querySelector('.left .title');
    if (!title) return;
    title.textContent = '歌单封面';

    var tip = row.querySelector('.left .tip');
    if (tip) tip.textContent = '在「我喜欢的音乐」等歌单的曲目左侧显示专辑封面';

    var right = row.querySelector('.right');
    if (!right) return;
    while (right.firstChild) right.removeChild(right.firstChild);
    right.appendChild(buildSwitchEl(rowCoverOn, setRowCover));

    var newCard = card.cloneNode(false);
    newCard.appendChild(row);
    box.appendChild(newCard);
  }

