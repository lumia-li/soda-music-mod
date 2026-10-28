  /* ================= 滚轮切歌（仅「正在播放」详情页） ================= */

  /* 详情页 = PlayerBoxAudioFrame 的根：div.container + scoped data-v-b8d357b5。
     不用 .fullscreen-player 判定 —— 那是外层布局的常驻容器，详情页没挂载时它也在。 */
  function playerBoxRoot() {
    return document.querySelector('div.container[data-v-b8d357b5]') ||
           document.querySelector('.lyrics-container');
  }

  /* 详情页的整块「舞台」：Player 组件的 div.fullscreen-player[data-v-5eed6e91]（position:absolute; inset:0）。
     歌词列右侧 / 周围的空白都落在它里面，但都不在 playerBoxRoot() 里，
     只按 root 判定会有大片滚了没反应的死区。这里取最近的 .fullscreen-player 祖先，
     找不到再退回到 root 本身。 */
  function playerStage() {
    var root = playerBoxRoot();
    if (!root) return null;
    var stage = null;
    try { stage = root.closest ? root.closest('.fullscreen-player') : null; } catch (e) { stage = null; }
    return stage || root;
  }

  /* 点播放条原生的上一首 / 下一首：控制组 div.controls.center 里，
     中间那个 .button.large 是播放/暂停，其父节点的首尾两个 div.button 即上一首、下一首。
     详情页打开时播放条只是 .hide（opacity:0），节点仍在，click() 照常触发 Vue 的处理器。 */
  function playbarNavigate(dir) {
    var big = document.querySelector('.controls.center .button.large');
    var group = big && big.parentElement;
    if (!group) return false;
    var btns = [];
    for (var i = 0; i < group.children.length; i++) {
      var c = group.children[i];
      if (c.classList && c.classList.contains('button')) btns.push(c);
    }
    if (btns.length < 3) return false;
    var target = dir > 0 ? btns[btns.length - 1] : btns[0];
    try { target.click(); } catch (e) { return false; }
    return true;
  }

  /* 播放条中央的播放 / 暂停按钮（详情页打开时它只是被 .hide 藏起来，节点仍在） */
  function playbarToggle() {
    var big = document.querySelector('.controls.center .button.large');
    if (!big) return false;
    try { big.click(); return true; } catch (e) { return false; }
  }

  var WHEEL_GAP = 420;   // 连续滚动只切一首
  var lastWheelAt = 0;

  /* 右侧歌词列 .lyrics-container > .lyrics-view > div.scroller（原生 overflow:scroll），
     滚轮在歌词上时先让歌词自己滚：一旦被 preventDefault，这个原生滚动就没了。
     只有当歌词已经滚到顶 / 底、同方向再滚时，才继续走下面的切歌逻辑。 */
  function lyricsScroller() {
    var box = document.querySelector('.lyrics-container');
    return box ? box.querySelector('.scroller') : null;
  }

  function consumeByLyrics(e) {
    var sc = lyricsScroller();
    if (!sc) return false;
    var path = e.composedPath ? e.composedPath() : [];
    var t = e.target;
    var onLyrics = path.indexOf(sc) >= 0 || (t && t.nodeType === 1 && sc.contains(t));
    if (!onLyrics) return false;
    if (sc.scrollHeight - sc.clientHeight <= 1) return false;   // 歌词没长到需要滚动
    return e.deltaY < 0
      ? sc.scrollTop > 0.5
      : sc.scrollTop + sc.clientHeight < sc.scrollHeight - 0.5;
  }

  function onWheel(e) {
    if (!wheelOn || !e.deltaY) return;
    var zone = playerStage();
    if (!zone) return;
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(zone) < 0) return;

    // 歌词还能滚 → 交给歌词自己滚，绝不能 preventDefault
    if (consumeByLyrics(e)) return;

    // 详情页其余区域：滚轮只用于切歌，别让底层页面跟着滚
    e.preventDefault();
    e.stopPropagation();

    var now = Date.now();
    if (now - lastWheelAt < WHEEL_GAP) return;
    lastWheelAt = now;
    if (!playbarNavigate(e.deltaY > 0 ? 1 : -1)) logDbg('滚轮切歌: 未找到播放条的上一首/下一首按钮');
  }

  document.addEventListener('wheel', onWheel, { capture: true, passive: false });

  /* ---------- 设置页里的开关（复刻 App 原生 SettingMenuItem + Switch） ---------- */

  var SWITCH_SCOPE = 'data-v-d8d11773';   // App 的 Switch 组件 scoped id

  function setWheelSwitch(on) {
    wheelOn = !!on;
    ls(CFG.wheelKey, wheelOn ? '1' : '0');
  }

  function buildWheelSwitch() {
    var el = document.createElement('div');
    el.className = 'switch' + (wheelOn ? ' switch-on' : '');
    el.setAttribute(SWITCH_SCOPE, '');
    el.setAttribute('role', 'switch');
    el.setAttribute('aria-checked', String(wheelOn));

    var node = document.createElement('div');
    node.className = 'node' + (wheelOn ? ' node-on' : '');
    node.setAttribute(SWITCH_SCOPE, '');
    el.appendChild(node);

    el.addEventListener('click', function (e) {
      e.stopPropagation();
      setWheelSwitch(!wheelOn);
      el.classList.toggle('switch-on', wheelOn);
      node.classList.toggle('node-on', wheelOn);
      el.setAttribute('aria-checked', String(wheelOn));
    });
    return el;
  }

  /* 设置页判定：页面里存在 .setting-menu-item 就说明设置页开着。
     原生结构是「卡片 > .setting-menu-item > .left/.right」，
     所以它的 parentElement 是卡片外壳、再上一层是卡片容器，全程不必知道任何类名。
     切换左侧导航会重建这些卡片，我们的行随之消失，下一轮 observer 会重新插入。 */
  function injectWheelSwitchRow() {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box || box.querySelector('[data-soda-wheel-row]')) return;

    var row = sample.cloneNode(true);
    row.setAttribute('data-soda-wheel-row', '1');

    var title = row.querySelector('.left .title');
    if (!title) {
      var left = row.querySelector('.left');
      if (!left) return;
      title = document.createElement('span');
      title.className = 'title';
      title.setAttribute('data-v-fd51c153', '');
      left.appendChild(title);
    }
    title.textContent = '滚轮切歌';

    var tip = row.querySelector('.left .tip');
    if (tip) tip.textContent = '在「正在播放」页用滚轮切换上一首 / 下一首，歌词区内滚动歌词';

    var right = row.querySelector('.right');
    if (!right) return;
    while (right.firstChild) right.removeChild(right.firstChild);
    right.appendChild(buildWheelSwitch());

    var newCard = card.cloneNode(false);   // 只留外壳，继承原生的类与 scoped 属性
    newCard.appendChild(row);
    box.appendChild(newCard);
  }

  /* ---------- 设置页行与开关的通用件 ---------- */

  /* 复刻 App 原生 Switch。状态每次点击都重新读 getOn()，所以外部改了状态也不会错位。 */
  function buildToggleSwitch(getOn, setOn) {
    var on = !!getOn();
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
      setOn(!getOn());
      var nowOn = !!getOn();
      el.classList.toggle('switch-on', nowOn);
      node.classList.toggle('node-on', nowOn);
      el.setAttribute('aria-checked', String(nowOn));
    });
    return el;
  }

  /* 与「滚轮切歌」同款做法：克隆一个原生设置行，只换标题 / 说明 / 右侧控件，
     外壳沿用原生类名与 scoped 属性，所以外观和系统设置项完全一致。
     marker 既当去重标记（避免重复插入），也当行标识。 */
  function injectNativeRow(marker, titleText, tipText, buildRight) {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box || box.querySelector('[' + marker + ']')) return;

    var row = sample.cloneNode(true);
    row.setAttribute(marker, '1');

    var title = row.querySelector('.left .title');
    if (!title) {
      var left = row.querySelector('.left');
      if (!left) return;
      title = document.createElement('span');
      title.className = 'title';
      title.setAttribute('data-v-fd51c153', '');
      left.appendChild(title);
    }
    title.textContent = titleText;

    var tip = row.querySelector('.left .tip');
    if (tip) tip.textContent = tipText;

    var right = row.querySelector('.right');
    if (!right) return;
    while (right.firstChild) right.removeChild(right.firstChild);
    right.appendChild(buildRight());

    var newCard = card.cloneNode(false);   // 只留外壳，继承原生的类与 scoped 属性
    newCard.appendChild(row);
    box.appendChild(newCard);
  }

  /* ================= 「关于汽水音乐」页面不出现 Mod 设置 =================
   *
   * 关于页（路由 /about：官网、邮箱、客服、举报电话…）用的是同一套
   * Card + SettingMenuItem，同样命中 .setting-menu-item，于是克隆出来的
   * Mod 设置行（滚轮切歌 / 频谱取色 / 播控样式…）全跑到那一页去了。
   * 用「路由 + 卡片文案」双重判断：命中就摘掉已插入的行，并且这一页不再注入。
   */
  var SETTING_ROW_MARKS = '[data-soda-wheel-row],[data-soda-viscolor-row],'
    + '[data-soda-widgetstyle-row],[data-soda-widgetbtns-card],[data-soda-resume-row],[data-soda-clearbg-row],'
    + '[data-soda-cover-row],[data-soda-clearbg-card],[data-soda-hiddenbtns-card],[data-soda-fx-card]';

  function isSettingsAboutPage() {
    try {
      var h = String(location.hash || '');
      /* 关于页 /about，以及它下面的「营业执照和平台资质」/business-license：
         这两个页面复用同一套 Card + SettingMenuItem，但容器是窄栏 / 横向排列，
         我们克隆进去的设置行会被挤成一条，所以整页都不注入。 */
      if (/\/about(\/|\?|$)/i.test(h)) return true;
      if (/\/business-license(\/|\?|$)/i.test(h)) return true;
    } catch (e) { /* ignore */ }
    try {
      if (document.querySelector('.business-license')) return true;
    } catch (e) { /* ignore */ }

    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return false;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    var text = '';
    try { text = (box && box.textContent) || ''; } catch (e) { text = ''; }
    return /营业执照和平台资质|营业执照|广播电视节目制作经营许可证|网络文化经营许可证|违法和不良信息举报电话|汽水智能客服|客户服务热线/.test(text);
  }

  function removeInjectedSettingRows() {
    var list;
    try { list = document.querySelectorAll(SETTING_ROW_MARKS); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var parent = el.parentElement;
      if (el.parentNode) el.parentNode.removeChild(el);
      /* 克隆行外面那张空卡片一起收走（我们插的行都是独立一张卡） */
      if (parent && parent !== document.body && parent.childElementCount === 0 && parent.parentNode) {
        parent.parentNode.removeChild(parent);
      }
    }
  }

  function injectSpectrumColorRow() {
    injectNativeRow(
      'data-soda-viscolor-row',
      '频谱跟随封面取色',
      '柱子颜色取自汽水按封面算好的主题色（--color-base），取不到再退回封面像素 / 背景渐变；关闭则用原来的蓝白',
      function () {
        return buildToggleSwitch(function () { return spectrumColorOn; }, setSpectrumColor);
      });
  }

