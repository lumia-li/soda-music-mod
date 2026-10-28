  /* ================= 歌单曲目行左侧封面（「我喜欢的音乐」等） ================= */

  /* MusicTable（div.music-table[data-v-d43e4e17]）的行只有序号 / 标题 / 歌手 / 专辑 / 时长，
     本身不含封面。这里在 .row 的序号右侧插一个 48px 封面（行高 62px），
     图取自 medias[i].entity.track.album.url_cover；拿不到就隐藏，不占位。 */

  var ROW_COVER_STYLE_ID = 'soda-row-cover-style';
  var ROW_COVER_CSS = ''
    + '.soda-row-cover{flex-shrink:0;width:48px;height:48px;margin-right:12px;border-radius:6px;'
    + 'overflow:hidden;background:rgba(255,255,255,.07);}'
    + '.soda-row-cover img{width:100%;height:100%;object-fit:cover;display:block;}'
    /* 重排后的行：序号 → 封面 → 歌曲 → 歌手 → 专辑 → 时长 → 操作 */
    + '.row.soda-row-arranged{height:62px;}'
    + '.row.soda-row-arranged > .col.index{margin-left:20px;}'
    + '.row.soda-row-arranged > .col.collect{margin-left:6px;}';

  function ensureRowCoverStyle() {
    var old = document.getElementById(ROW_COVER_STYLE_ID);
    if (old && old.isConnected) return;
    var s = document.createElement('style');
    s.id = ROW_COVER_STYLE_ID;
    s.textContent = ROW_COVER_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* url_cover 是「图片信息对象」，App 内部另有 getImageUrl() 转成真实地址；
     这里按常见结构兜底挑第一条可用 URL。 */
  function pickImageUrl(info) {
    if (!info) return '';
    if (typeof info === 'string') return info;
    if (Array.isArray(info)) return pickImageUrl(info[0]);
    var list = info.url_list || info.urls || info.urlList || info.UrlList;
    if (list) {
      if (typeof list === 'string') return list;
      if (list.length) return pickImageUrl(list[0]);
    }
    var direct = info.url || info.Url || info.src;
    if (typeof direct === 'string' && direct) return direct;
    return (typeof info.uri === 'string' && /^https?:/i.test(info.uri)) ? info.uri : '';
  }

  var IMG_KEY_RE = /(cover|pic|img|image|url)/i;

  /* 兜底：字段名/层级和预期不一致时，深搜对象里第一个可用的 http 图片地址。
     优先走键名含 cover/pic/img/url 的分支，尽量不会捡到分享链接之类的杂串。 */
  function deepFindUrl(obj, depth, seen) {
    if (!obj || depth > 5) return '';
    /* 只要「前缀 + uri ~ 模板」拼好的完整地址，光有 CDN 前缀的串没用 */
    if (typeof obj === 'string') return (/^https?:\/\//i.test(obj) && obj.indexOf('~') >= 0) ? obj : '';
    if (typeof obj !== 'object') return '';
    if (seen.indexOf(obj) >= 0) return '';
    seen.push(obj);
    var keys = Object.keys(obj);
    var i, k, hit;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (!IMG_KEY_RE.test(k)) continue;
      hit = deepFindUrl(obj[k], depth + 1, seen);
      if (hit) return hit;
    }
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (IMG_KEY_RE.test(k)) continue;
      hit = deepFindUrl(obj[k], depth + 1, seen);
      if (hit) return hit;
    }
    return '';
  }

  /* medias 的真实结构：
       { id, type, entity: { track_wrapper: { track } } }   普通曲目
       { id, type, entity: { video: {...} } }               视频音乐（mv / ugc_video）
     取法与客户端 playableFromEntityLike 一致：track ?? track_wrapper.track，否则 video。 */
  function trackOf(media) {
    if (!media) return null;
    var e = media.entity || media;
    return e.track || (e.track_wrapper && e.track_wrapper.track) || e.video || e;
  }

  /* 复刻 App 的 getImageUrl()：urls[0] 是 CDN 前缀、uri 是路径、template_prefix 决定裁剪模板。
     拼出来的地址形如 https://p3-luna.douyinpic.com/img/<uri>~<tpl>-crop-center:72:72.jpg */
  function coverFromInfo(info, size) {
    if (!info) return '';
    if (typeof info === 'string') return info;
    if (Array.isArray(info)) return coverFromInfo(info[0], size);
    var w = size || 72;
    var ext = 'jpg';
    if (info.uri && info.urls && info.urls.length) {
      if (info.template_prefix) {
        return info.urls[0] + info.uri + '~' + info.template_prefix + '-crop-center:' + w + ':' + w + '.' + ext;
      }
      return info.urls[0] + info.uri + '~c5_' + w + 'x' + w + '.' + ext;
    }
    return pickImageUrl(info);
  }

  function trackCoverUrl(media, size) {
    try {
      var t = trackOf(media);
      var url = coverFromInfo(t && t.album && t.album.url_cover, size);   // 普通曲目
      if (url) return url;
      url = coverFromInfo(t && (t.cover_url || t.url_cover), size);       // 视频音乐：video.cover_url
      if (url) return url;
      return deepFindUrl(t, 0, []);
    } catch (e) { return ''; }
  }

  /* 生产构建下 app._instance 恒为 null（Vue 只在 dev / prod-devtools 下才赋值），
     真正可用的入口是挂载容器上的 _vnode（render() 每次都会回写）。 */
  function rootVNode() {
    /* 最可靠的是 app._container —— mount 时 Vue 自己记下的真实挂载容器 */
    var el = document.getElementById('app');
    var app = (el && el.__vue_app__) || null;
    if (!app) {
      var k0 = (document.body && document.body.children) || [];
      for (var i0 = 0; i0 < k0.length; i0++) {
        if (k0[i0].__vue_app__) { app = k0[i0].__vue_app__; break; }
      }
    }
    if (app) {
      var c = app._container;
      if (c && c._vnode) return c._vnode;
      if (app._instance && app._instance.subTree) return app._instance.subTree;
    }
    if (el && el._vnode) return el._vnode;
    var kids = (document.body && document.body.children) || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i]._vnode) return kids[i]._vnode;
    }
    return null;
  }

  /* 组件树遍历很贵（深度上限 80），而滚动期每 120ms 就会被触发一轮，
     所以结果按 1 秒缓存：只要上次的实例还挂在文档里就复用。
     medias 每次都从 props 现读，切换歌单 / 数据更新都不会拿到旧数据。 */
  var tblHitsCache = null, tblHitsAt = 0;

  function musicTableHits() {
    var now = Date.now();
    if (tblHitsCache && now - tblHitsAt < 1000) {
      var alive = true;
      for (var q = 0; q < tblHitsCache.length; q++) {
        var rt = tblHitsCache[q].subTree && tblHitsCache[q].subTree.el;
        if (!rt || !rt.isConnected) { alive = false; break; }
      }
      if (alive) return tblHitsCache;
    }
    var hits = [];
    try {
      var root = rootVNode();
      if (!root) {
        diagCover('拿不到根 vnode（挂载点=' + (document.getElementById('app') ? '#app 无 _vnode' : '无 #app') + '）');
      } else {
        (function walk(v, d) {
          if (!v || d > 80 || hits.length > 8) return;
          var comp = v.component;
          if (comp) {
            if (comp.type && comp.type.__name === 'MusicTable') { hits.push(comp); return; }
            walk(comp.subTree, d + 1);
            return;
          }
          var ch = v.children;
          if (Array.isArray(ch)) for (var i = 0; i < ch.length; i++) walk(ch[i], d + 1);
          if (Array.isArray(v.dynamicChildren)) for (var j = 0; j < v.dynamicChildren.length; j++) walk(v.dynamicChildren[j], d + 1);
        })(root, 0);
      }
    } catch (e) {
      diagCover('读数据异常: ' + ((e && e.message) || e));
    }
    tblHitsCache = hits;
    tblHitsAt = now;
    return hits;
  }

  /* 收集「已挂载且有数据」的 MusicTable 实例。
     拿组件自己的根元素去取行（而不是全局 querySelector('.music-table')），
     这样行与 medias 天然一一对应，也不会被页面上别的 .row 干扰。 */
  function musicTables() {
    var out = [];
    var hits = musicTableHits();
    for (var k = 0; k < hits.length; k++) {
      var inst = hits[k];
      var el = inst.subTree && inst.subTree.el;
      if (!el || el.nodeType !== 1) continue;
      /* 开了「隐藏不可播放」后 props.medias 是我们塞进去的过滤结果，
         原始列表记在 inst.__sodaSrc 上 —— 封面匹配与计数都要用原始列表。 */
      var cur = inst.props && inst.props.medias;
      var raw = (inst.__sodaFiltered && cur === inst.__sodaFiltered) ? inst.__sodaSrc : cur;
      if (!raw || !raw.length) continue;
      out.push({ el: el, medias: raw, inst: inst });
    }
    if (!out.length) {
      diagCover('没有可用的 MusicTable（实例 ' + hits.length + ' 个，hash=' +
        String(location.hash || '').slice(0, 40) + '）');
    }
    return out;
  }

  var coverOkLogged = false;
  var coverDiagAt = 0;

  /* 诊断按 5s 节流，避免虚拟滚动时把日志刷爆 */
  function diagCover(msg) {
    var now = Date.now();
    if (now - coverDiagAt < 5000) return;
    coverDiagAt = now;
    logDbg('行封面: ' + msg);
  }

  /* 只在「内容真的变了」时才写 DOM，滚动时行会被反复复用，多写一次就多闪一下：
     - 同一个 URL 不重复赋值（重复 setAttribute 会让浏览器重新解码，肉眼可见地闪）；
     - 认不出曲目时保留灰色占位块，不再 display:none —— 隐藏会让整行的列左右跳；
     - 只有 URL 真的变了才算一次「封面写」，日志里能看到频次。 */
  function paintRowCover(row, url) {
    /* 表头（# / 歌曲 那一行）永远不插封面：以前走「按曲目列反推行」的兜底路径时
       会把它当成数据行，结果 # 表头里多出一块封面，整行还被撑高到 62px。 */
    if (!row || !row.classList || row.classList.contains('header')) return;
    var box = row.querySelector(':scope > .soda-row-cover');
    if (!box) {
      box = document.createElement('div');
      box.className = 'soda-row-cover';
      box.appendChild(document.createElement('img'));
      row.insertBefore(box, row.firstChild);
      stat.cover++;
    }
    if (box.dataset.coverUrl === url) return;
    box.dataset.coverUrl = url;
    var img = box.firstElementChild;
    if (!url) {
      if (img.hasAttribute('src')) img.removeAttribute('src');
      return;
    }
    stat.cover++;
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
  }

  /* 把行重排成「序号 → 封面 → 歌曲 → 歌手 → 专辑 → 时长 → 操作」。
     只挪节点不改内容；虚拟滚动重建行后由下一轮 observer 再排一次。 */
  function arrangeRow(row) {
    if (!row || !row.classList || row.classList.contains('header')) return;   // 表头不参与重排
    var k;
    var track = null, collect = null, index = null, actions = null;
    var kids = row.children;
    for (k = 0; k < kids.length; k++) {
      var c = kids[k];
      if (!c.classList || !c.classList.contains('col')) continue;
      if (c.classList.contains('track')) track = c;
      else if (c.classList.contains('collect')) collect = c;
      else if (c.classList.contains('index')) index = c;
      else if (c.classList.contains('actions')) actions = c;
    }
    if (!track) return;
    row.classList.add('soda-row-arranged');

    /* 歌手留在自己的列（表头「歌手」下面），这里只把爱心挪到「更多」左边。
       已经在位就一个节点都不动：insertBefore 会先摘再挂，既让整行重排（滚动时肉眼可见地闪），
       又会再触发一轮我们自己的 MutationObserver。 */
    if (collect && collect.parentNode === row) {
      var anchor = (actions && actions.parentNode === row) ? actions : null;
      var after = collect.nextSibling;
      while (after && after.nodeType !== 1) after = after.nextSibling;
      if (after !== anchor) {
        row.insertBefore(collect, anchor);
        stat.moves++;
      }
    }

    /* 封面放到序号右边（同样只挪不在位的那些） */
    var box = row.querySelector(':scope > .soda-row-cover');
    if (box) {
      var inPlace = index ? box.previousElementSibling === index : row.firstElementChild === box;
      if (!inPlace) {
        row.insertBefore(box, index ? index.nextSibling : row.firstChild);
        stat.moves++;
      }
    }
  }

  /* 关掉开关时把行还原成 App 原样：爱心归位、删封面（歌手列本来就未被动过） */
  function restoreRow(row) {
    row.classList.remove('soda-row-arranged');

    var box = row.querySelector(':scope > .soda-row-cover');
    if (box && box.parentNode) box.parentNode.removeChild(box);

    var collect = row.querySelector(':scope > .col.collect');
    if (collect) {
      var idx = row.querySelector(':scope > .col.index');
      row.insertBefore(collect, idx ? idx.nextSibling : row.firstChild);
    }
  }

  /* 曲目的名字：普通曲目在 name，视频音乐等可能只有 title */
  function nameOfTrack(m) {
    var t = trackOf(m);
    if (!t) return '';
    var v = t.name || t.title || '';
    return typeof v === 'string' ? v.trim() : '';
  }

  function sameName(a, b) {
    a = String(a || '').replace(/\s+/g, ' ').trim();
    b = String(b || '').replace(/\s+/g, ' ').trim();
    return !!a && a === b;
  }

  /* 认不出曲目时的现场快照（10 秒最多一条）：行标题 / 曲目列文本 / 首条媒体的字段形状。
     视频曲目与普通曲目字段不同，这份日志用来对症下药。 */
  var unmatchAt = 0;

  function shapeOf(v, depth) {
    if (v === null || v === undefined) return String(v);
    if (typeof v !== 'object') return (typeof v === 'string') ? '"' + v.slice(0, 20) + '"' : typeof v;
    if (depth <= 0) return Array.isArray(v) ? '[…]' : '{…}';
    if (Array.isArray(v)) return '[' + (v.length ? shapeOf(v[0], depth - 1) : '') + '×' + v.length + ']';
    var keys = Object.keys(v);
    var parts = [];
    for (var i = 0; i < keys.length && i < 12; i++) parts.push(keys[i] + ':' + shapeOf(v[keys[i]], depth - 1));
    return '{' + parts.join(',') + (keys.length > 12 ? ',…' : '') + '}';
  }

  function diagUnmatched(row, medias, name) {
    var now = Date.now();
    if (now - unmatchAt < 10000) return;
    unmatchAt = now;
    var col = row.querySelector('.col.track');
    var names = [];
    for (var i = 0; i < medias.length && i < 3; i++) names.push(nameOfTrack(medias[i]) || '(空)');
    logDbg('行封面认不出: 行标题="' + String(name || '').slice(0, 40) + '" 有title属性=' +
      (row.querySelector('.col.track [title]') ? 1 : 0) +
      ' 曲目列文本="' + (col ? String(col.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '') + '"' +
      ' 前三条名字=[' + names.join(' | ') + ']' +
      ' 首条结构=' + shapeOf(medias[0], 3));
  }

  /* 列表是虚拟滚动，只渲染可见的几行，行号与 medias 下标对不上，所以按标题认人。
     认不出时**不要**按行号猜：行元素的 DOM 位置会随滚动变化，猜一次换一个，
     表现就是「部分封面滚动一下就变一次」。只有整份列表都被渲染出来时行号才可靠。 */
  function mediaForRow(row, medias, fallbackIndex, allowIndex) {
    var el = row.querySelector('.col.track [title]') || row.querySelector('.col.track .ellipsis-text');
    var name = el ? String(el.getAttribute('title') || el.textContent || '').trim() : '';
    if (name) {
      var relaxed = null;
      for (var i = 0; i < medias.length; i++) {
        var nm = nameOfTrack(medias[i]);
        if (!nm) continue;
        if (sameName(nm, name)) return medias[i];
        /* 行里的文本可能被 App 挂上了「视频」之类的小尾巴：记下最长的前缀命中 */
        if (name.indexOf(nm) === 0 && nm.length >= 4 && (!relaxed || nm.length > relaxed.len)) {
          relaxed = { m: medias[i], len: nm.length };
        }
      }
      if (relaxed) return relaxed.m;
    }
    if (allowIndex && fallbackIndex >= 0 && fallbackIndex < medias.length) return medias[fallbackIndex];
    diagUnmatched(row, medias, name);
    return null;
  }

  function syncRowCovers() {
    if (!rowCoverOn) return;
    var tables = musicTables();
    if (!tables.length) return;
    ensureRowCoverStyle();
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i];
      var rows = [];
      var all = t.el.querySelectorAll('.row');
      for (var j = 0; j < all.length; j++) {
        if (!all[j].classList.contains('header')) rows.push(all[j]);
      }
      /* 表头（# / 歌曲 那行）如果被以前的版本塞过封面 / 撑高过，这里还原回去 */
      var headers = t.el.querySelectorAll('.row.header');
      for (var hd = 0; hd < headers.length; hd++) {
        var hr = headers[hd];
        if (hr.classList.contains('soda-row-arranged') || hr.querySelector('.soda-row-cover')) restoreRow(hr);
      }
      if (!rows.length) {
        /* 行容器类名变了也不要紧：用曲目列反推它所在的行（表头同样排除） */
        var cols = t.el.querySelectorAll('.col.track');
        for (var c = 0; c < cols.length; c++) {
          var pr = cols[c].parentElement;
          if (!pr || (pr.classList && pr.classList.contains('header'))) continue;
          if (rows.indexOf(pr) < 0) rows.push(pr);
        }
      }
      if (!rows.length) continue;
      /* 整份列表都渲染出来了（不是虚拟滚动）时，行号才和 medias 下标对得上 */
      var allowIndex = rows.length === t.medias.length;
      var matched = 0, appBad = 0, mismatch = 0;
      for (var n = 0; n < rows.length; n++) {
        var mm = mediaForRow(rows[n], t.medias, n, allowIndex);
        if (mm) matched++;
        /* 顺带核对「不可播放」判定与客户端自己的行标记（.invalid）是否一致 */
        var appInvalid = rows[n].classList.contains('invalid');
        if (appInvalid) appBad++;
        if (mm && (!!unplayableReason(mm) !== appInvalid)) mismatch++;
        paintRowCover(rows[n], trackCoverUrl(mm, 96));
        arrangeRow(rows[n]);
      }
      if (Date.now() - unplayChkAt > 10000) {
        unplayChkAt = Date.now();
        logDbg('不可播放判定核对: 行数=' + rows.length + ' 客户端标记=' + appBad + ' 不一致=' + mismatch);
      }
      if (!coverOkLogged) {
        coverOkLogged = true;
        logDbg('行封面: 行数=' + rows.length + '，数据=' + t.medias.length + '，命中=' + matched +
          '，未命中=' + (rows.length - matched) + '，按行号兜底=' + (allowIndex ? 1 : 0) +
          '，URL=' + (trackCoverUrl(t.medias[0], 72) || '(空)').slice(0, 110));
      }
    }
  }

  function setRowCover(on) {
    rowCoverOn = !!on;
    ls(CFG.rowCoverKey, rowCoverOn ? '1' : '0');
    if (!rowCoverOn) {
      var arranged = document.querySelectorAll('.row.soda-row-arranged');
      for (var i = 0; i < arranged.length; i++) restoreRow(arranged[i]);
      var boxes = document.querySelectorAll('.soda-row-cover');
      for (var j = 0; j < boxes.length; j++) {
        if (boxes[j].parentNode) boxes[j].parentNode.removeChild(boxes[j]);
      }
      return;
    }
    syncRowCovers();
  }

