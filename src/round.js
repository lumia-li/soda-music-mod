  /* ================= Win11 窗口圆角 ================= */

  /* 主窗口是 transparent + 无边框（soda-main.js 的补丁），Windows 不会给它 DWM 圆角；
     而改窗口样式（DwmSetWindowAttribute）需要原生调用，这里没有 ffi，也改不了透明窗口的形状。
     所以用 clip-path 把整页裁成圆角 —— 四角裁掉后露出桌面，观感就是 Win11 的圆角窗口。
     半径 10px（Win11 无边框窗口的观感值，比系统默认 8px 稍微明显一点）。
     铺满工作区 / 最大化 / 全屏时去掉：系统这类窗口本来就是方的，留着会从四角漏出桌面。 */
  var WIN_ROUND_CLASS = 'soda-win-round';
  var WIN_ROUND_STYLE_ID = 'soda-win-round-style';
  /* 裁两层：
     · html —— 裁 App 的所有绘制（.background 等 absolute 图层）；
     · body —— 兜底。body 是普通后代元素，裁剪一定生效（根元素 html 上的 clip-path
       对「画布背景」无效，见 clearBgCss 里黑底实底为什么要铺在 #app）；
       App 的布局全是 absolute，body 加 clip-path 不会挪动 fixed 元素。 */
  var WIN_ROUND_CSS = 'html.' + WIN_ROUND_CLASS + '{clip-path:inset(0 round 10px);}'
    + 'html.' + WIN_ROUND_CLASS + ' body{clip-path:inset(0 round 10px);}';

  function syncWinRound() {
    var root = document.documentElement;
    if (!root) return;
    if (!document.getElementById(WIN_ROUND_STYLE_ID)) {
      var head = document.head || root;
      var s = document.createElement('style');
      s.id = WIN_ROUND_STYLE_ID;
      s.textContent = WIN_ROUND_CSS;
      head.appendChild(s);
    }
    if (!window.innerWidth || !window.innerHeight) return;
    var aw = (window.screen && screen.availWidth) || 0;
    var ah = (window.screen && screen.availHeight) || 0;
    /* 尺寸贴满工作区（= 最大化）就不要圆角；多屏/DPI 下留 1px 容差 */
    var full = aw > 0 && ah > 0 && window.innerWidth >= aw - 1 && window.innerHeight >= ah - 1;
    var on = !full;
    if (root.classList.contains(WIN_ROUND_CLASS) !== on) {
      root.classList.toggle(WIN_ROUND_CLASS, on);
      logDbg('窗口圆角: ' + (on ? '10px 已生效' : '铺满工作区，已关闭'));
    }
  }

  syncWinRound();
  /* 注入时机比首帧还早，此时可能还没布局（innerWidth=0），补两次确保最终加上 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncWinRound, { once: true });
  }
  window.addEventListener('load', syncWinRound, { once: true });
  window.addEventListener('resize', syncWinRound);

