  /* ================= 品牌名特效（彩色流光 / 往复流光 / 变色 / 呼吸 / 霓虹 / 扫光 / 故障） ================= */

  /* pingpong = 往复流光：彩色渐变左右来回流动（去 → 回 → 去），不加白光；
     靠 animation 的 alternate 实现「到底原路返回」，一个完整来回 = 2 × FX_BASE_DUR。 */
  var FX_MODES = ['off', 'flow', 'pingpong', 'hue', 'breathe', 'neon', 'laser', 'glitch'];
  var FX_LABELS = [['off', '关闭'], ['flow', '流光'], ['pingpong', '往复流光'], ['hue', '变色'],
                   ['breathe', '呼吸'], ['neon', '霓虹'], ['laser', '扫光'], ['glitch', '故障']];
  var FX_BASE_DUR = { flow: 6, pingpong: 3, hue: 12, breathe: 4, neon: 8, laser: 5, glitch: 3 };  // 各模式在 speed=1x 时的周期（秒）
  var FX_STYLE_ID = 'soda-brand-fx-style';

  function numOr(v, d) { var n = Number.parseFloat(v); return isFinite(n) ? n : d; }
  function normFx(v) { return FX_MODES.indexOf(v) >= 0 ? v : 'off'; }

  var brandFx = normFx(ls(CFG.fxKey) || 'flow');                         // 默认「流光」
  var fxSpeed = clamp(numOr(ls(CFG.fxSpeedKey), 1), 0.2, 3);
  var fxSat = clamp(numOr(ls(CFG.fxSatKey), 1), 0, 2);

  /* 渐变直接当文字底色（background-clip:text）：流光 / 扫光 / 往复流光动
     background-position，变色 / 霓虹动 hue-rotate，呼吸动 brightness，故障再叠位移。
     浓度用 saturate() 调，速度折算成 --soda-fx-dur。 */
  var FX_CSS = ''
    + '.soda-fx{background-image:linear-gradient(90deg,#ff2e63,#ff9f1c,#ffe066,#3ddc97,#2ec4ff,#a06bff,#ff2e63);'
    + 'background-size:200% 100%;-webkit-background-clip:text;background-clip:text;'
    + '-webkit-text-fill-color:transparent;color:transparent;'
    + 'filter:saturate(var(--soda-fx-sat,1)) drop-shadow(0 0 6px var(--soda-fx-glow,rgba(150,205,255,.45)));}'
    + '.soda-speed-brand.soda-fx{width:fit-content;}'
    /* 每个模式一套独立配色，别让所有模式共用同一张彩虹图 */
    + '.soda-fx[data-fx="flow"]{background-image:linear-gradient(90deg,#ff2e63,#ff9f1c,#ffe066,#3ddc97,#2ec4ff,#a06bff,#ff2e63);'
    + '--soda-fx-glow:rgba(255,120,180,.55);'
    + 'animation:sodaBrandFlow var(--soda-fx-dur,6s) linear infinite;}'
    + '.soda-fx[data-fx="hue"]{background-image:linear-gradient(90deg,#ff006e,#00f5d4,#ffbe0b,#ff006e);'
    + 'animation:sodaBrandHue var(--soda-fx-dur,12s) linear infinite;}'
    + '.soda-fx[data-fx="breathe"]{background-image:linear-gradient(90deg,#4cc9f0,#4361ee,#b5179e,#4cc9f0);'
    + 'animation:sodaBrandBreathe var(--soda-fx-dur,4s) ease-in-out infinite;}'
    + '.soda-fx[data-fx="neon"]{background-image:linear-gradient(90deg,#ff2fd0,#7b2ff7,#40e0ff,#ff2fd0);'
    + 'animation:sodaBrandNeon var(--soda-fx-dur,8s) linear infinite;}'
    + '.soda-fx[data-fx="laser"]{background-image:'
    + 'linear-gradient(100deg,rgba(255,255,255,0) 42%,rgba(255,255,255,.95) 50%,rgba(255,255,255,0) 58%),'
    + 'linear-gradient(90deg,#ffd700,#fff7c2,#ffb300,#f0a500,#ffd700);'
    + 'background-size:200% 100%,200% 100%;'
    + '--soda-fx-glow:rgba(255,200,60,.6);'
    + 'animation:sodaBrandLaser var(--soda-fx-dur,5s) linear infinite;}'
    /* 往复流光：不加白光，只让彩色渐变左右来回流动。alternate = 到底原路返回，
       ease-in-out 让两端自然减速；background-size 放到 300% 才有足够行程横穿整个词。 */
    + '.soda-fx[data-fx="pingpong"]{background-image:'
    + 'linear-gradient(90deg,#ff2e63,#ff9f1c,#ffe066,#3ddc97,#2ec4ff,#a06bff,#ff2e63);'
    + 'background-size:300% 100%;'
    + '--soda-fx-glow:rgba(160,120,255,.55);'
    + 'animation:sodaBrandPingPong var(--soda-fx-dur,3s) ease-in-out infinite alternate;}'
    + '.soda-fx[data-fx="glitch"]{background-image:linear-gradient(90deg,#ff003c,#00fff0,#ff0844,#00fff0,#ff003c);'
    + 'animation:sodaBrandGlitch var(--soda-fx-dur,3s) steps(1,end) infinite;}'
    + '@keyframes sodaBrandFlow{from{background-position:0% 50%;}to{background-position:200% 50%;}}'
    + '@keyframes sodaBrandHue{from{filter:saturate(var(--soda-fx-sat,1)) hue-rotate(0deg)'
    + ' drop-shadow(0 0 7px rgba(255,255,255,.35));}'
    + 'to{filter:saturate(var(--soda-fx-sat,1)) hue-rotate(360deg)'
    + ' drop-shadow(0 0 7px rgba(255,255,255,.35));}}'
    + '@keyframes sodaBrandBreathe{0%,100%{filter:saturate(var(--soda-fx-sat,1)) brightness(.72)'
    + ' drop-shadow(0 0 4px rgba(76,201,240,.35));}'
    + '50%{filter:saturate(var(--soda-fx-sat,1)) brightness(1.65) drop-shadow(0 0 12px rgba(76,201,240,.9));}}'
    + '@keyframes sodaBrandNeon{'
    + '0%{filter:saturate(var(--soda-fx-sat,1)) hue-rotate(0deg) drop-shadow(0 0 9px rgba(255,47,208,.95));}'
    + '33%{filter:saturate(var(--soda-fx-sat,1)) hue-rotate(120deg) drop-shadow(0 0 9px rgba(123,47,247,.95));}'
    + '66%{filter:saturate(var(--soda-fx-sat,1)) hue-rotate(240deg) drop-shadow(0 0 9px rgba(64,224,255,.95));}'
    + '100%{filter:saturate(var(--soda-fx-sat,1)) hue-rotate(360deg) drop-shadow(0 0 9px rgba(255,47,208,.95));}}'
    + '@keyframes sodaBrandLaser{from{background-position:200% 50%,0% 50%;}'
    + 'to{background-position:-200% 50%,200% 50%;}}'
    /* 往复流光：色带从渐变首端流到末端，再靠 alternate 原路流回 */
    + '@keyframes sodaBrandPingPong{from{background-position:0% 50%;}'
    + 'to{background-position:100% 50%;}}'
    + '@keyframes sodaBrandGlitch{'
    + '0%,9%,13%,44%,49%,79%,100%{transform:translate(0,0);'
    + 'filter:saturate(var(--soda-fx-sat,1)) hue-rotate(0deg) drop-shadow(0 0 5px rgba(255,0,60,.5));}'
    + '10%{transform:translate(-1px,1px);'
    + 'filter:saturate(var(--soda-fx-sat,1)) hue-rotate(120deg) brightness(1.5) drop-shadow(0 0 9px rgba(255,0,60,.95));}'
    + '11%{transform:translate(1px,-1px);'
    + 'filter:saturate(var(--soda-fx-sat,1)) hue-rotate(300deg) brightness(1.5) drop-shadow(0 0 9px rgba(0,255,240,.95));}'
    + '45%{transform:translate(1px,0);'
    + 'filter:saturate(var(--soda-fx-sat,1)) hue-rotate(190deg) drop-shadow(0 0 5px rgba(0,255,240,.6));}'
    + '46%{transform:translate(-1px,0);'
    + 'filter:saturate(var(--soda-fx-sat,1)) hue-rotate(330deg) brightness(1.5) drop-shadow(0 0 9px rgba(255,0,60,.95));}'
    + '80%{transform:translate(0,0);'
    + 'filter:saturate(var(--soda-fx-sat,1)) hue-rotate(60deg) drop-shadow(0 0 5px rgba(0,255,240,.55));}}'
    + '.soda-fx-card{margin-top:12px;padding:14px 16px;border-radius:12px;background:rgba(255,255,255,.06);}'
    + '.soda-fx-title{font-size:13px;color:rgba(255,255,255,.85);}'
    + '.soda-fx-seg{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}'
    + '.soda-fx-seg button{border:0;background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);font:inherit;'
    + 'font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;}'
    + '.soda-fx-seg button.on{background:#00cb64;color:#fff;}'
    + '.soda-fx-line{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:12px;color:rgba(255,255,255,.6);}'
    + '.soda-fx-line .lab{width:32px;flex-shrink:0;}'
    + '.soda-fx-line .val{width:42px;text-align:right;flex-shrink:0;}'
    + '.soda-fx-range{-webkit-appearance:none;appearance:none;flex:1;height:4px;border-radius:2px;'
    + 'background:rgba(255,255,255,.18);outline:none;margin:0;}'
    + '.soda-fx-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;'
    + 'background:#00cb64;cursor:pointer;}'
    + '.soda-fx-preview{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);font-size:13px;}';

  function ensureFxStyle() {
    var old = document.getElementById(FX_STYLE_ID);
    if (old && old.isConnected) {
      if (old.textContent !== FX_CSS) old.textContent = FX_CSS;   // 脚本更新后旧样式表要跟上
      return;
    }
    var s = document.createElement('style');
    s.id = FX_STYLE_ID;
    s.textContent = FX_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* 把当前模式 / 速度 / 浓度写进侧边栏名字与设置页预览的 CSS 变量 */
  function applyBrandFx() {
    if (brandFx !== 'off') ensureFxStyle();   // 重启后没有打开过设置页，样式也得自己补上
    var els = [document.querySelector('.soda-speed-brand'), document.querySelector('[data-soda-fx-preview]')];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el) continue;
      if (brandFx === 'off') {
        el.classList.remove('soda-fx');
        el.removeAttribute('data-fx');
        el.style.removeProperty('--soda-fx-dur');
        el.style.removeProperty('--soda-fx-sat');
      } else {
        el.classList.add('soda-fx');
        el.setAttribute('data-fx', brandFx);
        el.style.setProperty('--soda-fx-dur', (FX_BASE_DUR[brandFx] / fxSpeed).toFixed(2) + 's');
        el.style.setProperty('--soda-fx-sat', String(fxSat));
      }
    }
  }

  function setBrandFx(mode) {
    brandFx = normFx(mode);
    ls(CFG.fxKey, brandFx);
    if (brandFx !== 'off') ensureFxStyle();
    applyBrandFx();
  }
  function setFxSpeed(v) { fxSpeed = clamp(numOr(v, 1), 0.2, 3); ls(CFG.fxSpeedKey, String(fxSpeed)); applyBrandFx(); }
  function setFxSat(v) { fxSat = clamp(numOr(v, 1), 0, 2); ls(CFG.fxSatKey, String(fxSat)); applyBrandFx(); }

  /* ---------- 设置页里的特效卡片 ---------- */

  function buildFxRange(label, min, max, step, value, onChange, display) {
    var line = document.createElement('div');
    line.className = 'soda-fx-line';
    var lab = document.createElement('span');
    lab.className = 'lab';
    lab.textContent = label;
    var input = document.createElement('input');
    input.type = 'range';
    input.className = 'soda-fx-range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(value);
    var out = document.createElement('span');
    out.className = 'val';
    out.textContent = display(value);
    input.addEventListener('input', function () {
      var v = Number.parseFloat(input.value);
      out.textContent = display(v);
      onChange(v);
    });
    /* 鼠标停在滑块上滚轮会顺手改数值，直接吃掉 */
    input.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
    line.appendChild(lab);
    line.appendChild(input);
    line.appendChild(out);
    return line;
  }

  function buildBrandFxCard() {
    ensureFxStyle();
    var card = document.createElement('div');
    card.className = 'soda-fx-card';
    card.setAttribute('data-soda-fx-card', '1');

    var title = document.createElement('div');
    title.className = 'soda-fx-title';
    title.textContent = '品牌名特效';
    var seg = document.createElement('div');
    seg.className = 'soda-fx-seg';
    FX_LABELS.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = m[1];
      b.setAttribute('data-fx-mode', m[0]);
      if (brandFx === m[0]) b.classList.add('on');
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        setBrandFx(m[0]);
        for (var i = 0; i < seg.children.length; i++) {
          seg.children[i].classList.toggle('on', seg.children[i].getAttribute('data-fx-mode') === brandFx);
        }
      });
      seg.appendChild(b);
    });
    card.appendChild(title);
    card.appendChild(seg);

    card.appendChild(buildFxRange('速度', 0.2, 3, 0.1, fxSpeed,
      function (v) { setFxSpeed(v); },
      function (v) { return v.toFixed(1) + 'x'; }));
    card.appendChild(buildFxRange('浓度', 0, 2, 0.05, fxSat,
      function (v) { setFxSat(v); },
      function (v) { return v.toFixed(2).replace(/0$/, ''); }));

    var prev = document.createElement('div');
    prev.className = 'soda-fx-preview';
    var pv = document.createElement('span');
    pv.setAttribute('data-soda-fx-preview', '1');
    pv.textContent = CFG.brandName + CFG.brandFace;
    prev.appendChild(pv);
    card.appendChild(prev);

    applyBrandFx();   // 预览立刻跟随当前设置
    return card;
  }

  /* 与滚轮切歌行同一张卡片容器：切左侧导航会整体重建，observer 下一轮补回 */
  function injectBrandFxCard() {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box || box.querySelector('[data-soda-fx-card]')) return;
    box.appendChild(buildBrandFxCard());
  }

