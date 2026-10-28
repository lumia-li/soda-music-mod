/* 汽水音乐桌面版 · Mod 主进程注入器
 *
 * 由 resources/app/entry.js 首行 require 加载，运行在 Electron 主进程。职责：
 *   用 webContents.debugger (CDP) 的 Page.addScriptToEvaluateOnNewDocument
 *   在每个新建文档最早期注入 soda-speed.js，让渲染层 Mod 先于页面脚本运行。
 */
const electron = require('electron');
const nodePath = require('path');
const fs = require('fs');

const LOG_FILE = nodePath.join(process.env.TEMP || '.', 'soda-mod.log');

function log(msg) {
  try { fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + msg + '\n'); } catch (e) { /* ignore */ }
}

/* ================= 主窗口透明（供「透明」使用） =================
 *
 * 主窗口是以 backgroundColor:'rgb(18, 18, 18)' 且非 transparent 创建的，
 * 而 transparent 只能在创建时指定、事后改不了，所以必须拦在创建之前。
 *
 * 上一版做法（Object.defineProperty 覆盖 electron.BrowserWindow）没生效：
 * 该属性是只读 getter，defineProperty 直接抛错、兜底赋值也静默失败，
 * 日志里从未出现过「补丁已应用」。这次改成拦截 require('electron')：
 * App 拿到的 electron 对象是一个 Proxy，取 BrowserWindow 时返回包装过的子类。
 * 只对「底色等于主窗口底色」的那一个窗口生效，其它窗口（桌面歌词、反馈…）不动。
 */
const Module = require('module');
const OriginalBrowserWindow = electron.BrowserWindow;
let mainWindowPatched = false;

/* ================= 最小化后仍能用小键盘 ←/→ 调进度 =================
 *
 * 窗口最小化 / 收进托盘以后，前台是别的程序，键盘事件根本到不了汽水的渲染层，
 * 渲染进程里的 keydown 全部失效（表现就是「最小化后就不能控制了」）。
 * 这里在主进程用 globalShortcut 兜底：
 *   只在「主窗口不可见」时注册小键盘 4 / 6，窗口恢复可见立刻注销 ——
 *   一直占着会把别处输入数字用的 4 / 6 吞掉。
 * 注意：globalShortcut 只能按物理键名钩，NumLock 关掉时小键盘 4/6 会变成方向键、
 * 这里钩不到；窗口内不受影响（渲染层按 e.code 认 Numpad4/Numpad6）。
 */
const SEEK_STEP_SEC = 5;
let seekHotkeyOn = false;
let mainWinRef = null;

function sendSeekBy(delta) {
  const wc = mainWinRef && mainWinRef.webContents;
  if (!wc || wc.isDestroyed()) return;
  try {
    wc.executeJavaScript('window.__sodaSeekBy && window.__sodaSeekBy(' + Number(delta) + ')')
      .catch(function () { /* ignore */ });
  } catch (e) { /* ignore */ }
}

function registerSeekHotkeys() {
  if (!seekHotkeyOn) return;
  const keys = [['num4', -SEEK_STEP_SEC], ['num6', SEEK_STEP_SEC]];
  let ok = 0;
  keys.forEach(function (item) {
    const key = item[0];
    const delta = item[1];
    try {
      if (electron.globalShortcut.register(key, function () { sendSeekBy(delta); })) ok++;
    } catch (e) { /* ignore */ }
  });
  log('播控键盘: 主窗口已最小化，注册小键盘 4/6（' + ok + '/2）');
}

function unregisterSeekHotkeys() {
  ['num4', 'num6'].forEach(function (key) {
    try { electron.globalShortcut.unregister(key); } catch (e) { /* ignore */ }
  });
}

function setSeekHotkeys(on) {
  if (on === seekHotkeyOn) return;
  if (on && !electron.app.isReady()) return;
  seekHotkeyOn = on;
  if (!on) { unregisterSeekHotkeys(); return; }
  registerSeekHotkeys();
}

function watchSeekHotkeys(win) {
  const sync = function () {
    let hidden = true;
    try { hidden = win.isMinimized() || !win.isVisible(); } catch (e) { hidden = false; }
    setSeekHotkeys(hidden);
  };
  ['minimize', 'restore', 'hide', 'show', 'focus', 'blur'].forEach(function (ev) {
    try { win.on(ev, sync); } catch (e) { /* ignore */ }
  });
  /* 创建瞬间窗口还没 show，isVisible() 一定是 false —— 晚一点再判定，
     免得开机就白占着小键盘 4/6 */
  setTimeout(sync, 1500);
}

class TransparentWindow extends OriginalBrowserWindow {
  constructor(options) {
    const next = Object.assign({}, options || {});
    const bg = String(next.backgroundColor || '').replace(/\s+/g, '').toLowerCase();
    const isMainWindow = !mainWindowPatched && (bg === 'rgb(18,18,18)' || bg === '#121212');

    if (isMainWindow) {
      mainWindowPatched = true;
      next.transparent = true;
      next.backgroundColor = '#00000000';
      /* 生产包一般把 webPreferences.devTools 关掉了，顺手打开，方便调试 */
      next.webPreferences = Object.assign({}, next.webPreferences || {}, { devTools: true });
    }

    super(next);

    if (isMainWindow) {
      mainWinRef = this;
      watchSeekHotkeys(this);
      log('主窗口透明: transparent=true, backgroundColor=#00000000（原底色 ' + bg + '）');
      /* Ctrl+Shift+I / F12 开关 DevTools（详情：默认 detached，不挤占窗口） */
      try {
        const wc = this.webContents;
        wc.on('before-input-event', (event, input) => {
          if (!input || input.type !== 'keyDown') return;
          const key = String(input.key || '').toLowerCase();
          const hit = (input.control && input.shift && key === 'i')
            || (input.control && input.shift && key === 'c')
            || key === 'f12';
          if (!hit) return;
          try {
            if (wc.isDevToolsOpened()) wc.closeDevTools();
            else wc.openDevTools({ mode: 'detach' });
          } catch (e) { /* ignore */ }
          event.preventDefault();
        });
      } catch (e) {
        log('DevTools 快捷键注册失败: ' + e.message);
      }
    }
  }
}

const electronProxy = new Proxy(electron, {
  get: function (target, prop, receiver) {
    if (prop === 'BrowserWindow') return TransparentWindow;
    return Reflect.get(target, prop, receiver);
  },
});

const originalLoad = Module._load;
Module._load = function () {
  const result = originalLoad.apply(this, arguments);
  return result === electron ? electronProxy : result;
};

/* ================= 载入渲染进程 Mod ================= */

const MOD_FILE = nodePath.join(__dirname, 'soda-speed.js');
let MOD_CODE = '';
try {
  MOD_CODE = 'try{\n' + fs.readFileSync(MOD_FILE, 'utf8') + '\n}catch(e){console.error("[倍速Mod]", e);}';
} catch (e) {
  log('读取 soda-speed.js 失败: ' + e.message);
}

/* ================= 任务栏播控字体：内嵌 MiSans =================
 *
 * 播控页（app://resources/taskbarWidget.asar/taskbarWidget.html）的 :root 写的是
 * font-family:MiSans,...，但那个 @font-face 只有主窗口注册过（main.asar 里的
 * registerFonts 用 resources/fonts/MiSansVF.woff2），播控窗口里根本没有，
 * 于是整条播控的文字全部回落到系统字体。
 *
 * 这里把字体读成 base64，用 data: URI 的 @font-face 直接内嵌进播控窗口 ——
 * 不依赖系统装没装 MiSans，也不依赖 resources/fonts 里那份可变字体。
 *
 * 优先用 misans.woff2（3.9MB → base64 5.2MB），没有就退回 misans.ttf（7.5MB → 10MB）。
 * 两者是同一份 MiSans Medium，woff2 只是 Brotli 压缩过的同一套字形。
 * 因为载荷不小，只对 taskbarWidget 这一个 webContents 注入，主窗口 / 歌词窗一个字节都不碰。
 */
const FONT_CANDIDATES = [
  { file: 'misans.woff2', mime: 'font/woff2', format: 'woff2' },
  { file: 'misans.ttf', mime: 'font/ttf', format: 'truetype' },
];
let FONT_SCRIPT = null;        // null = 还没构建；'' = 构建失败（回落到系统字体）

function isWidgetUrl(u) {
  return /taskbarWidget\.asar\//i.test(u) || /\/taskbarWidget\.html/i.test(u);
}

function buildFontScript() {
  if (FONT_SCRIPT !== null) return FONT_SCRIPT;
  FONT_SCRIPT = '';

  let b64 = '';
  let font = null;
  for (const c of FONT_CANDIDATES) {
    try {
      b64 = fs.readFileSync(nodePath.join(__dirname, c.file)).toString('base64');
      font = c;
      break;
    } catch (e) { /* 试下一个 */ }
  }
  if (!font) {
    log('播控字体读取失败: 找不到 misans.woff2 / misans.ttf（播控沿用系统字体）');
    return FONT_SCRIPT;
  }

  /* 整段 CSS 要塞进 JS 的单引号字符串里，所以这里只用双引号 */
  const css = '@font-face{font-family:"MiSans";'
    + 'src:url(data:' + font.mime + ';base64,' + b64 + ') format("' + font.format + '");'
    + 'font-weight:100 900;font-style:normal;font-display:swap;}'
    + 'html,body,#app,.wrapper,.container,.cover-wrapper,.main-wrapper,.side-wrapper,'
    + '.title,.title-wrapper,.lyric-wrapper,.lyric,.lyric--base,.lyric--played{'
    + 'font-family:"MiSans",-apple-system,BlinkMacSystemFont,"PingFang SC",'
    + '"Microsoft YaHei",sans-serif !important;}';

  FONT_SCRIPT = '(function(){try{'
    + 'var c=\'' + css + '\';'
    + 'var s=document.getElementById("soda-misans-font");'
    + 'if(!s){s=document.createElement("style");s.id="soda-misans-font";'
    + '(document.head||document.documentElement).appendChild(s);}'
    + 'if(s.textContent!==c)s.textContent=c;'
    + '}catch(e){console.error("[倍速Mod] 播控字体注入失败",e);}})();';

  log('播控字体: 已内嵌 ' + font.file + '（base64 '
    + (Math.round(b64.length / 1048576 * 10) / 10) + 'MB）');
  return FONT_SCRIPT;
}

/* 只往播控窗口塞字体；其余窗口直接跳过（避免几 MB 脚本到处跑） */
function injectWidgetFont(wc) {
  let u = '';
  try { u = wc.getURL() || ''; } catch (e) { return; }
  if (!isWidgetUrl(u)) return;
  const src = buildFontScript();
  if (!src) return;
  try {
    wc.executeJavaScript(src).catch(function () { /* ignore */ });
  } catch (e) { /* ignore */ }
}

function eachFrame(wc, fn) {
  let frames = [];
  try {
    frames = wc.mainFrame ? (wc.mainFrame.framesInSubtree || [wc.mainFrame]) : [];
  } catch (e) { frames = []; }
  if (!frames.length) { try { frames = [wc.mainFrame]; } catch (e) { frames = []; } }
  frames.forEach((f) => { if (f) fn(f); });
}

/* ================= 注入 ================= */

const seen = new WeakSet();

function injectWebContents(wc) {
  if (seen.has(wc)) return;
  seen.add(wc);

  // 文档创建前注入：覆盖首次加载与后续所有导航
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: MOD_CODE })
      .catch((e) => log('CDP 注入失败: ' + e.message));
  } catch (e) {
    log('debugger.attach 失败: ' + e.message);
  }

  /* 关掉后台节流：主窗口最小化 / 被别的窗口盖住时，Chromium 会把定时器
     压到 1 秒甚至 1 分钟一次，表现为「必须把汽水唤到前台，播控的配色/进度才更新」 */
  try { wc.setBackgroundThrottling(false); } catch (e) { /* ignore */ }

  // 兜底：页面加载完成后再补一次
  const late = () => {
    if (!MOD_CODE) return;
    eachFrame(wc, (f) => { f.executeJavaScript(MOD_CODE).catch(() => {}); });
  };
  wc.on('dom-ready', late);
  wc.on('did-finish-load', late);

  // 转发渲染进程里 Mod 的调试输出
  wc.on('console-message', function (event, level, message) {
    const msg = String(message || (event && event.message) || '');
    if (msg.indexOf('[倍速Mod]') >= 0) log('渲染: ' + msg);
  });

  // 任务栏播控：内嵌 MiSans（dom-ready 就注入，赶在首帧前把字体挂上）
  wc.on('dom-ready', () => injectWidgetFont(wc));

  // 任务栏播控：尺寸对齐 MusicBar（430×46），按右下角锚定，避免吸附位置跑偏
  wc.on('did-finish-load', () => { injectWidgetFont(wc); fixWidgetSize(wc); });

  /* 播控歌单面板：渲染层把 document.title 改成 SODAPANEL:down / up / off 当作信号。
     播控窗没有 preload，拿不到 IPC，用标题事件传话最省事（标题本身会被拦下不改）。 */
  wc.on('page-title-updated', function (event, title) {
    const m = /^\s*SODAPANEL:(off|up|down)\s*$/.exec(String(title || ''));
    if (!m) return;
    try { event.preventDefault(); } catch (e) { /* ignore */ }
    setWidgetPanel(m[1] === 'off' ? '' : m[1], wc);
  });
}

const WIDGET_W = 430;
const WIDGET_H = 46;
const WIDGET_PANEL_H = 360;   // 歌单面板展开时窗口额外增加的高度

/* 播控窗当前应有的高度：面板展开时连同面板一起算 */
function widgetHeightOf(win) {
  return (win && win.__sodaPanelOpen) ? WIDGET_H + WIDGET_PANEL_H : WIDGET_H;
}

/* 启动阶段（前 6 秒）把播控窗钉在「上次退出时的位置」：
 * App 会在启动后反复 setBounds 把它吸回停靠位，我们改回去 → 它再改，
 * 就成了肉眼可见的来回抢。这里直接忽略 App 在启动阶段设的坐标，
 * 我们自己的移动走 __sodaAllowResize 通道，不受影响。 */
function pinWidgetPos(win) {
  if (!win || win.__sodaPanelOpen) return null;
  if (Date.now() - widgetBootAt > 6000) return null;
  /* 离屏阴影窗不要钉：它永远该待在屏幕外，钉到播控位置会变成一块挡住点击的透明窗 */
  let cur = null;
  try { cur = win.getBounds(); } catch (e) { cur = null; }
  if (cur && cur.x <= -30000) return null;
  const pos = loadWidgetPos();
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  return { x: pos.x, y: pos.y };
}

function widgetBaseWindow() {
  let all = [];
  try { all = electron.BaseWindow.getAllWindows(); } catch (e) { return null; }
  for (const bw of all) {
    let b;
    try { b = bw.getBounds(); } catch (e) { continue; }
    if (b.x <= -30000) continue;            // 离屏阴影窗
    if (bw.__sodaIsWidget || bw.__sodaPanelOpen) return bw;
  }
  return null;
}

/* 展开 / 收起播控歌单面板。mode: 'down' | 'up' | ''（收起）
 * up 模式下窗口整体上移、底边不动，播控条因此仍停在原来的屏幕位置。
 *
 * 注意：光改窗口尺寸是不够的 —— 播控页面挂在 BaseWindow 里的 WebContentsView 上，
 * 内层视图不跟着放大，页面视口就还是 430x46（面板高度算出来是 0，什么都不显示）。
 * 所以这里把「窗口 + contentView + 真正承载 wc 的那个 view」一起改。 */
function setWidgetPanel(mode, wc) {
  let host = null;
  try { host = wc ? findWidgetHost(wc) : null; } catch (e) { host = null; }

  const bw = (host && host.win) || widgetBaseWindow();
  if (!bw) { log('播控面板: 没找到播控窗'); return; }

  const view = (host && host.view) || null;
  const cv = bw.contentView || null;

  let b = null;
  try { b = bw.getBounds(); } catch (e) { return; }
  if (!b) return;

  const applyBounds = function (x, y, h) {
    bw.__sodaAllowResize = true;
    if (cv) cv.__sodaAllowResize = true;
    if (view) view.__sodaAllowResize = true;
    try { bw.setBounds({ x: x, y: y, width: WIDGET_W, height: h }); } catch (e) { /* ignore */ }
    try { if (cv && typeof cv.setBounds === 'function') cv.setBounds({ x: 0, y: 0, width: WIDGET_W, height: h }); } catch (e) { /* ignore */ }
    try {
      if (view && view !== cv && typeof view.setBounds === 'function') {
        view.setBounds({ x: 0, y: 0, width: WIDGET_W, height: h });
      }
    } catch (e) { /* ignore */ }
    bw.__sodaAllowResize = false;
    if (cv) cv.__sodaAllowResize = false;
    if (view) view.__sodaAllowResize = false;
  };

  if (!mode) {
    const base = bw.__sodaPanelBase || { x: b.x, y: b.y };
    bw.__sodaPanelOpen = false;
    applyBounds(base.x, base.y, WIDGET_H);
    bw.__sodaPos = base.x + ',' + base.y;
    log('播控面板: 已收起');
    return;
  }

  const fullH = WIDGET_H + WIDGET_PANEL_H;

  /* 已经展开：只处理「展开方向」的变化 */
  if (bw.__sodaPanelOpen || b.height >= fullH - 20) {
    bw.__sodaPanelOpen = true;
    const base0 = bw.__sodaPanelBase
      || { x: b.x, y: mode === 'up' ? b.y + WIDGET_PANEL_H : b.y };
    bw.__sodaPanelBase = base0;
    const y0 = mode === 'up' ? base0.y - WIDGET_PANEL_H : base0.y;
    if ((mode === 'up') !== (b.y < base0.y)) {
      applyBounds(base0.x, y0, fullH);
      bw.__sodaPos = base0.x + ',' + y0;
    } else if (Math.abs(b.height - fullH) > 2) {
      applyBounds(base0.x, y0, fullH);      // 高度不对就补一次
    }
    return;
  }

  const base = { x: b.x, y: b.y };
  const y = mode === 'up' ? base.y - WIDGET_PANEL_H : base.y;

  bw.__sodaPanelBase = base;
  bw.__sodaPanelOpen = true;
  applyBounds(base.x, y, fullH);
  bw.__sodaPos = base.x + ',' + y;

  let vb = null;
  try { vb = view && typeof view.getBounds === 'function' ? view.getBounds() : null; } catch (e) { vb = null; }
  log('播控面板: 已展开（' + mode + '）' + WIDGET_W + 'x' + fullH + ' @' + base.x + ',' + y
    + ' 视图=' + (vb ? (vb.width + 'x' + vb.height) : '无'));
}

/* ================= 任务栏播控：屏蔽 App 的 move 监听 =================
 *
 * App 会把播控条吸回停靠位，靠的就是监听窗口 move：我们一改位置它立刻纠正，
 * 结果就是「恢复 3 次、3 次都被吸回」。
 * 这里在 BaseWindow 的事件注册处过滤掉「小窗」的 move / moved 监听，
 * 让它收不到位移通知，也就不会再触发吸附。
 */
function patchWidgetMoveEvent() {
  const BW = electron.BaseWindow;
  if (!BW || !BW.prototype) return;

  const isSmallWindow = (w) => {
    try {
      const b = w.getBounds();
      if (!b) return false;
      return b.width >= 300 && b.width <= 520 && b.height >= 32 && b.height <= 90;
    } catch (e) { return false; }
  };

  ['on', 'addListener', 'once'].forEach((name) => {
    const orig = BW.prototype[name];
    if (typeof orig !== 'function') return;
    BW.prototype[name] = function (ev) {
      try {
        if ((ev === 'move' || ev === 'moved') && isSmallWindow(this)) {
          return this;            // 静默忽略：不注册这个监听
        }
      } catch (e) { /* ignore */ }
      return orig.apply(this, arguments);
    };
  });
  log('任务栏播控: 已屏蔽小窗的 move 监听（防止被吸回停靠位）');
}

patchWidgetMoveEvent();

/* ================= 任务栏播控：锁死尺寸 =================
 *
 * 光靠「事后改回来」永远会跳：主进程在拖动/吸附时会不停 setBounds，
 * 我们改回去 → 它再改 → 视觉上就是一直抖动。
 * 这里直接改写 BaseWindow 的尺寸设置方法：窗口一旦被标记为播控窗，
 * 无论主进程传什么宽高，实际生效的都是 430×46（x/y 保留，拖动与吸附照常）。
 */
function patchBaseWindowSetters() {
  const BW = electron.BaseWindow;
  if (!BW || !BW.prototype) return;
  ['setBounds', 'setContentBounds', 'setSize', 'setContentSize'].forEach((name) => {
    const orig = BW.prototype[name];
    if (typeof orig !== 'function') return;
    BW.prototype[name] = function () {
      try {
        /* __sodaAllowResize 只在我们自己展开/收起面板时置位，避免被这条锁改写 */
        if (this.__sodaIsWidget && !this.__sodaAllowResize) {
          const args = Array.prototype.slice.call(arguments);
          const h = widgetHeightOf(this);
          if (name === 'setSize' || name === 'setContentSize') {
            return orig.call(this, WIDGET_W, h);
          }
          const b = Object.assign({}, args[0] || {});
          b.width = WIDGET_W;
          b.height = h;
          const pin = pinWidgetPos(this);
          if (pin) { b.x = pin.x; b.y = pin.y; }
          return orig.call(this, b, args[1]);
        }
      } catch (e) { /* ignore */ }
      return orig.apply(this, arguments);
    };
  });
  /* setPosition 单独处理：启动阶段同样钉住坐标 */
  if (typeof BW.prototype.setPosition === 'function') {
    const origSetPos = BW.prototype.setPosition;
    BW.prototype.setPosition = function (x, y) {
      try {
        if (this.__sodaIsWidget && !this.__sodaAllowResize) {
          const pin = pinWidgetPos(this);
          if (pin) return origSetPos.call(this, pin.x, pin.y);
        }
      } catch (e) { /* ignore */ }
      return origSetPos.apply(this, arguments);
    };
  }
  /* 视图层也要锁：主进程可能单独给 WebContentsView / contentView 设尺寸 */
  const V = electron.View;
  if (V && V.prototype && typeof V.prototype.setBounds === 'function') {
    const origView = V.prototype.setBounds;
    V.prototype.setBounds = function () {
      try {
        if (this.__sodaIsWidget && !this.__sodaAllowResize) {
          const b = Object.assign({}, arguments[0] || {});
          b.width = WIDGET_W;
          b.height = widgetHeightOf(this);
          return origView.call(this, b, arguments[1]);
        }
      } catch (e) { /* ignore */ }
      return origView.apply(this, arguments);
    };
  }
  log('任务栏播控: 尺寸锁已启用（430x46）');
}

patchBaseWindowSetters();

/* 找承载该 webContents 的窗口：优先 BrowserWindow；
   找不到就遍历 BaseWindow 的视图树（Electron 30+ 的 BaseWindow + WebContentsView 架构）。 */
function findWidgetHost(wc) {
  try {
    const win = electron.BrowserWindow.getAllWindows().find((w) => {
      try { return w.webContents === wc; } catch (e) { return false; }
    });
    if (win) return { win, view: null };
  } catch (e) { /* ignore */ }

  let all = [];
  try {
    if (electron.BaseWindow && typeof electron.BaseWindow.getAllWindows === 'function') {
      all = electron.BaseWindow.getAllWindows();
    }
  } catch (e) { all = []; }

  /* 用 id 比较：拿到的 wc 可能是包装过的对象，=== 不一定成立 */
  let targetId = -1;
  try { targetId = wc.id; } catch (e) { targetId = -1; }

  for (const bw of all) {
    let hitView = null;
    const walk = (v) => {
      if (!v || hitView) return;
      try {
        if (v.webContents && v.webContents.id === targetId) { hitView = v; return; }
      } catch (e) { /* ignore */ }
      let kids = [];
      try { kids = v.children || []; } catch (e) { kids = []; }
      for (const k of kids) walk(k);
    };
    try { walk(bw.contentView); } catch (e) { /* ignore */ }
    if (hitView) return { win: bw, view: hitView };
  }
  return null;
}

/* 找不到时把窗口树打出来（一次性），方便看清内容到底挂在哪个 view 上 */
function dumpWindowTree() {
  const lines = [];
  try {
    const all = electron.BaseWindow.getAllWindows();
    lines.push('BaseWindow=' + all.length);
    all.forEach((bw, i) => {
      let b = null;
      try { b = bw.getBounds(); } catch (e) { b = null; }
      lines.push('[' + i + '] ' + (b ? (b.width + 'x' + b.height + '@' + b.x + ',' + b.y) : 'bounds?'));
      const walk = (v, d) => {
        if (!v || d > 4) return;
        let name = 'view';
        try { name = (v.constructor && v.constructor.name) || 'view'; } catch (e) { name = 'view'; }
        let extra = '';
        try {
          if (v.webContents) extra = ' wc#' + v.webContents.id + ' ' + String(v.webContents.getURL() || '').slice(0, 40);
        } catch (e) { extra = ''; }
        lines.push('  '.repeat(d) + name + extra);
        let kids = [];
        try { kids = v.children || []; } catch (e) { kids = []; }
        for (const k of kids) walk(k, d + 1);
      };
      try { walk(bw.contentView, 1); } catch (e) { lines.push('  contentView 读取失败'); }
    });
  } catch (e) {
    lines.push('遍历失败: ' + e.message);
  }
  log('窗口树:\n' + lines.join('\n'));
}

/* 任务栏播控窗口（实测）：
   BaseWindow 388×40，contentView 是普通 View、children 为空 —— 按 webContents 反查窗口查不到。
   所以直接按「小窗尺寸」定位：宽 300~520、高 32~90 的都当成播控窗（主窗口 1327×785 不会误伤），
   窗口和 contentView 一起改，按右下角锚定，避免吸附位置跑偏。 */
function fixWidgetSize(wc) {
  let url = '';
  try { url = wc.getURL() || ''; } catch (e) { return; }
  if (!/taskbarWidget/i.test(url)) return;

  let applied = false;
  const apply = () => {
    /* 正在拖动：绝对不要动位置/尺寸，否则窗口会被拽回原位（表现就是拖不动） */
    if (Date.now() < widgetBusyUntil) return;
    let all = [];
    try { all = electron.BaseWindow.getAllWindows(); } catch (e) { return; }
    for (const bw of all) {
      let b = null;
      try { b = bw.getBounds(); } catch (e) { continue; }
      if (b.width < 300 || b.width > 520 || b.height < 32 || b.height > 90) continue;
      /* 停在 -32000 的离屏窗口是「阴影窗」，跟播控条叠在一起提供阴影；
         它和播控条尺寸不一致时，右侧会露出一块带圆角的白底，直接关掉。 */
      if (b.x <= -30000) {
        try { if (typeof bw.setOpacity === 'function') bw.setOpacity(0); } catch (e) { /* ignore */ }
        try { bw.__sodaIsWidget = true; } catch (e) { /* ignore */ }
        continue;
      }
      /* 标记：之后主进程无论怎么设尺寸，都会被改写回 430×46 */
      try { bw.__sodaIsWidget = true; } catch (e) { /* ignore */ }
      /* 系统绘制的窗口阴影会在窗口边缘留一圈/一条硬边，播控条自己有阴影窗，这里关掉 */
      try { if (typeof bw.setHasShadow === 'function') bw.setHasShadow(false); } catch (e) { /* ignore */ }
      try { if (bw.contentView) bw.contentView.__sodaIsWidget = true; } catch (e) { /* ignore */ }
      if (b.width === WIDGET_W && b.height === WIDGET_H) { applied = true; continue; }
      try {
        /* 只改宽高、不动位置：用户拖到哪就在哪，不做任何锚定/边界限制 */
        /* 只改宽高；但如果变宽后右边缘会超出屏幕，就整体左移把右边缘收回来。
           否则 App 的可见性守护会认为窗口越界，启动时把它吸回任务栏右侧。 */
        let nx = b.x;
        try {
          const sb = electron.screen.getDisplayMatching(b).bounds;
          if (nx + WIDGET_W > sb.x + sb.width) nx = sb.x + sb.width - WIDGET_W;
          if (nx < sb.x) nx = sb.x;
        } catch (e) { /* ignore */ }
        bw.setBounds({ x: nx, y: b.y, width: WIDGET_W, height: WIDGET_H });
        bw.__sodaPos = nx + ',' + b.y;   // 记下自己的改动，避免被当成用户拖动
        const cv = bw.contentView;
        if (cv && typeof cv.setBounds === 'function') {
          cv.setBounds({ x: 0, y: 0, width: WIDGET_W, height: WIDGET_H });
        }
        /* 有些架构下窗口改了、内容视口没跟着变（页面仍是 388 宽，右侧露出窗口底色），
           这里再显式设一次内容尺寸 */
        try { if (typeof bw.setContentSize === 'function') bw.setContentSize(WIDGET_W, WIDGET_H); } catch (e) { /* ignore */ }
        applied = true;
        let iw = -1;
        try { iw = Math.round(bw.getContentSize()[0]); } catch (e) { iw = -1; }
        log('任务栏播控尺寸: ' + b.width + 'x' + b.height + ' -> ' + WIDGET_W + 'x' + WIDGET_H + '（内容宽 ' + iw + '）');
      } catch (e) {
        log('任务栏播控尺寸设置失败: ' + e.message);
      }
    }
    if (!applied) log('任务栏播控尺寸: 未发现小窗（BaseWindow=' + all.length + '）');
  };

  apply();
  setTimeout(apply, 300);
  setTimeout(apply, 1200);
  setTimeout(apply, 2500);
  startWidgetGuard();
}

/* 主进程会在吸附 / 显示 / 悬停时自己 setBounds，一次性改完会被打回原状，
   表现为「有时候 430 有时候 388」。这里常驻守护：发现小窗尺寸不对就按右下角锚回去。 */
let widgetGuardTimer = 0;
let widgetBusyUntil = 0;   // 拖动 / 主进程正在改尺寸时，守护先让路

/* ---------- 记住播控条最后的位置 ----------
 * App 自己保存的是「停靠档位」，自由拖动的位置它记不住，启动后总会吸回任务栏右侧。
 * 这里在本地存一份坐标，启动后几秒内反复校正（App 恢复完位置会覆盖一次），
 * 之后由用户拖动决定，每 3 秒落盘。
 */
let widgetSavedPos = null;
let widgetRestoreTries = 0;
let widgetFile = '';

function widgetPosFile() {
  if (widgetFile) return widgetFile;
  let base = '';
  try { base = electron.app.getPath('userData') || ''; } catch (e) { base = ''; }
  if (!base) base = process.env.TEMP || '.';
  widgetFile = nodePath.join(base, 'soda-widget-pos.json');
  return widgetFile;
}

function loadWidgetPos() {
  if (widgetSavedPos !== null) return widgetSavedPos;
  try {
    const o = JSON.parse(fs.readFileSync(widgetPosFile(), 'utf8'));
    if (o && typeof o.x === 'number' && typeof o.y === 'number') {
      widgetSavedPos = { x: o.x, y: o.y };
      return widgetSavedPos;
    }
  } catch (e) { /* 没有记录 */ }
  widgetSavedPos = false;   // 用 false 表示「确认没有」避免反复读盘
  return null;
}

function saveWidgetPos(bw) {
  try {
    const b = bw.getBounds();
    if (b.x <= -30000) return;
    if (b.width < 300 || b.width > 520 || b.height < 32 || b.height > 90) return;
    const cur = loadWidgetPos();
    if (cur && cur.x === b.x && cur.y === b.y) return;
    widgetSavedPos = { x: b.x, y: b.y };
    fs.writeFileSync(widgetPosFile(), JSON.stringify(widgetSavedPos));
  } catch (e) { /* ignore */ }
}

function findWidgetWindow() {
  let all = [];
  try { all = electron.BaseWindow.getAllWindows(); } catch (e) { return null; }
  for (const bw of all) {
    let b = null;
    try { b = bw.getBounds(); } catch (e) { continue; }
    if (b.x <= -30000) continue;
    if (b.width < 300 || b.width > 520 || b.height < 32 || b.height > 90) continue;
    return bw;
  }
  return null;
}

/* App 启动后会在几秒内反复把窗口吸到停靠位，所以恢复不能只做一次：
   启动后 15 秒内，每 1.5 秒纠正一次（间隔大一点，避免肉眼可见的来回闪）。 */
let widgetBootAt = Date.now();
let widgetRestoreAt = 0;
let widgetBootHid = false;   // 启动阶段是否已经先把播控条透明掉
let widgetLastSeen = '';     // 上一次观察到的位置（连续两次相同才认为稳定）

/* 目前关闭：App 会监听窗口移动并在偏离停靠位时反复吸回，
   外部改位置一定会和它打架（表现就是闪烁争抢）。等找到它的停靠配置再打开。 */
let widgetPosRestoreEnabled = true;

function restoreWidgetPos(bw) {
  if (!widgetPosRestoreEnabled) { widgetRestoreTries = 99; return; }

  /* 启动阶段窗口是透明的（见 watchWidgetActivity），所以可以早点、密集点纠正：
     0.6 秒后开始、每 0.6 秒一次、最多 5 次，全部在「还没显示出来」时完成，
     用户就看不到位置跳动了。 */
  if (Date.now() - widgetBootAt < 600) return;
  if (widgetRestoreTries >= 5) return;
  if (Date.now() - widgetRestoreAt < 600) return;
  widgetRestoreAt = Date.now();

  const pos = loadWidgetPos();
  if (!pos) { widgetRestoreTries = 99; return; }

  let b = null;
  try { b = bw.getBounds(); } catch (e) { return; }
  if (b.x === pos.x && b.y === pos.y) { widgetRestoreTries = 99; return; }

  widgetRestoreTries++;
  try {
    bw.setBounds({ x: pos.x, y: pos.y, width: WIDGET_W, height: WIDGET_H });
    bw.__sodaPos = pos.x + ',' + pos.y;
    log('任务栏播控: 恢复上次位置 ' + pos.x + ',' + pos.y + '（第 ' + widgetRestoreTries + ' 次）');
  } catch (e) { /* ignore */ }
}

/* 窗口自己在移动/改尺寸时（用户拖动、主进程吸附）让守护先让路，别去纠正它 */
function watchWidgetActivity(bw) {
  if (!bw || bw.__sodaWatch) return;
  try { bw.__sodaWatch = true; } catch (e) { return; }
  const bump = () => { widgetBusyUntil = Date.now() + 1000; };
  try { bw.on('move', bump); } catch (e) { /* ignore */ }
  try { bw.on('resize', bump); } catch (e) { /* ignore */ }

  /* 启动阶段 App 会先把它摆到停靠位，我们随后再挪回上次的位置，肉眼就是「跳一下」。
     这里在最开始的几秒先把窗口透明掉，等位置落定再显示出来。 */
  if (!widgetBootHid && Date.now() - widgetBootAt < 8000) {
    widgetBootHid = true;
    try { if (typeof bw.setOpacity === 'function') bw.setOpacity(0); } catch (e) { /* ignore */ }
    setTimeout(function () {
      try { if (typeof bw.setOpacity === 'function') bw.setOpacity(1); } catch (e) { /* ignore */ }
    }, 3200);
  }
}

function startWidgetGuard() {
  if (widgetGuardTimer) return;

  /* 启动几秒后开始定期保存位置（恢复阶段不存，免得把临时位置写进去） */
  setInterval(() => {
    if (Date.now() - widgetBootAt < 6000) return;   // 启动阶段不存，免得把 App 摆的临时位置写进去
    const bw = findWidgetWindow();
    if (!bw) return;
    let b = null;
    try { b = bw.getBounds(); } catch (e) { return; }
    /* 位置连续 3 秒没动才落盘：防止 App 吸附过程中的中间位置被存下来 */
    const key = b.x + ',' + b.y;
    if (key !== widgetLastSeen) { widgetLastSeen = key; return; }
    saveWidgetPos(bw);
  }, 3000);

  widgetGuardTimer = setInterval(() => {
    let all = [];
    try { all = electron.BaseWindow.getAllWindows(); } catch (e) { return; }
    for (const bw of all) {
      let b = null;
      try { b = bw.getBounds(); } catch (e) { continue; }
      if (b.width < 300 || b.width > 520 || b.height < 32 || b.height > 90) continue;
      /* 离屏阴影窗：关掉可见性就行，不要去改它的尺寸/位置（也不参与启动隐藏） */
      if (b.x <= -30000) {
        try { if (typeof bw.setOpacity === 'function') bw.setOpacity(0); } catch (e) { /* ignore */ }
        continue;
      }
      watchWidgetActivity(bw);

      /* 启动阶段：把窗口挪回上次退出时的位置（App 会先按自己的停靠逻辑摆一次，所以要多试几次） */
      restoreWidgetPos(bw);

      /* 用「位置变了」来判断是不是用户正在拖：
         BaseWindow 不一定有 move 事件，只靠事件监听会漏，结果就是拖动时被拽回去。 */
      const posKey = b.x + ',' + b.y;
      if (bw.__sodaPos && bw.__sodaPos !== posKey) {
        widgetBusyUntil = Date.now() + 1000;
      }
      bw.__sodaPos = posKey;
      if (Date.now() < widgetBusyUntil) continue;

      if (b.width === WIDGET_W && b.height === WIDGET_H) continue;
      try {
        /* 位置完全交给用户：只改宽高，x/y 原样保留，不锚定、不 clamp。
           想拖到哪就拖到哪，只有尺寸是我们的。 */
        let nx2 = b.x;
        try {
          const sb2 = electron.screen.getDisplayMatching(b).bounds;
          if (nx2 + WIDGET_W > sb2.x + sb2.width) nx2 = sb2.x + sb2.width - WIDGET_W;
          if (nx2 < sb2.x) nx2 = sb2.x;
        } catch (e) { /* ignore */ }
        bw.setBounds({ x: nx2, y: b.y, width: WIDGET_W, height: WIDGET_H });
        bw.__sodaPos = nx2 + ',' + b.y;
        const cv = bw.contentView;
        if (cv && typeof cv.setBounds === 'function') {
          cv.setBounds({ x: 0, y: 0, width: WIDGET_W, height: WIDGET_H });
        }
      } catch (e) { /* ignore */ }
    }
  }, 300);
}

electron.app.on('web-contents-created', (event, wc) => injectWebContents(wc));

electron.app.on('will-quit', function () { setSeekHotkeys(false); });

electron.app.whenReady().then(() => {
  electron.webContents.getAllWebContents().forEach(injectWebContents);
  log('=== Mod 注入器就绪 ===');
});