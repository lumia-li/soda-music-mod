  /* ================= 侧边栏品牌名（logo 下面加自己的名字） ================= */

  /* .logo-container 固定 44px 高且是横排，往里塞子元素会被裁；
     它的父级是 flex column，所以把名字作为「兄弟节点」插在它后面，落在 logo 正下方。
     不设 font-family / color / font-weight / letter-spacing，字体与颜色继承 App 原生
     （App 在 :root 上定义字体栈，Windows 上实际解析为 Arial）；
     只钉字号与侧边栏文字同级的 13px —— 否则会继承 :root 的 16px 而偏大。 */
  var BRAND_CSS = 'font-size:13px;padding:2px 0 0 24px;'
    + '-webkit-app-region:no-drag;user-select:none;pointer-events:none;';
  /* 只给颜文字上灰色：深色侧栏上半透明白看起来就是灰的，
     和 App 次要文字（.title 的 #ffffff80）同一种做法；名字仍继承原生颜色。 */
  var BRAND_FACE_CSS = 'color:rgba(255,255,255,.45);';

  function injectBrand() {
    var host = document.querySelector('.logo-container');
    if (!host || !host.parentNode) return false;
    var parent = host.parentNode;
    /* 名字可能来自旧版本（插在 logo 上方）或旧样式，统一收敛成一个节点放到 logo 下方 */
    var el = parent.querySelector(':scope > .soda-speed-brand');
    if (!el) {
      el = document.createElement('div');
      el.className = 'soda-speed-brand';
    }
    /* 名字与颜文字拆成两个 span：名字继承 App 原生颜色，颜文字单独用灰色 */
    var nameEl = el.querySelector('.soda-speed-brand-name');
    var faceEl = el.querySelector('.soda-speed-brand-face');
    if (!nameEl || !faceEl) {
      el.textContent = '';
      nameEl = document.createElement('span');
      nameEl.className = 'soda-speed-brand-name';
      faceEl = document.createElement('span');
      faceEl.className = 'soda-speed-brand-face';
      el.appendChild(nameEl);
      el.appendChild(faceEl);
    }
    if (faceEl.style.cssText !== BRAND_FACE_CSS) faceEl.style.cssText = BRAND_FACE_CSS;
    if (nameEl.textContent !== CFG.brandName) nameEl.textContent = CFG.brandName;
    if (faceEl.textContent !== CFG.brandFace) faceEl.textContent = CFG.brandFace;
    if (el.dataset.brandCss !== 'v4') {
      el.style.cssText = BRAND_CSS;
      el.dataset.brandCss = 'v4';
    }
    if (el.previousElementSibling !== host) {
      parent.insertBefore(el, host.nextSibling);
      logDbg('品牌名: 已在 logo 下方写入「' + CFG.brandName + CFG.brandFace + '」');
    }
    applyBrandFx();   // 名字节点每次重建都要重新套上特效
    return true;
  }

