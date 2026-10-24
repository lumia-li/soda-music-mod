/* 汽水音乐桌面版 · 播放倍速 Mod（渲染进程侧本体）
 *
 * 由 soda-main.js 读取内容后注入到每个新建文档。
 *
 * 交互:
 *   入口   —— 歌曲菜单（列表行三点按钮、底部播放条「更多」）末尾追加「播放倍速」
 *   控制条 —— 点「播放倍速」后，于播放条上方弹出；可拖动滑块、点击刻度调节
 *   快捷键 —— Alt+Up|Down ±0.05   Alt+Left|Right ±0.25
 *             Alt+0 复位 1x      Alt+M 停用/启用
 *
 * 控制台 API: __sodaSpeedMod.rate / .suspend(bool) / .probe()
 */
(function () {
  'use strict';
  if (window.__sodaSpeedMod) return;

  /* 脚本内部任何未捕获异常都写进 %TEMP%\soda-mod.log，方便定位「某功能没反应」 */
  window.addEventListener('error', function (e) {
    try {
      console.log('[倍速Mod] 脚本异常: ' + ((e && e.message) || e) +
        ' @' + ((e && e.filename) || '') + ':' + ((e && e.lineno) || 0));
    } catch (err) { /* ignore */ }
  });

  /* ================= 任务栏快捷播控：整窗可拖 ================= */

  /* 该窗口（app://resources/taskbarWidget.asar/taskbarWidget.html）原生只在面板左侧
     22px 的细条上给了 -webkit-app-region: drag，平时还是 opacity:0，很难按到。
     这里把 drag 扩到整块面板，再把可交互元素标回 no-drag，否则按钮会被拖拽区域吞掉。
     注意：拖动是窗口级的真实移动（系统移窗），主进程的 dock/free 状态机正是靠这个
     驱动的，所以这里只改命中区域，绝不自己去 setBounds 搬窗口。 */
  function enableWidgetDragRegion() {
    var CSS =
      '.wrapper{-webkit-app-region:drag!important;}'
      + '.cover-wrapper,.cover-wrapper *'
      + ',.action-wrapper,.action-wrapper *'
      + ',.side-wrapper,.side-wrapper *'
      + ',.close-wrapper,.close-wrapper *'
      + ',.vip-badge,.vip-badge *{-webkit-app-region:no-drag!important;}';

    function apply() {
      var head = document.head || document.documentElement;
      if (!head) return false;
      if (document.getElementById('soda-widget-drag-region')) return true;
      var style = document.createElement('style');
      style.id = 'soda-widget-drag-region';
      style.textContent = CSS;
      head.appendChild(style);
      try { console.log('[倍速Mod] 任务栏快捷播控：整窗可拖已生效'); } catch (e) { /* ignore */ }
      return true;
    }

    if (!apply()) {
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    }
  }

  /* 任务栏小组件窗口：只做上面这一件事，其余 Mod 逻辑全部跳过
     （主窗口的倍速/频谱/品牌名等在这里既没有目标元素也没有意义）。
     影子窗口是同一功能的 1x1 离屏窗，什么都不用做。 */
  var pagePath = location.pathname || '';
  var isWidgetPage = /^\/taskbarWidget\.asar\//.test(pagePath) || /\/taskbarWidget\.html$/.test(pagePath);
  var isWidgetShadowPage = /^\/taskbarWidgetShadow\.asar\//.test(pagePath)
    || /\/taskbarWidgetShadow\.html$/.test(pagePath);

  /* 任务栏播控的「MusicBar」外观：只换样式，不动它的逻辑与数据。
     原生结构：.wrapper > .container >（拖拽条 / .cover / .main-wrapper（.info-wrapper + .action-wrapper）/ .side-wrapper）
     尺寸 / 颜色 / 圆角全部取自 MainWindow.xaml：
       窗口 430×46、CornerRadius 12、1px #66FFFFFF 高光边；
       封面 30 圆角 6；歌名 12 SemiBold #FDF5F5；歌词 10.5；
       按钮 28×28 圆角 14、hover #22FFFFFF；播放键同样无底色；关闭 ✕ 用 #FF5A5F。 */
  var WIDGET_STYLE_KEY = 'sodaSpeedMod.widgetStyle';
  var WIDGET_DATA_KEY = 'sodaSpeedMod.widgetData';
  var WIDGET_MBAR_CLASS = 'soda-widget-mbar';

  var WIDGET_MBAR_CSS = ''
    /* 窗口/页面本身全部透明，卡片圆角外不该露出任何底色 */
    + 'html.' + WIDGET_MBAR_CLASS + ',html.' + WIDGET_MBAR_CLASS + ' body,'
    + 'html.' + WIDGET_MBAR_CLASS + ' #app,html.' + WIDGET_MBAR_CLASS + ' .wrapper{'
    + 'background:transparent !important;}'
    /* 底色是封面主色的渐变（由主窗口取色后通过 localStorage 传过来，见 --mb-c0/--mb-c1），
       取不到色时退回一套青绿→深蓝的固定值 */
    /* 圆角保留；多余的是阴影 —— 窗口不透明时外阴影会在边缘糊出一圈亮边，直接去掉 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .container{'
    + 'border-radius:12px !important;border:0 !important;outline:none !important;'
    + 'background:linear-gradient(118deg,var(--mb-c0,#3a7f74) 0%,var(--mb-c1,#255a63) 46%,'
    + '#1b3040 78%,#151d28 100%) !important;'
    + 'box-shadow:none !important;filter:none !important;'
    + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;'
    + 'width:100% !important;height:100% !important;margin:0 !important;'
    + 'padding:5px 0 5px 18px !important;}'
    /* 左侧那条竖线拖拽手柄去掉（整窗本来就是 -webkit-app-region:drag，照样能拖） */
    + 'html.' + WIDGET_MBAR_CLASS + ' .drag-handler-wrapper{display:none !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .wrapper[data-hover] .container{filter:brightness(1.12);}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .cover{width:30px !important;height:30px !important;'
    + 'border-radius:6px !important;}'
    /* 信息区改成弹性：原来固定 132px，长歌名会把右边按钮挤成一团 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .main-wrapper{flex:1 1 auto !important;min-width:0 !important;'
    + 'margin-left:6px !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .info-wrapper{width:auto !important;flex:1 1 auto !important;'
    + 'min-width:0 !important;max-width:190px !important;max-height:30px !important;'
    + 'justify-content:center !important;gap:1px !important;}'
    /* 歌名跑马灯（照 MusicBar 的 MarqueeTextBlock：双份文本 + 30px Gap + 40px/s 匀速）。
       第一份是原生文本，第二份由 ::after 用 data-mb 复制出来；溢出时整条轨道向左平移，
       平移量 = 文本宽 + Gap，正好让第二份接上第一份的起点。 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .title-wrapper{min-width:0 !important;gap:4px !important;'
    + 'overflow:hidden !important;}'
    /* 左右渐隐只在滚动时加；静态显示必须置空，否则开头几个字会被遮罩吃掉一半 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .title-wrapper.soda-mb-scroll{'
    + '-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 6%,#000 92%,transparent 100%);'
    + 'mask-image:linear-gradient(90deg,transparent 0,#000 6%,#000 92%,transparent 100%);}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .title{font-size:12px !important;font-weight:600 !important;'
    + 'line-height:15px !important;color:#FDF5F5 !important;'
    + 'display:inline-block !important;width:max-content !important;max-width:none !important;'
    + 'flex:none !important;min-width:0 !important;'
    + 'overflow:visible !important;text-overflow:clip !important;white-space:nowrap !important;'
    /* 歌名这一列保持可拖：设成 no-drag 才能收到 hover/双击，但那会让整片文字区拖不动，
       权衡下来拖拽优先（拖拽区一断就很难挪动窗口）。 */
    + 'will-change:transform;}'
    /* 第二份只在真正滚动时出现，静态时藏起来，避免看到「两个歌名」 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .title:after{content:attr(data-mb);margin-left:30px;'
    + 'opacity:0;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .title[data-scroll="1"]:after{opacity:1;}'
    /* 鼠标移到歌名上就停住，方便看清完整标题 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .title-wrapper:hover .title{animation-play-state:paused !important;}'
    + '@keyframes soda-mb-marquee{from{transform:translateX(0);}to{transform:translateX(var(--mb-shift,0));}}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .lyric-wrapper{font-size:10.5px !important;'
    + 'line-height:13px !important;height:13px !important;font-weight:400 !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .lyric--base{color:rgba(255,255,255,.5) !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .lyric--played{color:#ECFFF3F3 !important;}'
    /* 按钮组：XAML 是 28×28，实际看下来偏小，按 32×32 / 图标 16 放大一档（间距仍 4） */
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-wrapper{gap:4px !important;margin-left:auto !important;'
    + 'margin-right:0 !important;padding-left:6px !important;padding-right:0 !important;'
    + 'flex-shrink:0 !important;align-items:center !important;justify-content:flex-end !important;}'
    /* .side-wrapper 里放的就是收藏（心形）按钮，不能隐藏；这里把它和播控按钮组的高度对齐，
       否则心形会比上一首/下一首高一截（容器默认 stretch，两边撑开的高度不一致） */
    + 'html.' + WIDGET_MBAR_CLASS + ' .container{align-items:center !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .side-wrapper{display:flex !important;height:32px !important;'
    + 'align-items:center !important;justify-content:center !important;'
    + 'padding-left:2px !important;padding-right:0 !important;flex-shrink:0 !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-wrapper{height:32px !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-button{width:32px !important;height:32px !important;'
    + 'min-width:32px !important;flex:0 0 32px !important;margin:0 !important;'
    + 'border-radius:16px !important;color:#FDF5F5 !important;background:transparent !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-button:hover{background:rgba(255,255,255,.13) !important;'
    + 'color:#fff !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-button svg{width:16px !important;height:16px !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-button--playback{width:32px !important;min-width:32px !important;'
    + 'flex:0 0 32px !important;background:transparent !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-button--playback svg{width:16px !important;height:16px !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .collect-button{width:32px !important;height:32px !important;'
    + 'min-width:32px !important;flex:0 0 32px !important;margin:0 !important;'
    + 'display:flex !important;align-items:center !important;justify-content:center !important;'
    + 'border-radius:16px !important;color:#FDF5F5 !important;background:transparent !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .collect-button:hover{background:rgba(255,255,255,.13) !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .collect-button svg{width:16px !important;height:16px !important;}'
    /* 上一首/下一首用 MusicBar 图标（覆盖层），原生 svg 隐藏 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-button[data-soda-mb]{position:relative !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-button[data-soda-mb] > svg{display:none !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-icon{display:flex;align-items:center;justify-content:center;'
    + 'position:absolute;inset:0;pointer-events:none;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-icon svg{width:16px !important;height:16px !important;'
    + 'fill:currentColor;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .action-button--playback .soda-mb-icon svg{'
    + 'width:16px !important;height:16px !important;}'
    /* 心形左侧的播放模式按钮 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-mode,'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-dislike{width:32px !important;height:32px !important;'
    + 'min-width:32px !important;flex:0 0 32px !important;margin:0 !important;padding:0 !important;'
    + 'border:0 !important;display:flex !important;align-items:center !important;justify-content:center !important;'
    + 'background:transparent !important;color:#FDF5F5 !important;border-radius:16px !important;cursor:pointer !important;'
    + '-webkit-app-region:no-drag !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-mode:hover,'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-dislike:hover{background:rgba(255,255,255,.13) !important;'
    + 'color:#fff !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-mode svg,'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-dislike svg{width:16px !important;height:16px !important;'
    + 'fill:currentColor !important;stroke:none !important;}'
    /* 右上角的关闭 ✕ 去掉 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .close-wrapper{display:none !important;}'
    /* 歌名后面的 VIP / SVIP 角标去掉 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .vip-badge{display:none !important;}'
    /* 底部进度：数据由主窗口写进 localStorage；条本身可点，点击即 seek */
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-progress{position:absolute;left:9px;right:9px;'
    + 'bottom:0;height:10px;display:flex;align-items:center;z-index:4;'
    + 'pointer-events:auto !important;cursor:pointer;'
    /* 整窗是拖拽区（-webkit-app-region: drag），不加这行点击会被当成拖窗口 */
    + '-webkit-app-region:no-drag !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-progress:before{content:"";position:absolute;'
    + 'left:0;right:0;top:50%;margin-top:-1px;height:2px;border-radius:1px;'
    + 'background:rgba(58,58,61,.72);}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-progress i{position:relative;display:block;'
    + 'height:2px;width:0;border-radius:1px;background:#E8E8EA;transition:width .25s linear;}'
    /* 高潮点：位置取自 App 原生进度条上的 .slider-dot（主窗口读出来推过来） */
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-progress .soda-mb-hot{position:absolute;top:50%;'
    + 'left:0;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;'
    + 'background:rgba(255,255,255,.75);box-shadow:none;'
    + 'pointer-events:none;display:none;z-index:2;}'
    /* 顶部频谱（MusicBar 的 MainSpectrumBars）：26 根条形、居中、14px 高 */
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-vis{position:absolute;left:50%;top:0;'
    + 'transform:translateX(-50%);width:100%;height:16px;pointer-events:none;'
    + 'opacity:.85;z-index:0;}'
    /* 频谱放到内容下层：让封面/文字/按钮盖在它上面 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .cover-wrapper,'
    + 'html.' + WIDGET_MBAR_CLASS + ' .main-wrapper,'
    + 'html.' + WIDGET_MBAR_CLASS + ' .side-wrapper{'
    + 'position:relative !important;z-index:2 !important;}';

  function widgetInjectStyle() {
    if (document.getElementById('soda-widget-mbar-style')) return;
    var s = document.createElement('style');
    s.id = 'soda-widget-mbar-style';
    s.textContent = WIDGET_MBAR_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* 上一首 / 下一首换成 MusicBar 的同款图标（XAML 里的 PrevIconGeometry / NextIconGeometry，
     1024 网格的实心箭头）。做法是盖一层自己的 svg 并隐藏原生 svg —— 直接改原生节点会被 Vue 重渲染冲掉。 */
  var MBAR_ICONS = {
    prev: 'M747.245 81.064c-28.497-29.315-74.739-29.315-103.307 0l-367.236 378.011c-28.483 29.367-28.483 76.982 0 106.291l367.236 377.997c28.562 29.367 74.806 29.367 103.307 0 28.546-29.325 28.546-76.929 0-106.304l-315.6-324.841 315.599-324.803c28.545-29.367 28.544-76.973 0-106.356l0 0z',
    next: 'M276.755 81.064c28.497-29.315 74.739-29.315 103.307 0l367.236 378.011c28.483 29.367 28.483 76.982 0 106.291L380.062 942.364c-28.562 29.367-74.806 29.367-103.307 0-28.546-29.325-28.546-76.929 0-106.304l315.6-324.841L276.755 187.368c-28.545-29.367-28.544-76.973 0-106.304z',
    play: 'M320.04 931.8c-27.68 0-55.44-7.2-80.84-21.6-52.08-29.48-83.2-82.84-83.2-142.72V256.44c0-59.88 31.12-113.2 83.2-142.72 52.08-29.48 113.84-28.72 165.16 2.08l425.88 255.52c49.84 29.92 79.64 82.48 79.64 140.64 0 58.16-29.76 110.72-79.64 140.64l-425.88 255.52c-26.28 15.76-55.28 23.68-84.32 23.68z m0-767.52c-15.52 0-31.08 4.04-45.36 12.12C245.44 192.96 228 222.88 228 256.44v511.04c0 33.6 17.44 63.52 46.68 80.04 29.24 16.56 63.88 16.12 92.68-1.16l425.88-255.52c27.96-16.8 44.68-46.28 44.68-78.88 0-32.6-16.68-62.12-44.68-78.88L367.36 177.56c-14.72-8.84-31-13.28-47.32-13.28z',
    pause: 'M416 672a32 32 0 0 1-32-32v-256a32 32 0 1 1 64 0v256a32 32 0 0 1-32 32z m192 0a32 32 0 0 1-32-32v-256a32 32 0 1 1 64 0v256a32 32 0 0 1-32 32z'
  };

  function widgetSetIcon(btn, key) {
    if (!btn || !MBAR_ICONS[key]) return;
    if (btn.getAttribute('data-soda-mb') === key) return;
    var span = btn.querySelector('.soda-mb-icon');
    if (!span) {
      span = document.createElement('span');
      span.className = 'soda-mb-icon';
      btn.appendChild(span);
    }
    span.innerHTML = '<svg viewBox="0 0 1024 1024"><path fill="currentColor" d="'
      + MBAR_ICONS[key] + '"></path></svg>';
    btn.setAttribute('data-soda-mb', key);
  }

  /* 心形左侧的播放模式按钮：列表循环 / 单曲循环 / 随机。
     汽水没有暴露播放模式的类名（CSS 里只有 feed_mode_item 之类），所以点击时
     先按 title / aria-label 找原生按钮转发；找不到就只保留本地状态，日志里提示。 */
  var WIDGET_MODE_KEY = 'sodaSpeedMod.widgetMode';
  var WIDGET_CMD_KEY = 'sodaSpeedMod.widgetCmd';
  /* 直接用汽水官方的三枚图标（从 main.asar 里 ListLoopSvg / SingleLoopSvg / ShuffleSvg 抠出来的
     48 网格实心路径），这样任务栏和底栏里的图标长得一模一样。 */
  var MODE_SVGS = {
    list: 'M42 19.492c1.054 0 1.918.818 1.995 1.854l.005.15v5.01c0 7.642-6.1 13.857-13.687 14.024l-.313.003H17v2.864a1.602 1.602 0 0 1-2.541 1.296l-6.363-4.636a2.006 2.006 0 0 1-.09-3.172l6.38-5.231A1.598 1.598 0 0 1 17 32.894v3.63l13 .002c5.43 0 9.848-4.336 9.996-9.74l.004-.28v-5.01c0-1.107.895-2.004 2-2.004M32.6 3c.338 0 .668.107.941.307l6.363 4.636a2.006 2.006 0 0 1 .09 3.172l-6.38 5.231A1.598 1.598 0 0 1 31 15.106v-3.632H18c-5.43 0-9.848 4.336-9.996 9.74l-.004.28v5.01a2 2 0 0 1-2 2.004 2 2 0 0 1-1.995-1.854L4 26.504v-5.01C4 13.852 10.1 7.637 17.687 7.47L18 7.467l13-.001V4.603C31 3.718 31.716 3 32.6 3',
    one: 'M43.995 21.347A2 2 0 0 0 42 19.492c-1.105 0-2 .897-2 2.004v5.01l-.004.28c-.148 5.404-4.567 9.74-9.996 9.74l-13-.002v-3.63a1.598 1.598 0 0 0-2.613-1.24l-6.381 5.231q-.2.164-.351.372a2.006 2.006 0 0 0 .44 2.8l6.364 4.636A1.598 1.598 0 0 0 17 43.397v-2.865l13 .001.313-.003C37.9 40.363 44 34.148 44 26.506v-5.01zM33.54 3.307A1.598 1.598 0 0 0 31 4.603v2.863H18l-.313.004C10.1 7.637 4 13.852 4 21.494v5.01l.005.15A2 2 0 0 0 6 28.508c1.105 0 2-.897 2-2.004v-5.01l.004-.28c.148-5.404 4.567-9.74 9.996-9.74h13v3.631a1.598 1.598 0 0 0 2.613 1.24l6.381-5.23q.2-.164.351-.372a2.006 2.006 0 0 0-.44-2.8zm-10.146 26.15c0 1.074.722 1.768 1.787 1.768s1.777-.694 1.777-1.768V18.686c0-1.23-.752-2.002-2.041-2.002-.703 0-1.309.078-2.06.585l-2.667 1.817c-.507.352-.712.752-.712 1.27 0 .722.517 1.24 1.21 1.24.342 0 .557-.078.88-.303l1.757-1.22h.069z',
    shuffle: 'm37.23 4.516 5.84 4.552a2 2 0 0 1 .072 3.096l-5.84 5.006C36.004 18.282 34 17.36 34 15.652v-2.538a12 12 0 0 0-9.08 6.52L22.735 24l2.183 4.367A12 12 0 0 0 34 34.887v-2.793c0-1.665 1.916-2.601 3.23-1.578l5.84 4.552a2 2 0 0 1 .072 3.096l-5.84 5.006C36.004 44.282 34 43.36 34 41.652v-2.737a16 16 0 0 1-12.658-8.76l-.842-1.683-1.58 3.162A13.33 13.33 0 0 1 7 39a2 2 0 1 1 0-4 9.33 9.33 0 0 0 8.342-5.155L18.264 24l-2.922-5.844A9.33 9.33 0 0 0 7 13a2 2 0 1 1 0-4c5.048 0 9.662 2.852 11.92 7.367l1.58 3.161.842-1.683A16 16 0 0 1 34 9.085V6.094c0-1.665 1.916-2.601 3.23-1.578'
  };
  var MODE_LABELS = { list: '列表循环', one: '单曲循环', shuffle: '随机播放' };

  /* 模式集合跟着上下文走：
     普通播放只有「列表循环 / 单曲循环」；在歌单里多一个「随机播放」。
     ctx 由主窗口按当前路由判断后随数据一起推过来。 */
  function widgetModeList() {
    return (widgetData && widgetData.ctx) ? ['list', 'one', 'shuffle'] : ['list', 'one'];
  }

  var modeOpt = '';        // 刚点完的乐观值（等 App 的真实状态回来再让位）
  var modeOptAt = 0;

  function widgetModeCurrent() {
    /* 1) 刚点过：先在 1.8 秒内显示点完的目标，避免「点下去图标先弹回去」
       2) 之后以汽水的真实状态（主窗口从原生图标读出来的 md）为准
       3) 都拿不到再退回本地记录 */
    if (modeOpt && Date.now() - modeOptAt < 1800) return modeOpt;
    if (widgetData && widgetData.md && MODE_SVGS[widgetData.md]) return widgetData.md;
    try {
      var v = localStorage.getItem(WIDGET_MODE_KEY) || 'list';
      return MODE_SVGS[v] ? v : 'list';
    } catch (e) { return 'list'; }
  }

  function widgetRenderMode(btn) {
    if (!btn) return;
    var list = widgetModeList();
    var cur = widgetModeCurrent();
    if (list.indexOf(cur) < 0) cur = list[0];      // 离开歌单后随机态回落到列表循环
    var svg = btn.querySelector('svg');
    if (svg) {
      svg.setAttribute('viewBox', '0 0 48 48');
      svg.innerHTML = '<path fill="currentColor" fill-rule="evenodd" d="' + MODE_SVGS[cur] + '"></path>';
    }
    btn.setAttribute('data-mode', cur);
    btn.title = MODE_LABELS[cur];
  }

  function widgetCycleMode(btn) {
    var list = widgetModeList();
    var cur = widgetModeCurrent();
    var i = list.indexOf(cur);
    if (i < 0) i = 0;
    var next = list[(i + 1) % list.length];
    modeOpt = next;
    modeOptAt = Date.now();
    try { localStorage.setItem(WIDGET_MODE_KEY, next); } catch (e) { /* ignore */ }
    widgetRenderMode(btn);
    try {
      /* 通知主窗口去点原生按钮（跨窗口靠 storage 事件） */
      localStorage.setItem(WIDGET_CMD_KEY, JSON.stringify({ t: 'mode', m: next, ts: Date.now() }));
    } catch (e) { /* ignore */ }
  }

  /* 「少推荐」按钮：图标直接用官方的 DisLikeSvg（汽水底栏 actions-left 里那个大拇指朝下），
     点击行为转发给主窗口，由它去点原生按钮。 */
  var DISLIKE_PATH = 'M10.482 11.405A5 5 0 0 1 15.361 7.5h14.897v18.558a7 7 0 0 0-5.887 5.244l-2.209 8.834a2.46 2.46 0 0 1-4.792-1.112l1.714-8A2.5 2.5 0 0 0 16.64 28h-3.636c-3.203 0-5.58-2.97-4.879-6.095zM34.258 26H39a1 1 0 0 0 1-1V9.5a2 2 0 0 0-2-2h-3.742zM15.361 3.5a9 9 0 0 0-8.782 7.029l-2.357 10.5C2.96 26.654 7.238 32 13.004 32h1.78l-1.325 6.186C12.597 42.208 15.663 46 19.776 46a6.46 6.46 0 0 0 6.267-4.894l2.209-8.834A3 3 0 0 1 31.162 30H39a5 5 0 0 0 5-5V9.5a6 6 0 0 0-6-6z';

  function widgetEnsureDislikeButton() {
    var side = document.querySelector('.side-wrapper');
    if (!side) return;
    if (side.querySelector('.soda-mb-dislike')) return;
    var b = document.createElement('button');
    b.className = 'soda-mb-dislike';
    b.type = 'button';
    b.title = '少推荐';
    b.innerHTML = '<svg viewBox="0 0 48 48"><path fill="currentColor" fill-rule="evenodd" d="'
      + DISLIKE_PATH + '"></path></svg>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        localStorage.setItem(WIDGET_CMD_KEY, JSON.stringify({ t: 'dislike', ts: Date.now() }));
      } catch (err) { /* ignore */ }
    });
    side.insertBefore(b, side.firstChild);
  }

  function widgetEnsureModeButton() {
    var side = document.querySelector('.side-wrapper');
    if (!side) return;
    var exist = side.querySelector('.soda-mb-mode');
    if (exist) {
      widgetRenderMode(exist);    // 上下文变了（进出歌单）要重画
      return;
    }
    var b = document.createElement('button');
    b.className = 'soda-mb-mode';
    b.type = 'button';
    b.innerHTML = '<svg viewBox="0 0 24 24"></svg>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      widgetCycleMode(b);
    });
    side.insertBefore(b, side.firstChild);
    widgetRenderMode(b);
  }

  /* 歌名跑马灯：完全没有溢出就静态显示；溢出时按 MusicBar 的参数滚动
     （ScrollSpeed 40px/s、两份文本之间留 30px Gap），第二份由 .title:after 复制。 */
  var MBAR_MARQUEE_SPEED = 24;   // MusicBar 原值 40，实际看下来偏快，放慢一些
  var MBAR_MARQUEE_GAP = 30;

  function widgetMarquee() {
    var title = document.querySelector('.title');
    var wrap = document.querySelector('.title-wrapper');
    if (!title || !wrap) return;

    var text = (title.textContent || '').replace(/\s+/g, ' ').trim();
    if (title.getAttribute('data-mb') !== text) {
      title.setAttribute('data-mb', text);
      title.style.animation = 'none';
    }

    var avail = wrap.clientWidth;
    if (!avail) return;

    /* 用 Range 量「第一份』文本的真实宽度：伪元素 ::after 不在选区里，
       拿到的就是纯文本宽度，比从 scrollWidth 折算靠谱。 */
    var textW = 0;
    try {
      var range = document.createRange();
      range.selectNodeContents(title);
      textW = range.getBoundingClientRect().width;
    } catch (e) {
      textW = 0;
    }
    if (!textW) textW = Math.max(0, (title.scrollWidth - MBAR_MARQUEE_GAP) / 2);

    if (textW <= avail + 2) {                        // 放得下：静态显示，不滚
      title.setAttribute('data-scroll', '0');
      if (wrap.classList.contains('soda-mb-scroll')) wrap.classList.remove('soda-mb-scroll');
      if (title.style.animationName !== 'none') title.style.animation = 'none';
      return;
    }

    title.setAttribute('data-scroll', '1');
    if (!wrap.classList.contains('soda-mb-scroll')) wrap.classList.add('soda-mb-scroll');
    var shift = textW + MBAR_MARQUEE_GAP;
    var dur = Math.max(2, shift / MBAR_MARQUEE_SPEED);
    title.style.setProperty('--mb-shift', '-' + shift.toFixed(0) + 'px');
    if (title.style.animationName !== 'soda-mb-marquee') {
      title.style.animation = 'soda-mb-marquee ' + dur.toFixed(2) + 's linear infinite';
    }
  }

  function widgetSyncIcons() {
    if (!document.documentElement.classList.contains(WIDGET_MBAR_CLASS)) return;
    widgetEnsureDislikeButton();
    widgetEnsureModeButton();
    var wrap = document.querySelector('.action-wrapper');
    if (!wrap) return;
    var btns = wrap.querySelectorAll('.action-button');
    if (btns.length >= 3) {
      widgetSetIcon(btns[0], 'prev');
      widgetSetIcon(btns[btns.length - 1], 'next');
    }
    /* 播放/暂停不覆盖图标：状态来自主进程推送，暂停时 AudioContext 往往还是 running，
       判断不可靠，会出现「明明暂停了却显示暂停图标」。原生图标本身一定是对的，
       这里只把之前盖上去的层撤掉，尺寸交给 CSS 统一。 */
    var playBtn = wrap.querySelector('.action-button--playback');
    if (playBtn && playBtn.getAttribute('data-soda-mb')) {
      playBtn.removeAttribute('data-soda-mb');
      var old = playBtn.querySelector('.soda-mb-icon');
      if (old && old.parentNode) old.parentNode.removeChild(old);
    }

    widgetMarquee();
  }

  var widgetData = null;
  var widgetUI = null;

  function widgetReadData() {
    try {
      var raw = localStorage.getItem(WIDGET_DATA_KEY);
      widgetData = raw ? JSON.parse(raw) : null;
    } catch (e) { widgetData = null; }
  }

  /* 底部进度条：插一次就够，容器重建后补回 */
  function widgetBuildUI() {
    var app = document.getElementById('app');
    if (!app) return null;
    var host = app.querySelector('.container');
    if (!host) return null;
    if (!document.getElementById('soda-widget-vis')) {
      var vis = document.createElement('canvas');
      vis.id = 'soda-widget-vis';
      host.appendChild(vis);
    }
    var prog = document.getElementById('soda-widget-progress');
    if (prog && host.contains(prog)) { widgetUI = host; return host; }
    prog = document.createElement('div');
    prog.id = 'soda-widget-progress';
    prog.title = '小键盘 ← / → 微调进度（5 秒）';
    prog.innerHTML = '<i></i><b class="soda-mb-hot"></b>';
    /* 进度条：点一下跳过去，按住拖也跟手（边拖边发 move，主窗口同步给原生 slider） */
    var seekDragging = false;
    var seekAt = 0;
    var ratioOf = function (e) {
      var r = prog.getBoundingClientRect();
      if (r.width <= 0) return 0;
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    var paintBar = function (r) {
      var i = prog.querySelector('i');
      if (i) i.style.width = (r * 100).toFixed(2) + '%';
    };
    var sendSeek = function (phase, r) {
      try {
        localStorage.setItem(WIDGET_CMD_KEY, JSON.stringify({
          t: 'seek', phase: phase, r: r, ts: Date.now()
        }));
      } catch (err) { /* ignore */ }
    };

    prog.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      seekDragging = true;
      prog.setAttribute('data-dragging', '1');    // 拖拽期间别让主窗口推的进度覆盖手指位置
      var barEl = prog.querySelector('i');
      if (barEl) barEl.style.transition = 'none';
      try { prog.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var r = ratioOf(e);
      paintBar(r);
      sendSeek('start', r);
    });
    prog.addEventListener('pointermove', function (e) {
      if (!seekDragging) return;
      e.preventDefault();
      var r = ratioOf(e);
      paintBar(r);
      var now = Date.now();
      if (now - seekAt < 70) return;   // 70ms 节流，别把 localStorage 写爆
      seekAt = now;
      sendSeek('move', r);
    });
    var seekEnd = function (e) {
      if (!seekDragging) return;
      seekDragging = false;
      prog.removeAttribute('data-dragging');
      var barEl = prog.querySelector('i');
      if (barEl) barEl.style.transition = '';
      var r = ratioOf(e);
      paintBar(r);
      sendSeek('end', r);
    };
    prog.addEventListener('pointerup', seekEnd);
    prog.addEventListener('pointercancel', seekEnd);
    host.appendChild(prog);
    widgetUI = host;
    return host;
  }

  /* 小键盘 ←/→ 微调进度。播控窗口自己不发声音，只能把命令写进 localStorage，
     由主窗口读 storage 事件去改播放器（和拖动进度条走的是同一条通道）。 */
  var WIDGET_SEEK_STEP = 5;

  function widgetSeekBy(delta) {
    try {
      localStorage.setItem(WIDGET_CMD_KEY, JSON.stringify({
        t: 'seekRel', d: delta, ts: Date.now()
      }));
    } catch (e) { /* ignore */ }
  }

  /* 封面主色 → 背景渐变（主窗口取好色传过来，这里只写 CSS 变量） */
  var widgetColorKey = '';

  function widgetApplyColors(c) {
    var root = document.documentElement;
    var key = c ? JSON.stringify(c) : '';
    if (key === widgetColorKey) return;
    widgetColorKey = key;
    try {
      /* 取色偶尔会失败（切歌瞬间、页面正在重建），这时保留上一次的颜色，
         不要 remove 掉变量 —— 一 remove 就回落成默认青绿，看着像「不识别封面」。 */
      if (!c || c.length < 2) return;
      var rgb = function (a) { return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; };
      root.style.setProperty('--mb-c0', rgb(c[0]));
      root.style.setProperty('--mb-c1', rgb(c[1]));
    } catch (e) { /* ignore */ }
  }

  function widgetDraw() {
    if (!document.documentElement.classList.contains(WIDGET_MBAR_CLASS)) return;
    widgetBuildUI();
    widgetApplyColors(widgetData && widgetData.c);
    /* 正在拖进度条：别用主窗口推来的进度覆盖手指位置 */
    var progEl = document.getElementById('soda-widget-progress');
    /* 高潮点：位置是「占整首的比例」，由主窗口读 App 原生进度条的 .slider-dot 推过来 */
    var hotEl = progEl && progEl.querySelector('.soda-mb-hot');
    if (hotEl) {
      var hot = widgetData && typeof widgetData.h === 'number' ? widgetData.h : 0;
      hot = Math.max(0, Math.min(1, hot));
      if (hot > 0) {
        hotEl.style.display = 'block';
        hotEl.style.left = (hot * 100).toFixed(2) + '%';
      } else {
        hotEl.style.display = 'none';
      }
    }
    if (progEl && progEl.getAttribute('data-dragging') === '1') return;
    var bar = document.querySelector('#soda-widget-progress i');
    if (!bar) return;
    var p = widgetData && typeof widgetData.p === 'number' ? widgetData.p : 0;
    p = Math.max(0, Math.min(1, p));
    bar.style.width = (p * 100).toFixed(2) + '%';
  }

  /* 顶部频谱：26 根条形，取主窗口推来的频段值。
     平滑系数 0.45 与 MusicBar 的 `smoothed += (target - smoothed) * 0.45` 一致，
     刷新 80ms 也对齐它的 DispatcherTimer 间隔。 */
  var mbarVisSmooth = [];
  var mbarAgc = 1;     // 自动增益：把当前帧拉到可见区间

  function widgetDrawVis() {
    if (!document.documentElement.classList.contains(WIDGET_MBAR_CLASS)) return;
    var cv = document.getElementById('soda-widget-vis');
    if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var vals = (widgetData && widgetData.v) || [];
    /* MusicBar 的 MainSpectrumVisual：100 根、每根 2px、两侧各 1px 边距（间距 2），
       高度 = 2 + energy * 14（2~16px）。照这个来，不要自己改比例。 */
    var n = 100;
    var bw = 2;
    var gap = 2;

    var peak = 0;
    for (var k = 0; k < n; k++) {
      if ((vals[k] || 0) > peak) peak = vals[k];
    }
    if (peak < 8) {                          // 没能量就不画，避免留一条静态基线
      for (var r = 0; r < n; r++) mbarVisSmooth[r] = 0;
      return;
    }

    var total = n * (bw + gap);
    var x0 = Math.max(0, (w - total) / 2);

    /* 颜色：MusicBar 是「背景色提亮」——亮度低于 0.45 补 92，否则补 52，alpha 232 */
    var c = widgetData && widgetData.c && widgetData.c[0];
    if (c) {
      var br = (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255;
      var lift = br < 0.45 ? 92 : 52;
      g.fillStyle = 'rgba('
        + Math.min(255, c[0] + lift) + ','
        + Math.min(255, c[1] + lift) + ','
        + Math.min(255, c[2] + lift) + ',0.91)';
    } else {
      g.fillStyle = 'rgba(232,232,234,.91)';
    }

    /* 先跑平滑，拿到这一帧的最大值 —— 用来做 AGC（MusicBar 也有快攻慢放的自动增益）：
       没有 AGC 时低频段很高、中高频几乎全是 2px 底线，看上去就像整排不动 */
    var maxCur = 0;
    for (var s = 0; s < n; s++) {
      var t0 = (vals[s] || 0) / 255;
      var c0 = mbarVisSmooth[s] || 0;
      c0 += (t0 - c0) * 0.65;          // 比 MusicBar 的 0.45 更跟手
      mbarVisSmooth[s] = c0;
      if (c0 > maxCur) maxCur = c0;
    }

    var want = maxCur > 0.02 ? Math.min(10, 0.95 / maxCur) : 1;
    mbarAgc += (want - mbarAgc) * 0.4;
    if (mbarAgc < 1) mbarAgc = 1;

    for (var i = 0; i < n; i++) {
      var v2 = Math.min(1, (mbarVisSmooth[i] || 0) * mbarAgc);
      var bh = 2 + v2 * 14;                  // 2px 底线 + 14px 动态，和 CreateBar 一致
      /* 倒过来：贴着上沿、向下垂 */
      g.fillRect(x0 + i * (bw + gap), 0, bw, bh);
    }
  }

  function widgetApplyStyle() {
    var root = document.documentElement;
    if (!root) return;
    var v = '';
    try { v = localStorage.getItem(WIDGET_STYLE_KEY) || ''; } catch (e) { v = ''; }
    var on = v === 'musicbar';
    if (on) widgetInjectStyle();
    if (root.classList.contains(WIDGET_MBAR_CLASS) !== on) {
      root.classList.toggle(WIDGET_MBAR_CLASS, on);
    }

    /* 切回官方样式：把 MusicBar 专属的节点全部摘掉。
       留着它们只会变成裸元素 —— canvas 没有 CSS 尺寸时默认 300×150，
       自定义按钮没有样式也撑成灰块（就是截图里那两个方块）。 */
    if (!on) {
      var junk = ['soda-widget-vis', 'soda-widget-progress', 'soda-mb-mode', 'soda-mb-dislike'];
      for (var j = 0; j < junk.length; j++) {
        var node = document.getElementById(junk[j]) || document.querySelector('.' + junk[j]);
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }
      var styleEl = document.getElementById('soda-widget-mbar-style');
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    }
  }

  if (isWidgetPage) {
    enableWidgetDragRegion();
    widgetApplyStyle();
    widgetReadData();
    /* 主窗口会持续写频谱/进度快照，storage 事件在另一个窗口触发 → 即时可见 */
    window.addEventListener('storage', function (e) {
      if (!e || e.key === WIDGET_STYLE_KEY || e.key === WIDGET_DATA_KEY || e.key === null) {
        widgetApplyStyle();
        widgetReadData();
        widgetDraw();
      }
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', widgetApplyStyle, { once: true });
    }
    /* 诊断：打印页面视口尺寸，用来确认「窗口 430 但内容仍 388」的问题 */
    var lastVp = '';
    var logViewport = function () {
      var v = window.innerWidth + 'x' + window.innerHeight;
      if (v === lastVp) return;
      lastVp = v;
      try { console.log('[倍速Mod] 播控视口: ' + v + ' | dpr=' + (window.devicePixelRatio || 1)); } catch (e) { /* ignore */ }
    };
    logViewport();
    window.addEventListener('resize', logViewport);

    /* 小键盘 ←/→ 调进度：Numpad4 / Numpad6（NumLock 关闭时它们就是方向键），每次 5 秒。
       用哪套键由设置里的「进度调节键」决定（numpad / arrows），和主窗口那份一致。
       播控窗通常不是焦点窗口，真正按键盘时多半是主窗口在收事件 —— 那边也有一份。 */
    window.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var code = e.code || '';
      var dir = 0;
      if (code === 'Numpad4') dir = -1;
      else if (code === 'Numpad6') dir = 1;
      if (!dir) return;
      e.preventDefault();
      widgetSeekBy(dir * WIDGET_SEEK_STEP);
    });



    setInterval(function () {
      widgetApplyStyle();
      widgetReadData();
      widgetSyncIcons();
      logViewport();
    }, 1000);
    (function loop() {
      widgetDraw();
      window.requestAnimationFrame(loop);
    })();
    setInterval(widgetDrawVis, 55);     // 比 MusicBar 的 80ms 更快一点，响应更跟手
    return;
  }

  if (isWidgetShadowPage) {
    return;
  }

  var CFG = {
    rateKey: 'sodaSpeedMod.rate',
    min: 0.5,
    max: 3,
    step: 0.05,
    ticks: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3],
    /* 只给这些刻度标数字；其余（0.75 / 1.25）画短刻度线仍可点击。
       0.25 步的两个文字标签在 330px 面板内会重叠 0.55px，故不标注。 */
    tickLabels: [0.5, 1, 1.5, 2, 2.5, 3],
    keepPitch: true,
    wheelKey: 'sodaSpeedMod.wheelSwitch',
    pitchKey: 'sodaSpeedMod.keepPitch',
    visKey: 'sodaSpeedMod.spectrum',
    visColorKey: 'sodaSpeedMod.spectrumColor',   // 频谱配色是否跟随背景 / 封面取色
    clearBgKey: 'sodaSpeedMod.clearBg',          // 旧开关（仅用于迁移）
    bgModeKey: 'sodaSpeedMod.bgMode',            // 背景模式：off 原样 / black 黑底 / transparent 透明
    surfaceAlphaKey: 'sodaSpeedMod.surfaceAlpha',  // 表面不透明度：0 完全透明(看穿) ~ 1 完全不透明
    panelBlurKey: 'sodaSpeedMod.panelBlur',      // 面板/评论区毛玻璃半径(px)：0 = 关闭
    widgetStyleKey: 'sodaSpeedMod.widgetStyle',  // 任务栏播控样式：native 官方 / musicbar MusicBar
    widgetDataKey: 'sodaSpeedMod.widgetData',    // 推给任务栏播控的频谱/进度快照（跨窗口用 localStorage 传）
    brandName: 'liyue',             // 侧边栏 logo 下方显示的名字
    brandFace: ' (∪.∪ )...zzz',     // 跟在名字后的颜文字（真正的取值由下方 BRAND_FACES 随机挑，见那里）
    fxKey: 'sodaSpeedMod.brandFx',           // 品牌名特效模式: off / flow / hue / breathe
    fxSpeedKey: 'sodaSpeedMod.brandFxSpeed', // 特效速度倍率 0.2 ~ 3
    fxSatKey: 'sodaSpeedMod.brandFxSat',     // 特效浓度（饱和度）0 ~ 2
    rowCoverKey: 'sodaSpeedMod.rowCover',    // 歌单曲目行左侧封面 开/关
    hideUnKey: 'sodaSpeedMod.hideUnplayable', // 隐藏不可播放曲目 开/关
    zIndex: 2147483646
  };

  /* 跟在名字后面的颜文字池：每次进站（脚本注入一次）随机挑一个，整个会话内固定不变，
     节点被 Vue 重建时也用同一个，不会来回跳。前置空格一并写进池子里 ——
     名字与颜文字之间靠它分隔，灰色样式只作用在颜文字那一段上。
     第一项是原先一直在用的那个，保留不删。 */
  var BRAND_FACES = [
    ' (∪.∪ )...zzz',    // 原先一直在用的，保留
    ' (￣y▽,￣)╭',
    ' <(＿　＿)>',
    ' (/≧▽≦)/',
    ' (╹ڡ╹ )',
    ' (⊙x⊙;)╮',
    ' （╯＿╰）',
    ' ╭(☆-ｖ-)',
    ' :P',
    ' :-D',
    ' O.O',
    ' OwO',
    ' O_O',
    ' >_<',
    ' =D',
    ' >.<'
  ];
  CFG.brandFace = BRAND_FACES[Math.floor(Math.random() * BRAND_FACES.length)];
  logDbg('品牌颜文字: ' + CFG.brandFace.trim() + '（共 ' + BRAND_FACES.length + ' 个随机池）');

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function snap(v) { return Math.round(clamp(v, CFG.min, CFG.max) / CFG.step) * CFG.step; }
  function fmt(v) { return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')) + 'x'; }
  function ls(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
      return true;
    } catch (e) { return null; }
  }

  var rate = snap(Number.parseFloat(ls(CFG.rateKey) || '') || 1);
  var suspended = false;
  var popHost = null;
  var shownRate = null;   // 上一次渲染的倍速，用于判断「变化」才弹跳
  var wheelOn = ls(CFG.wheelKey) !== '0';    // 滚轮切歌，默认开启
  CFG.keepPitch = ls(CFG.pitchKey) !== '0';  // 变速不变调，默认开启
  var spectrumOn = ls(CFG.visKey) !== '0';   // 频谱浮层，默认开启
  var spectrumColorOn = ls(CFG.visColorKey) !== '0';   // 频谱跟随背景取色，默认开启（关掉用固定蓝白）
  /* 背景模式：off = 不动 App 背景 / black = 清掉色块铺近黑底 / transparent = 整层玻璃化 */
  var BG_MODES = ['off', 'black', 'transparent'];
  function normBgMode(v) { return BG_MODES.indexOf(v) >= 0 ? v : 'transparent'; }
  var bgMode = (function () {
    var saved = ls(CFG.bgModeKey);
    if (saved) return normBgMode(saved);
    return ls(CFG.clearBgKey) === '0' ? 'off' : 'transparent';   // 兼容旧开关
  })();
  var surfaceAlpha = clamp(numOr(ls(CFG.surfaceAlphaKey), 0.35), 0, 1);   // 整体不透明度（0=全透明）
  var panelBlur = clamp(numOr(ls(CFG.panelBlurKey), 24), 0, 60);   // 面板/评论区毛玻璃半径（px，0 = 关闭）
  var rowCoverOn = ls(CFG.rowCoverKey) !== '0';   // 歌单曲目行封面，默认开启
  var hideUnplayable = ls(CFG.hideUnKey) === '1'; // 隐藏不可播放曲目，默认关闭（页面上有按钮可开）

  /* ================= 速率控制核心 ================= */

  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Orig = window[name];
    if (typeof Orig !== 'function') return;
    window[name] = class extends Orig {
      constructor() {
        super(...arguments);
        (window.__sodaAudioContexts || (window.__sodaAudioContexts = [])).push(this);
      }
    };
  });

  var mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  var rateDesc = mediaProto && Object.getOwnPropertyDescriptor(mediaProto, 'playbackRate');

  if (rateDesc && rateDesc.set) {
    Object.defineProperty(mediaProto, 'playbackRate', {
      configurable: true,
      enumerable: rateDesc.enumerable,
      get: rateDesc.get,
      set: function (value) {
        rateDesc.set.call(this, suspended ? value : rate);
      }
    });
  }

  var known = [];

  function normalize(el) {
    try { if (el.preservesPitch !== CFG.keepPitch) el.preservesPitch = CFG.keepPitch; } catch (e) {}
    if (!rateDesc || suspended) return;
    if (Math.abs(el.playbackRate - rate) > 1e-6) rateDesc.set.call(el, rate);
  }

  function remember(el) {
    for (var i = 0; i < known.length; i++) if (known[i] === el) return;
    known.push(el);
    normalize(el);
  }

  function deepScan(root, out) {
    out = out || [];
    var scope = root || document;
    if (!scope.querySelectorAll) return out;
    var list = scope.querySelectorAll('audio,video');
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    var nodes;
    try { nodes = scope.querySelectorAll('*'); } catch (e) { return out; }
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j].shadowRoot) deepScan(nodes[j].shadowRoot, out);
    }
    return out;
  }

  if (mediaProto && typeof mediaProto.play === 'function') {
    var origPlay = mediaProto.play;
    mediaProto.play = function () {
      remember(this);
      var self = this;
      Promise.resolve().then(function () { normalize(self); });
      return origPlay.apply(this, arguments);
    };
  }

  if (mediaProto && typeof mediaProto.load === 'function') {
    var origLoad = mediaProto.load;
    mediaProto.load = function () {
      remember(this);
      return origLoad.apply(this, arguments);
    };
  }

  function trackAudioNode(node) {
    (window.__sodaABSNodes || (window.__sodaABSNodes = [])).push(node);
    try { node.playbackRate.value = suspended ? 1 : rate; } catch (e) {}
    tapAnalyser(node);
    return node;
  }

  /* 频谱采集。
     汽水音乐的音频既不走 createBufferSource，也没有 <audio> 元素，
     而是 AudioWorklet 直接输出，所以按「谁连到 destination 就 tap 谁」来兜，
     任何音频架构最后都必须连到 destination，这条规则覆盖得到。 */
  var origNodeConnect = null;
  var nodeProto = window.AudioNode && window.AudioNode.prototype;
  if (nodeProto && typeof nodeProto.connect === 'function') {
    origNodeConnect = nodeProto.connect;
    nodeProto.connect = function (dest) {
      var r = origNodeConnect.apply(this, arguments);
      try {
        var ctx = this.context;
        if (dest && ctx && dest === ctx.destination) tapAnalyser(this);
      } catch (e) { /* ignore */ }
      return r;
    };
  }

  /* 内部接线一律走原始 connect，避免触发上面的 hook 造成自我连接/反馈环 */
  function nodeConnect(n, target) {
    return origNodeConnect ? origNodeConnect.call(n, target) : n.connect(target);
  }

  /* 给音源额外接一条 AnalyserNode 分支；不接回 destination 就取不到数（见下方 gain=0 回流） */
  function tapAnalyser(node) {
    try {
      var ctx = node && node.context;
      if (!ctx || typeof ctx.createAnalyser !== 'function') return;
      if (node.__sodaTapped) { visAnalyser = ctx.__sodaAnalyser || visAnalyser; return; }
      node.__sodaTapped = true;

      var a = ctx.__sodaAnalyser;
      if (!a) {
        a = ctx.createAnalyser();
        a.fftSize = 2048;
        a.smoothingTimeConstant = 0.8;
        ctx.__sodaAnalyser = a;
        /* 让 analyser 在渲染图里「可达」：只接输入、输出悬空时，浏览器可能整条子图都不处理，
           读出来永远是 0。用 gain=0 接回 destination，既保证被处理，又不会多出一份声音。 */
        try {
          var mute = ctx.createGain();
          mute.gain.value = 0;
          nodeConnect(a, mute);
          nodeConnect(mute, ctx.destination);
        } catch (e) { /* 接不上就只靠原路径 */ }
      }
      if (!visAnalyser) {
        logDbg('频谱: 已接管音源 ' + ((node.constructor && node.constructor.name) || 'unknown'));
      }
      nodeConnect(node, a);
      visAnalyser = a;
      // 切歌常常会换一个 AudioContext：拿到新音源就把已经停摆的频谱循环重新唤醒
      if (spectrumOn && !visRaf) startVis();
    } catch (e) { /* 采不到就不显示频谱 */ }
  }

  var baseProto = (window.BaseAudioContext || window.AudioContext || {}).prototype;
  if (baseProto && typeof baseProto.createBufferSource === 'function') {
    var origCBS = baseProto.createBufferSource;
    baseProto.createBufferSource = function () {
      return trackAudioNode(origCBS.apply(this, arguments));
    };
  }

  if (baseProto && typeof baseProto.createMediaElementSource === 'function') {
    var origCMES = baseProto.createMediaElementSource;
    baseProto.createMediaElementSource = function () {
      var n = origCMES.apply(this, arguments);
      tapAnalyser(n);
      return n;
    };
  }

  var absProto = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
  if (absProto && typeof absProto.start === 'function') {
    var origStart = absProto.start;
    absProto.start = function () {
      trackAudioNode(this);
      return origStart.apply(this, arguments);
    };
  }

  if (window.AudioWorkletNode) {
    var OrigAWN = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends OrigAWN {
      constructor() {
        super(...arguments);
        (window.__sodaWorklets || (window.__sodaWorklets = [])).push(String(arguments[1] || 'anon'));
        tapAnalyser(this);   // worklet 往往就是最终出声的那一级，先接上
      }
    };
  }

  function applyAudioNodes() {
    var nodes = window.__sodaABSNodes;
    if (!nodes) return;
    var target = suspended ? 1 : rate;
    for (var i = 0; i < nodes.length; i++) {
      try { if (nodes[i].playbackRate) nodes[i].playbackRate.value = target; } catch (e) {}
    }
  }

  function applyAll(root) {
    for (var i = 0; i < known.length; i++) normalize(known[i]);
    if (root && root.nodeType === 1 && root.matches && root.matches('audio,video')) remember(root);
    var scope = root || document;
    if (scope.querySelectorAll) {
      var list = scope.querySelectorAll('audio,video');
      for (var k = 0; k < list.length; k++) remember(list[k]);
    }
    if (!suspended) applyAudioNodes();
  }

  function restore() {
    for (var i = 0; i < known.length; i++) if (rateDesc) rateDesc.set.call(known[i], 1);
    var list = document.querySelectorAll('audio,video');
    for (var j = 0; j < list.length; j++) if (rateDesc) rateDesc.set.call(list[j], 1);
    var nodes = window.__sodaABSNodes || [];
    for (var k = 0; k < nodes.length; k++) {
      try { nodes[k].playbackRate.value = 1; } catch (e) {}
    }
  }

  function setRate(next) {
    rate = snap(next);
    suspended = false;
    ls(CFG.rateKey, String(rate));
    applyAll();
    renderPopup();
  }

  function suspend(on) {
    suspended = on === undefined ? !suspended : !!on;
    if (suspended) restore(); else applyAll();
    renderPopup();
  }

  /* ================= 弹出式控制条 ================= */

  var POP_CSS =
    '.bar{box-sizing:border-box;width:330px;padding:13px 18px 11px;' +
    'font:13px/1.4 "Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;' +
    'color:rgba(255,255,255,.92);' +
    'background:rgba(24,24,28,.62);' +
    '-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);' +
    'border:1px solid rgba(255,255,255,.10);border-radius:16px;' +
    'box-shadow:0 16px 44px rgba(0,0,0,.5);}' +
    '.head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;}' +
    '.title{font-size:12px;letter-spacing:.06em;color:rgba(255,255,255,.5);}' +
    '.val{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;' +
    'color:#fff;cursor:pointer;transition:color .15s;}' +
    '.val:hover{color:#7ccfff;}' +
    // 数字单独成元素，弹跳时不带动右侧「复位」小字
    '.val b{font-weight:inherit;font-size:inherit;display:inline-block;' +
    'transform-origin:50% 58%;will-change:transform;}' +
    '.val small{font-size:12px;font-weight:400;opacity:.5;margin-left:4px;}' +
    '.foot{display:flex;gap:6px;margin-top:10px;}' +
    '.chip{flex:1;text-align:center;font-size:11px;line-height:1;padding:7px 0;border-radius:9px;' +
    'cursor:pointer;color:rgba(255,255,255,.5);background:rgba(255,255,255,.06);' +
    'transition:background .15s,color .15s;-webkit-user-select:none;user-select:none;}' +
    '.chip:hover{background:rgba(255,255,255,.13);color:#fff;}' +
    '.chip.on{color:#0d0d10;background:#7ccfff;font-weight:600;}' +
    '.chip.warn{color:#ffd479;background:rgba(255,212,121,.14);font-weight:600;}' +
    'input[type=range]{-webkit-appearance:none;appearance:none;display:block;width:100%;height:20px;' +
    'margin:0;background:transparent;outline:none;cursor:pointer;}' +
    'input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;' +
    'background:linear-gradient(to right,rgba(124,207,255,.95) 0%,rgba(124,207,255,.95) var(--fill,42%),' +
    'rgba(255,255,255,.16) var(--fill,42%),rgba(255,255,255,.16) 100%);}' +
    'input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;' +
    'border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transition:transform .12s;}' +
    'input[type=range]:active::-webkit-slider-thumb{transform:scale(1.15);}' +
    // 刻度按数值绝对定位（等距排布会与线性滑块对不上）
    '.ticks{position:relative;height:15px;margin-top:6px;}' +
    '.ticks span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap;' +
    'font-size:11px;color:rgba(255,255,255,.4);cursor:pointer;padding:3px 1px;' +
    'transition:color .12s;font-variant-numeric:tabular-nums;}' +
    '.ticks span:hover{color:#7ccfff;}' +
    '.ticks span.on{color:#7ccfff;font-weight:600;}' +
    // 未标数字的刻度：只画一根短竖线，但 hit 区域仍有 12x15px
    '.ticks span.mark{width:12px;height:15px;padding:0;}' +
    '.ticks span.mark::before{content:"";position:absolute;left:5px;top:5px;width:2px;height:6px;' +
    'border-radius:1px;background:rgba(255,255,255,.26);}' +
    '.ticks span.mark:hover::before{background:#7ccfff;}' +
    '.ticks span.mark.on::before{background:#7ccfff;top:4px;height:8px;}';

  function buildPopup() {
    if (popHost) return popHost;
    popHost = document.createElement('div');
    popHost.id = 'soda-speed-pop';
    popHost.style.cssText =
      'position:fixed;left:50%;bottom:96px;z-index:' + CFG.zIndex + ';' +
      'transform:translate(-50%,10px);opacity:0;pointer-events:none;' +
      'transition:opacity .2s ease,transform .2s cubic-bezier(.22,.8,.3,1);';

    var root = popHost.attachShadow({ mode: 'open' });
    /* 滑块圆点直径 14px，其圆心只在 [7px, 宽度-7px] 之间移动；
       刻度用同一个线性映射定位，数字中心才会正好落在滑块停靠点上。 */
    var THUMB = 14;
    var tickHtml = CFG.ticks.map(function (t) {
      var p = (t - CFG.min) / (CFG.max - CFG.min);
      var pose = 'left:calc(' + (THUMB / 2) + 'px + (100% - ' + THUMB + 'px)*' + p.toFixed(4) + ')';
      var labeled = CFG.tickLabels.indexOf(t) >= 0;
      return '<span data-t="' + t + '"' + (labeled ? '' : ' class="mark" title="' + fmt(t) + '"')
        + ' style="' + pose + '">' + (labeled ? fmt(t) : '') + '</span>';
    }).join('');

    root.innerHTML = '<style>' + POP_CSS + '</style>'
      + '<div class="bar">'
      + '<div class="head">'
      + '<span class="title">播放倍速</span>'
      + '<span class="val" id="val"><b>1.0x</b><small>复位</small></span>'
      + '</div>'
      + '<input type="range" id="rng" min="' + CFG.min + '" max="' + CFG.max + '" step="' + CFG.step + '">'
      + '<div class="ticks" id="ticks">' + tickHtml + '</div>'
      + '<div class="foot">'
      + '<span class="chip" id="chip-pitch">原调</span>'
      + '<span class="chip" id="chip-vis">频谱</span>'
      + '<span class="chip" id="chip-sleep">定时</span>'
      + '</div>'
      + '</div>';

    var rngEl = root.getElementById('rng');
    var valEl = root.getElementById('val');
    var ticksEl = root.getElementById('ticks');
    var chipPitch = root.getElementById('chip-pitch');
    var chipVis = root.getElementById('chip-vis');
    var chipSleep = root.getElementById('chip-sleep');

    rngEl.addEventListener('input', function () { setRate(Number.parseFloat(rngEl.value)); });
    valEl.addEventListener('click', function () { setRate(1); });
    ticksEl.addEventListener('click', function (e) {
      var t = e.target && e.target.getAttribute && e.target.getAttribute('data-t');
      if (t !== null && t !== undefined) setRate(Number.parseFloat(t));
    });
    chipPitch.addEventListener('click', function () { setKeepPitch(!CFG.keepPitch); });
    chipVis.addEventListener('click', function () { setSpectrum(!spectrumOn); });
    chipSleep.addEventListener('click', function () { setSleep(nextSleepMinutes()); });

    (document.body || document.documentElement).appendChild(popHost);
    return popHost;
  }

  function placePopup() {
    if (!popHost) return;
    // 锚定到播放条上方（底部中央的播放按钮）
    var best = null, bestW = 0;
    var nodes;
    try { nodes = document.querySelectorAll('div,button'); } catch (e) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var r;
      try { r = el.getBoundingClientRect(); } catch (err) { continue; }
      if (r.top < window.innerHeight * 0.8) continue;
      if (r.width < 36 || r.width > 72) continue;
      if (r.height < 30 || r.height > 72) continue;
      if (Math.abs(r.left + r.width / 2 - window.innerWidth / 2) > 60) continue;
      if (r.width > bestW) { bestW = r.width; best = r; }
    }
    var bottom = best ? (window.innerHeight - best.top + 16) : 96;
    popHost.style.bottom = Math.round(clamp(bottom, 56, window.innerHeight - 120)) + 'px';
  }

  /* 数值变化时弹一下。元素每次渲染都会重建，故动画不会互相叠加；
     仍显式 cancel 旧动画，避免同一元素被复用时的累积。 */
  function bounceNum(el) {
    if (!el || typeof el.animate !== 'function') return;
    try {
      if (el.__bounce) el.__bounce.cancel();
      el.__bounce = el.animate([
        { transform: 'scale(1)', offset: 0 },
        { transform: 'scale(1.34)', offset: 0.32 },
        { transform: 'scale(.93)', offset: 0.68 },
        { transform: 'scale(1)', offset: 1 }
      ], { duration: 330, easing: 'ease-out' });
    } catch (e) { /* 动画失败不影响功能 */ }
  }

  function renderPopup() {
    if (!popHost) return;
    var root = popHost.shadowRoot;
    if (!root) return;
    var rngEl = root.getElementById('rng');
    var valEl = root.getElementById('val');
    var ticksEl = root.getElementById('ticks');
    if (!rngEl) return;

    if (Number.parseFloat(rngEl.value) !== rate) rngEl.value = String(rate);
    var fill = ((rate - CFG.min) / (CFG.max - CFG.min) * 100).toFixed(1) + '%';
    rngEl.style.setProperty('--fill', fill);

    valEl.innerHTML = '<b>' + fmt(rate) + '</b><small>' + (suspended ? '已停用' : '复位') + '</small>';
    if (shownRate !== null && shownRate !== rate) bounceNum(valEl.firstChild);
    shownRate = rate;
    popHost.style.opacity = suspended ? '0.55' : '1';

    for (var i = 0; i < ticksEl.children.length; i++) {
      var s = ticksEl.children[i];
      s.classList.toggle('on', Math.abs(Number.parseFloat(s.getAttribute('data-t')) - rate) < 1e-6 && !suspended);
    }

    var chipPitch = root.getElementById('chip-pitch');
    if (chipPitch) chipPitch.classList.toggle('on', !!CFG.keepPitch);
    var chipVis = root.getElementById('chip-vis');
    if (chipVis) chipVis.classList.toggle('on', spectrumOn);

    var chipSleep = root.getElementById('chip-sleep');
    if (chipSleep) {
      var left = sleepRemainMs();
      chipSleep.classList.toggle('on', left > 0);
      chipSleep.classList.toggle('warn', left > 0 && left <= SLEEP_FADE_MS);
      chipSleep.textContent = left > 0 ? '定时 ' + mmss(left) : '定时';
    }

  }

  function showPopup() {
    buildPopup();
    placePopup();
    renderPopup();
    requestAnimationFrame(function () {
      popHost.style.opacity = suspended ? '0.55' : '1';
      popHost.style.transform = 'translate(-50%,0)';
      popHost.style.pointerEvents = 'auto';
    });
  }

  function hidePopup() {
    if (!popHost) return;
    popHost.style.opacity = '0';
    popHost.style.transform = 'translate(-50%,10px)';
    popHost.style.pointerEvents = 'none';
  }

  function togglePopup() {
    if (popHost && popHost.style.pointerEvents === 'auto') hidePopup();
    else showPopup();
  }

  document.addEventListener('mousedown', function (e) {
    if (!popHost || popHost.style.pointerEvents !== 'auto') return;
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(popHost) >= 0) return;
    hidePopup();
  }, true);

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

  /* ================= 变速不变调开关 ================= */

  function setKeepPitch(on) {
    CFG.keepPitch = !!on;
    ls(CFG.pitchKey, CFG.keepPitch ? '1' : '0');
    applyAll();
    renderPopup();
  }

  /* ================= 频谱浮层 ================= */

  var VIS_RING = 26;        // 环带厚度（CSS px）
  var VIS_GAP = 7;          // 环带内缘与按钮边缘的间距
  var VIS_BARS = 72;        // 柱数
  var VIS_ANCHOR_MAX = 70;  // 图标离封面右下角超过这个距离就认为不是目标

  var visHost = null;
  var visCanvas = null;
  var vis2d = null;
  var visRaf = 0;
  var visAnalyser = null;
  var visData = null;
  var visSmooth = null;     // 每根柱的平滑值（快起慢落，避免抖动）
  var visIdle = 0;
  var visGotData = false;   // 是否成功采到过非静音数据（用于排障日志，只报一次）
  var visAnchor = null;     // 锚点：点赞按钮里的那个心形 svg
  var visAnchorAt = 0;      // 上次重新找锚点的时间
  var visAnchorDist = -1;   // 当前锚点距封面右下角的距离
  var visAnchorHow = '';    // 锚点来源：图标 / 标定偏移
  var visPos = { x: -1, y: -1, s: -1 };   // 上次写进 style 的位置/尺寸，避免每帧写
  var visAlpha = 0;         // 当前不透明度（0~1），由脚本按时间插值 → 渐显 / 渐隐
  var visFadeAt = 0;        // 上次插值的时间戳，用于按真实帧间隔推进（与刷新率无关）
  var VIS_FADE_MS = 520;    // 渐显 / 渐隐时长

  /* ---------- 锚点定位：围绕点赞按钮画圈 ---------- */

  function svgPathOf(el) {
    try {
      var p = el.querySelector && el.querySelector('path');
      return (p && p.getAttribute('d')) || '';
    } catch (e) { return ''; }
  }

  function classOf(el) {
    try { return String((el && el.getAttribute && el.getAttribute('class')) || '').toLowerCase(); }
    catch (e) { return ''; }
  }

  /* 往上数层找「只有数字」的祖先：点赞按钮下面挂的就是点赞数 */
  function nearCountText(el) {
    var cur = el.parentElement;
    for (var i = 0; i < 4 && cur; i++, cur = cur.parentElement) {
      var t = (cur.textContent || '').replace(/[\s,]/g, '');
      if (/^\d{1,6}$/.test(t)) return t;
    }
    return '';
  }

  /* 详情页封面：视口内完整可见、面积最大的近似正方形图片。
     点赞爱心就贴在封面右下角，用这个几何关系定位比认图标可靠得多。
     这里只缓存「元素」本身，矩形每帧现取 —— 否则窗口缩放、点按钮引起的位置变化
     都会先画在旧坐标上，看起来就是圆圈先偏一下再自己回去。 */
  var visCoverEl = null, visCoverElAt = 0;

  function coverEl() {
    var now = Date.now();
    if (visCoverEl && visCoverEl.isConnected && now - visCoverElAt < 1500) return visCoverEl;
    visCoverElAt = now;
    var imgs;
    /* 封面可能渲染成 <img>，也可能是带背景图的 div，两类都看 */
    try {
      imgs = document.querySelectorAll('img,[class*="cover"],[class*="album"],[class*="poster"]');
    } catch (e) { visCoverEl = null; return null; }
    var best = null, bestA = 0;
    for (var i = 0; i < imgs.length; i++) {
      var r;
      try { r = imgs[i].getBoundingClientRect(); } catch (e) { continue; }
      if (r.width < 140 || r.height < 140) continue;
      var ratio = r.width / r.height;
      if (ratio < 0.85 || ratio > 1.18) continue;
      if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) continue;
      var a = r.width * r.height;
      if (a > bestA) { bestA = a; best = imgs[i]; }
    }
    visCoverEl = best;
    return visCoverEl;
  }

  function coverBox() {
    var el = coverEl();
    if (!el) return null;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return null; }
    if (r.width < 140 || r.height < 140) return null;
    if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  /* 布局变化时让封面元素也重新挑一次（圆环位置本身已经是实时的，不用管） */
  function invalidateVisLayout() {
    visCoverElAt = 0;
  }

  window.addEventListener('resize', invalidateVisLayout);
  if (window.ResizeObserver) {
    try { new ResizeObserver(invalidateVisLayout).observe(document.documentElement); } catch (e) { /* ignore */ }
  }

  var ANCHOR_SEL = 'svg,button,[class*="icon"],[class*="like"],[class*="heart"]';

  function collectAnchors() {
    var out = [];
    var list;
    try { list = document.querySelectorAll(ANCHOR_SEL); } catch (e) { return out; }
    var cover = coverBox();
    for (var i = 0; i < list.length; i++) {
      var svg = list[i], r;
      try { r = svg.getBoundingClientRect(); } catch (e) { continue; }
      if (r.width < 12 || r.width > 56) continue;
      if (Math.abs(r.width - r.height) > 8) continue;
      var ccx = r.left + r.width / 2, ccy = r.top + r.height / 2;
      if (ccx < 4 || ccy < 4 || ccx > window.innerWidth - 4 || ccy > window.innerHeight - 4) continue;
      var cls = classOf(svg) + ' ' + classOf(svg.parentElement);
      var num = nearCountText(svg);
      var d = svgPathOf(svg);

      /* 越像「封面右下角那个带计数的按钮」分越高 */
      var score = 0;
      if (num) score += 50;
      if (/like|heart|collect|favorite|praise/.test(cls)) score += 60;
      if (r.width >= 16 && r.width <= 32) score += 12;
      if (d.length > 80) score += 6;
      score += (r.top / window.innerHeight) * 8;

      var dist = -1;
      if (cover) {
        var dx = (r.left + r.width / 2) - cover.right;
        var dy = (r.top + r.height / 2) - cover.bottom;
        dist = Math.sqrt(dx * dx + dy * dy);
        score += Math.max(0, 150 - dist * 1.5);   // 贴合封面右下角 → 直接拿满
      }
      out.push({ el: svg, rect: r, num: num, cls: cls, d: d, score: score, dist: dist });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function describeAnchor(it) {
    if (!it) return '(未找到)';
    return it.el.tagName + '.' + (it.cls.split(/\s+/)[0] || '-') +
      ' 数字=' + (it.num || '-') +
      ' 尺寸=' + Math.round(it.rect.width) + 'x' + Math.round(it.rect.height) +
      ' 距封面右下=' + (it.dist < 0 ? '无封面' : Math.round(it.dist) + 'px');
  }

  /* 圆心相对封面右下角的偏移：实测标定值 —— 爱心在封面底边下方、与歌曲名同一行 */
  var VIS_ANCHOR_DX = -16;   // 相对封面右边缘：向内 16px
  var VIS_ANCHOR_DY = 45;    // 相对封面底边：向下 45px
  var VIS_ANCHOR_R = 11;     // 假想按钮半径，决定圆环内缘位置

  /* 几何定位：按标定偏移把圆心落在封面右下角下方的爱心处 */
  function geoBox() {
    var cov = coverBox();
    if (!cov || cov.right - cov.left < 180) return null;
    return {
      left: cov.right + VIS_ANCHOR_DX - VIS_ANCHOR_R,
      top: cov.bottom + VIS_ANCHOR_DY - VIS_ANCHOR_R,
      width: VIS_ANCHOR_R * 2,
      height: VIS_ANCHOR_R * 2
    };
  }

  function findLikeAnchor(force) {
    var now = Date.now();
    // 2 秒内直接复用上次结论（含「找不到锚点」的结论），否则一帧一次 DOM 遍历太贵
    if (!force && now - visAnchorAt < 2000) return visAnchor;
    var prev = visAnchor;
    visAnchorAt = now;
    var list = collectAnchors();
    if (list.length ? (list[0].dist >= 0 && list[0].dist <= VIS_ANCHOR_MAX) : false) {
      visAnchor = list[0].el;
      visAnchorDist = list[0].dist;
    } else {
      visAnchor = null;      // 离封面右下角太远（比如播放条那一排），不用它
      visAnchorDist = -1;
    }
    if (prev !== visAnchor) logDbg('频谱锚点: ' + describeAnchor(list.length ? list[0] : null));
    return visAnchor;
  }

  function ensureVis() {
    if (visHost) return;
    visHost = document.createElement('div');
    visHost.id = 'soda-speed-vis';
    visHost.style.cssText =
      'position:fixed;left:0;top:0;z-index:' + (CFG.zIndex - 3) + ';' +
      /* 不透明度改由脚本逐帧插值，不再交给 CSS 过渡（两者叠加会互相拖慢） */
      'pointer-events:none;opacity:0;will-change:transform,opacity;';
    visCanvas = document.createElement('canvas');
    visCanvas.style.cssText = 'display:block;width:100%;height:100%;';
    visHost.appendChild(visCanvas);
    (document.body || document.documentElement).appendChild(visHost);
    vis2d = visCanvas.getContext('2d');
  }

  /* 跟着锚点走：定位画布 + 同步像素尺寸 */
  function layoutVis(r) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var inner = Math.max(r.width, r.height) / 2 + VIS_GAP;
    var size = Math.ceil((inner + VIS_RING) * 2);
    var left = Math.round(r.left + r.width / 2 - size / 2);
    var top = Math.round(r.top + r.height / 2 - size / 2);

    if (visPos.s !== size) {
      visPos.s = size;
      visHost.style.width = size + 'px';
      visHost.style.height = size + 'px';
    }
    if (visPos.x !== left || visPos.y !== top) {
      visPos.x = left;
      visPos.y = top;
      visHost.style.transform = 'translate(' + left + 'px,' + top + 'px)';
    }
    var px = Math.round(size * dpr);
    if (visCanvas.width !== px) {
      visCanvas.width = px;
      visCanvas.height = px;
    }
    return { dpr: dpr, W: px, inner: inner * dpr, ring: VIS_RING * dpr };
  }

  /* ================= 频谱配色：跟着背景 / 封面走 ================= */

  /* 柱子颜色不再写死蓝白，改成从「背景」取色，两级来源：
     1) 优先解析页面背景那层渐变（App 按封面取色生成的 linear-gradient）——
        纯读计算样式，不碰画布，没有跨域问题，也最贴近用户看到的背景；
     2) 拿不到就把封面图缩到 6x6 取两个差异最大的颜色；
     3) 两者都失败（例如封面跨域把画布污染了）就沿用原来的蓝白，功能不受影响。 */
  var visPalette = null;      // [[r,g,b],[r,g,b]]，内环 → 外环
  var visPaletteKey = '';
  var visPaletteAt = 0;
  var visPaletteSettleUntil = 0;   // 换封面后的「过渡期」截止时间，期间允许重算
  var visPaletteRetryAt = 0;       // 彻底取不到色时的重试时间（退避，别每帧重算）
  var visPaletteLog = '';
  var visCoverTaintLogged = false;

  function rgbToCss(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  /* 朝白色混合：背景取到的颜色通常偏暗，不提亮会在深色底上看不见 */
  function lighten(c, amount) {
    return [
      Math.round(c[0] + (255 - c[0]) * amount),
      Math.round(c[1] + (255 - c[1]) * amount),
      Math.round(c[2] + (255 - c[2]) * amount)
    ];
  }

  function parseCssColor(text) {
    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text || '');
    if (m) return [+m[1], +m[2], +m[3]];
    var h = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/.exec(text || '');
    if (!h) return null;
    var s = h[1];
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  /* 一组颜色里挑差异最大的一对，别把整段渐变取成同一种色 */
  function pickPair(colors) {
    var best = null, bestD = -1;
    for (var i = 0; i < colors.length; i++) {
      for (var j = i + 1; j < colors.length; j++) {
        var a = colors[i], b = colors[j];
        var d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
        if (d > bestD) { bestD = d; best = [a, b]; }
      }
    }
    return bestD >= 24 ? best : null;
  }

  /* 颜色的「鲜艳度」：三通道极差。灰阶接近 0，纯色最大 */
  function colorfulness(c) {
    return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  }

  /* 只从足够鲜艳的颜色里挑一对，避免挑到「白 + 深灰」这种高对比但没颜色的组合 */
  function pickVividPair(colors, minVivid) {
    var vivid = [];
    for (var i = 0; i < colors.length; i++) {
      if (colorfulness(colors[i]) >= (minVivid || 28)) vivid.push(colors[i]);
    }
    return vivid.length >= 2 ? pickPair(vivid) : null;
  }

  /* 拉开与自身均值的差距 = 提高饱和度，色相基本不动。
     背景那层是封面重度模糊 + 降饱和的产物，不提纯出来就是一坨灰白。 */
  function punch(c, amount) {
    var m = (c[0] + c[1] + c[2]) / 3;
    return [
      Math.round(clamp(c[0] + (c[0] - m) * amount, 0, 255)),
      Math.round(clamp(c[1] + (c[1] - m) * amount, 0, 255)),
      Math.round(clamp(c[2] + (c[2] - m) * amount, 0, 255))
    ];
  }

  /* 页面背景里最鲜艳的那层大渐变（不是最大的那层：顶层常压着一层近灰遮罩） */
  function paletteFromBackground(requireVivid) {
    var stage = playerStage();
    var cands = [document.body, document.documentElement, document.querySelector('#app'), stage];
    if (stage && stage.children) {
      for (var s = 0; s < stage.children.length; s++) cands.push(stage.children[s]);   // 背景层常是舞台的直接子节点
    }
    try {
      var extra = document.querySelectorAll('[class*="bg"],[class*="backdrop"],[class*="background"],[class*="gradient"]');
      for (var k = 0; k < extra.length && k < 40; k++) cands.push(extra[k]);
    } catch (e) { /* 选择器不支持就算了 */ }

    var minArea = window.innerWidth * window.innerHeight * 0.12;
    var best = null, bestVivid = 0, bestArea = 0;
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (!el) continue;
      var r, cs;
      try { r = el.getBoundingClientRect(); cs = getComputedStyle(el); } catch (e) { continue; }
      var area = r.width * r.height;
      if (area < minArea) continue;                      // 太小的不算「背景」

      var colors = [];
      var bg = cs.backgroundImage || '';
      var re = /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/g, m;
      while ((m = re.exec(bg))) {
        if (/,\s*0(\.0+)?\s*\)\s*$/.test(m[0])) continue;   // 全透明色标（遮罩层）
        var c = parseCssColor(m[0]);
        if (c) colors.push(c);
      }
      if (colors.length < 2) {                            // 纯色背景也能当一档用
        var solid = parseCssColor(cs.backgroundColor);
        if (solid) colors.push(solid);
      }
      if (colors.length < 2) continue;

      var pair = requireVivid ? pickVividPair(colors, 26) : pickPair(colors);
      if (!pair) continue;

      if (requireVivid) {
        /* 只比鲜艳度：顶层那层近灰遮罩面积最大，但几乎没有颜色，不该赢 */
        var vivid = Math.max(colorfulness(pair[0]), colorfulness(pair[1]));
        if (vivid > bestVivid) { bestVivid = vivid; best = pair; }
      } else if (area > bestArea) {
        bestArea = area; best = pair;                     // 退让模式：面积最大者
      }
    }
    return best;
  }

  /* 封面图取色：缩到 6x6 后找差异最大的一对。minVivid > 0 时只接受鲜艳像素；
     传 0 表示黑白封面也认——用封面自身的灰白，而不是掉回蓝白兜底。 */
  function paletteFromCover(minVivid) {
    var el = coverEl();
    if (!el) return null;
    var img = el.tagName === 'IMG' ? el : (el.querySelector ? el.querySelector('img') : null);
    if (!img || !img.complete || !img.naturalWidth) return null;
    try {
      var cv = document.createElement('canvas');
      cv.width = 6; cv.height = 6;
      var cg = cv.getContext('2d');
      cg.drawImage(img, 0, 0, 6, 6);
      var data = cg.getImageData(0, 0, 6, 6).data;
      var px = [];
      for (var i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue;
        px.push([data[i], data[i + 1], data[i + 2]]);
      }
      return minVivid > 0 ? pickVividPair(px, minVivid) : pickPair(px);
    } catch (e) {
      // 画布被跨域污染：封面这条路整体走不通，日志里只说一次
      if (!visCoverTaintLogged) {
        visCoverTaintLogged = true;
        logDbg('频谱配色: 封面画布受跨域限制，改用背景渐变取色');
      }
      return null;
    }
  }

  /* App 自己有一套「按封面算好的调色板」：每个 playable 带着 colors.base_colors，
     渲染层把它写成 --color-base-1..9（值形如 "242, 242, 242" 或带 alpha）。
     这是最靠谱的取色来源 —— 不碰画布、没有跨域限制，而且正就是我们清掉的那层背景
     原本用的颜色。挂在哪个元素上不固定，所以从封面往上找第一个带这个变量的祖先。 */
  var themeVarHost = null;
  var themeVarAt = 0;

  function parseTriplet(text) {
    var m = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(text || '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  function hasBaseVars(el) {
    try {
      var v = getComputedStyle(el).getPropertyValue('--color-base-3');
      return !!(v && v.trim());
    } catch (e) { return false; }
  }

  function themeVarRoot() {
    var el = coverEl();
    while (el && el !== document.documentElement) {
      if (hasBaseVars(el)) return el;
      el = el.parentElement;
    }
    /* 不在播放页（没有封面）时的兜底：这几个容器都可能挂着整套主题色 */
    var cands = ['#app', '.player-box', '.main', '.page', 'body', 'html'];
    for (var i = 0; i < cands.length; i++) {
      var el2 = document.querySelector(cands[i]);
      if (el2 && hasBaseVars(el2)) return el2;
    }
    return null;
  }

  function paletteFromThemeVars(minVivid) {
    var now = Date.now();
    if (!themeVarHost || !themeVarHost.isConnected) {
      if (now - themeVarAt < 1000) return null;   // 找不到时限频，别每帧都遍历祖先
      themeVarAt = now;
      themeVarHost = themeVarRoot();
    }
    if (!themeVarHost) return null;

    var cs;
    try { cs = getComputedStyle(themeVarHost); } catch (e) { return null; }
    var list = [];
    for (var i = 1; i <= 9; i++) {
      var c = null;
      try { c = parseTriplet(cs.getPropertyValue('--color-base-' + i)); } catch (e) { c = null; }
      if (c) list.push(c);
    }
    if (list.length < 2) return null;
    /* 没拿到服务端配色时这 9 个是默认灰阶（F2F2F2…1A1A1A），
       这时 minVivid 会让它返回 null，交回封面/背景那条路 */
    return minVivid > 0 ? pickVividPair(list, minVivid) : pickPair(list);
  }

  /* 两组调色板的差距（6 个通道差之和），用来做抖动抑制 */
  function pairDiff(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return 999;
    var d = 0;
    for (var i = 0; i < 2; i++) {
      for (var k = 0; k < 3; k++) d += Math.abs(a[i][k] - b[i][k]);
    }
    return d;
  }

  /* 换歌时重取一次就够了：取到色之后同一张封面不再周期性重算 ——
     以前每 4 秒重算，主题色在切歌过渡动画里有微小变化，pickVividPair 会在两套
     相近颜色之间来回跳，看起来就是「颜色不稳定」。
     换歌后 2.5 秒内允许重算几次（等主题色过渡到位）；取色失败时保留上一次的颜色。 */
  function refreshVisPalette() {
    if (!spectrumColorOn) return null;   // 设置里关掉取色：直接用固定蓝白
    var now = Date.now();
    var el = coverEl();
    var img = el && (el.tagName === 'IMG' ? el : (el.querySelector ? el.querySelector('img') : null));
    var key = (img && (img.currentSrc || img.src)) || '';

    if (key !== visPaletteKey) {
      visPaletteKey = key;
      visPaletteAt = 0;
      visPaletteSettleUntil = now + 2500;   // 换歌过渡期：多算几次，之后定格
    }
    if (visPalette && now > visPaletteSettleUntil) return visPalette;
    if (!visPalette && now < visPaletteRetryAt) return null;   // 一直取不到：退避，别每 350ms 扫一遍背景
    if (now - visPaletteAt < 350) return visPalette;
    visPaletteAt = now;

    /* 分级取色，越靠前越理想：
       ① App 自己的 --color-base-* 调色板（服务端按封面算好的，最准且有颜色）
       ② 封面像素里的鲜艳色（跨域画布会失败）
       ③ 背景里最鲜艳的那层（背景被我们清掉时拿不到）
       ④ 封面自身的高对比组合 —— 黑白封面走这条，得到灰白而不是掉回蓝白
       ⑤ 面积最大的那层背景
       取到的颜色再提纯一次饱和度（灰阶不受影响）。 */
    var pair = null, source = '';
    if (!pair) { pair = paletteFromThemeVars(24); source = '主题色'; }
    if (!pair) { pair = paletteFromCover(28); source = '封面'; }
    if (!pair) { pair = paletteFromBackground(true); source = '背景'; }
    if (!pair) { pair = paletteFromCover(0); source = '封面(灰阶)'; }
    if (!pair) { pair = paletteFromBackground(false); source = '背景(灰阶)'; }

    if (pair) {
      pair = [punch(pair[0], 1.35), punch(pair[1], 1.35)];
      if (visPalette && pairDiff(visPalette, pair) < 60) pair = visPalette;   // 变化太小就别换
      visPalette = pair;
      visPaletteRetryAt = 0;
    } else if (!visPalette) {
      visPaletteRetryAt = now + 3000;
    }
    /* 取不到就保留上一次：切歌瞬间、页面重建都会短暂失败，
       以前这里直接清空并回落蓝白，视觉上就是「闪一下蓝」。 */
    var desc = pair
      ? (source + ' ' + rgbToCss(pair[0]) + ' → ' + rgbToCss(pair[1]))
      : (visPalette ? '本次取色失败，沿用上一次' : '取色失败，沿用蓝白');
    if (desc !== visPaletteLog) {
      visPaletteLog = desc;
      logDbg('频谱配色: ' + desc);
    }
    return visPalette;
  }

  /* 环形柱状：从内半径向外长，柱子快起慢落 */
  function drawRing(L) {
    var g = vis2d, W = L.W;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.translate(W / 2, W / 2);

    var r0 = L.inner, ring = L.ring;
    var usable = Math.floor(visData.length * 0.62);   // 高频基本是空的
    if (!visSmooth || visSmooth.length !== VIS_BARS) visSmooth = new Float32Array(VIS_BARS);

    /* 柱宽按周长与柱数换算，留出 40% 空隙，别糊成一圈 */
    var spacing = (2 * Math.PI * (r0 + ring / 2)) / VIS_BARS;
    g.lineWidth = Math.max(1, Math.min(spacing * 0.6, 2.6 * L.dpr));
    g.lineCap = 'round';
    g.lineJoin = 'round';

    /* 内外两档颜色来自背景 / 封面的取色；取不到才回退到原来的蓝白。
       背景色通常偏暗，统一往白色提一点，保证在深色底上看得清。 */
    var grad = g.createRadialGradient(0, 0, r0, 0, 0, r0 + ring);
    var pal = refreshVisPalette();
    if (pal) {
      grad.addColorStop(0, rgbToCss(lighten(pal[0], 0.2)));
      grad.addColorStop(0.6, rgbToCss(lighten(pal[1], 0.35)));
      grad.addColorStop(1, rgbToCss(lighten(pal[1], 0.55)));
    } else {
      grad.addColorStop(0, 'rgba(124,207,255,1)');
      grad.addColorStop(0.6, 'rgba(190,235,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,1)');
    }
    g.strokeStyle = grad;

    for (var i = 0; i < VIS_BARS; i++) {
      var v = visData[Math.floor(i / VIS_BARS * usable)] / 255;
      v = v * 0.55 + v * v * 0.45;
      var cur = visSmooth[i];
      visSmooth[i] = v > cur ? cur + (v - cur) * 0.5 : cur + (v - cur) * 0.12;
      var len = (2 + visSmooth[i] * ring) * L.dpr;
      var a = -Math.PI / 2 + (i / VIS_BARS) * Math.PI * 2;
      var ca = Math.cos(a), sa = Math.sin(a);

      g.globalAlpha = 0.32 + 0.68 * Math.min(1, visSmooth[i] * 1.7);
      g.beginPath();
      g.moveTo(ca * (r0 + 1.5 * L.dpr), sa * (r0 + 1.5 * L.dpr));
      g.lineTo(ca * (r0 + len), sa * (r0 + len));
      g.stroke();
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------- 只在「正在播放」详情页显示 ---------- */

  /* 详情页判定直接复用 playerBoxRoot()（定义见「滚轮切歌」一节）：
     它是 PlayerBoxAudioFrame 的根 div.container[data-v-b8d357b5] / 歌词容器，
     详情页没打开时节点不存在或不可见。
     注意不能用 .fullscreen-player —— 那是外层布局的常驻容器，任何页面都在。
     歌单 / 榜单 / 推荐流等页面同样有大尺寸正方形封面，会被 coverEl() 当成播放页封面，
     所以必须先过这道页面闸门。 */
  var visPageOn = null;   // null = 尚未判定过，保证第一次一定写一行日志

  function onPlayerPage() {
    var root = playerBoxRoot();
    if (!root) return false;
    try {
      var r = root.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }

  /* 每帧朝目标不透明度逼近：回到播放页自然渐显，离开 / 静音时渐隐。
     按真实时间差推进而不是固定每帧步长，120Hz 屏幕上速度也一样。 */
  function visFadeTo(target) {
    var now = Date.now();
    var dt = visFadeAt ? Math.min(64, now - visFadeAt) : 16;
    visFadeAt = now;
    var step = dt / VIS_FADE_MS;
    if (visAlpha < target) visAlpha = Math.min(target, visAlpha + step);
    else if (visAlpha > target) visAlpha = Math.max(target, visAlpha - step);

    var s = visAlpha >= 0.999 ? '1' : (visAlpha < 0.002 ? '0' : visAlpha.toFixed(3));
    if (visHost.style.opacity !== s) visHost.style.opacity = s;
  }

  function renderVis() {
    visRaf = 0;
    if (!spectrumOn) return;
    if (visHost && !visHost.isConnected) {   // 页面重挂 body 时画布会被清掉，重建
      visHost = null; visCanvas = null; vis2d = null;
      visPos = { x: -1, y: -1, s: -1 };
    }
    if (!visHost || !vis2d) ensureVis();

    /* 不在详情页：直接隐藏，不采样也不画；回到详情页后下一帧自动恢复 */
    var onPage = onPlayerPage();
    if (onPage !== visPageOn) {
      visPageOn = onPage;
      if (onPage) visAlpha = 0;   // 每次回到播放页都从全透明开始，保证一定有渐显
      logDbg('频谱: ' + (onPage
        ? '已进入播放页，恢复显示'
        : '不在播放页（hash=' + String(location.hash || '(空)') + '），隐藏'));
    }
    if (!onPage) {
      visFadeTo(0);   // 离开播放页：渐隐（画布保留上一帧内容一起淡下去）
      visRaf = requestAnimationFrame(renderVis);
      return;
    }

    if (!visAnalyser) { visAlpha = 0; visHost.style.opacity = '0'; return; }

    if (!visData || visData.length !== visAnalyser.frequencyBinCount) {
      visData = new Uint8Array(visAnalyser.frequencyBinCount);
      visSmooth = null;
    }
    visAnalyser.getByteFrequencyData(visData);

    var sum = 0;
    for (var q = 0; q < visData.length; q++) sum += visData[q];
    var loud = sum / visData.length > 0.4;
    if (loud && !visGotData) { visGotData = true; logDbg('频谱: 已采到音频数据'); }
    visIdle = loud ? 0 : visIdle + 1;
    /* 回到播放页时从这里渐显（visAlpha 从 0 涨到 1）；静音时淡出，别留一圈死柱子 */
    visFadeTo(visIdle > 40 ? 0 : 1);

    /* 定位优先级：封面右下角的图标 → 标定偏移（每帧实时跟随封面，无缓存滞后） */
    var anchor = findLikeAnchor(false);
    var box = null, how = '';
    if (anchor) {
      try { box = anchor.getBoundingClientRect(); } catch (e) { box = null; }
      if (box && box.width > 0) how = '图标';
      else box = null;
    }
    if (!how) {
      box = geoBox();
      if (box) how = '标定偏移';
    }
    if (how !== visAnchorHow) {
      logDbg('频谱来源: ' + (how || '(没定位到封面右下)') +
        (visAnchorDist >= 0 ? (' 距封面右下=' + Math.round(visAnchorDist) + 'px') : ''));
    }
    visAnchorHow = how;
    if (how && box && box.width > 0) drawRing(layoutVis(box));
    else visFadeTo(0);   // 定位不到封面右下角（比如切页途中）：渐隐而不是硬切
    visRaf = requestAnimationFrame(renderVis);
  }

  /* 建立/唤醒频谱：开关打开、拿到新音源、启动时都走这里 */
  function startVis() {
    if (!spectrumOn) return;
    ensureVis();
    visIdle = 0;
    /* 不在这里直接点亮：是否可见统一交给 renderVis 判断（非播放页必须保持隐藏） */
    if (!visRaf) visRaf = requestAnimationFrame(renderVis);
  }

  function setSpectrum(on) {
    spectrumOn = !!on;
    ls(CFG.visKey, spectrumOn ? '1' : '0');
    if (spectrumOn) {
      startVis();
      if (!visAnalyser) logDbg('频谱: 还没接管到 AudioContext，出声后会自动出现');
    } else {
      if (visRaf) { cancelAnimationFrame(visRaf); visRaf = 0; }
      if (visHost) { visAlpha = 0; visHost.style.opacity = '0'; }
    }
    renderPopup();
  }

  /* 频谱配色开关：只切换取色，不重启频谱。清掉缓存后下一帧就按新开关重画 */
  function setSpectrumColor(on) {
    spectrumColorOn = !!on;
    ls(CFG.visColorKey, spectrumColorOn ? '1' : '0');
    visPalette = null;
    visPaletteKey = '';
    visPaletteAt = 0;
    visPaletteSettleUntil = 0;
    visPaletteRetryAt = 0;
    logDbg('频谱配色: ' + (spectrumColorOn ? '跟随背景（取色）' : '固定蓝白'));
    renderPopup();
  }

  /* 频谱排障：把音频架构与频谱自身状态一次性写进 %TEMP%\soda-mod.log */
  function diagAudio(tag) {
    var els = allMedia();
    var playing = 0;
    for (var i = 0; i < els.length; i++) if (!els[i].paused) playing++;
    var info = {
      ctx: (window.__sodaAudioContexts || []).length,
      abs: (window.__sodaABSNodes || []).length,
      worklet: (window.__sodaWorklets || []).join(',') || '(无)',
      media: els.length,
      playing: playing,
      analyser: visAnalyser ? visAnalyser.constructor.name : '(无)',
      raf: visRaf ? 1 : 0,
      opacity: visHost ? visHost.style.opacity : '(未建)',
      size: visCanvas ? (visCanvas.width + 'x' + visCanvas.height) : '-',
      anchor: visAnchor ? (visAnchor.tagName + ' ' + classOf(visAnchor).split(/\s+/)[0] +
        ' ' + Math.round(visAnchor.getBoundingClientRect().width) + 'px') : '(未找到)',
      how: visAnchorHow || '-',
      dist: Math.round(visAnchorDist),
      peak: -1
    };
    if (visAnalyser) {
      try {
        var buf = new Uint8Array(visAnalyser.frequencyBinCount);
        visAnalyser.getByteFrequencyData(buf);
        info.peak = 0;
        for (var j = 0; j < buf.length; j++) if (buf[j] > info.peak) info.peak = buf[j];
      } catch (e) { info.peak = -1; }
    }
    logDbg('诊断[' + tag + '] ' + JSON.stringify(info));

    /* 锚点候选：万一定位错了，这里能看到真正的那个 */
    var cov = coverBox();
    logDbg('封面[' + tag + '] ' + (cov
      ? ('右下=(' + Math.round(cov.right) + ',' + Math.round(cov.bottom) + ')')
      : '(未找到)'));
    var cands = collectAnchors();
    var brief = [];
    for (var k = 0; k < cands.length && k < 6; k++) {
      brief.push({
        i: k,
        cls: cands[k].cls.split(/\s+/)[0] || '-',
        num: cands[k].num || '-',
        size: Math.round(cands[k].rect.width) + 'x' + Math.round(cands[k].rect.height),
        x: Math.round(cands[k].rect.left),
        y: Math.round(cands[k].rect.top),
        score: Math.round(cands[k].score),
        dist: cands[k].dist < 0 ? '-' : Math.round(cands[k].dist),
        d: cands[k].d.slice(0, 24)
      });
    }
    logDbg('锚点候选[' + tag + '] ' + JSON.stringify(brief));
    return info;
  }

  /* 一进「正在播放」详情页就自动记一次诊断，省得盯着 8s/25s 的时间点 */
  var detailDiagAt = 0;
  setInterval(function () {
    if (!spectrumOn) return;
    if (!playerBoxRoot()) return;
    if (Date.now() - detailDiagAt < 20000) return;
    detailDiagAt = Date.now();
    diagAudio('详情页');
  }, 1500);

  /* ================= 睡眠定时器（末尾渐弱淡出） ================= */

  var SLEEP_PRESETS = [0, 15, 30, 60];
  var SLEEP_FADE_MS = 20000;   // 最后 20 秒开始渐弱
  var sleepUntil = 0;
  var sleepTimer = 0;
  var sleepBase = null;        // 渐弱前的原始音量
  var sleepPick = 0;
  var sleepShownSec = -1;

  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function sleepRemainMs() {
    return sleepUntil ? Math.max(0, sleepUntil - Date.now()) : 0;
  }

  function nextSleepMinutes() {
    var i = SLEEP_PRESETS.indexOf(sleepPick);
    return SLEEP_PRESETS[(i + 1) % SLEEP_PRESETS.length];
  }

  /* 播放器藏在 Shadow DOM 里的可能性不大，但 deepScan 更保险 */
  function allMedia() {
    var out = [];
    var list = document.querySelectorAll('audio,video');
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    var deep = deepScan(document, []);
    for (var j = 0; j < deep.length; j++) if (out.indexOf(deep[j]) < 0) out.push(deep[j]);
    return out;
  }

  function eachMediaVolume(v) {
    var els = allMedia();
    for (var i = 0; i < els.length; i++) { try { els[i].volume = v; } catch (e) {} }
  }

  function currentVolume() {
    var els = allMedia();
    for (var i = 0; i < els.length; i++) {
      if (typeof els[i].volume === 'number' && els[i].volume > 0) return els[i].volume;
    }
    return 1;
  }

  function anyPlaying() {
    var els = allMedia();
    for (var i = 0; i < els.length; i++) if (!els[i].paused) return true;
    return false;
  }

  function endSleep() {
    if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = 0; }
    sleepUntil = 0;
    sleepPick = 0;
    sleepShownSec = -1;

    if (anyPlaying()) {
      var wasPlaying = playbarToggle();   // 走 App 自己的播放/暂停逻辑，图标状态不会不同步
      var els = allMedia();
      for (var i = 0; i < els.length; i++) { try { els[i].pause(); } catch (e) {} }
      if (wasPlaying) logDbg('睡眠定时: 已淡出并暂停播放');
    }
    if (sleepBase !== null) { eachMediaVolume(sleepBase); sleepBase = null; }
    renderPopup();
  }

  function sleepTick() {
    var left = sleepRemainMs();
    if (!left) { endSleep(); return; }
    if (left <= SLEEP_FADE_MS) {
      if (sleepBase === null) sleepBase = currentVolume();
      eachMediaVolume(sleepBase * (left / SLEEP_FADE_MS));
    }
    var sec = Math.ceil(left / 1000);
    if (sec !== sleepShownSec) { sleepShownSec = sec; renderPopup(); }
  }

  function setSleep(minutes) {
    if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = 0; }
    if (sleepBase !== null) { eachMediaVolume(sleepBase); sleepBase = null; }
    sleepShownSec = -1;
    sleepPick = minutes;
    if (!minutes) {
      sleepUntil = 0;
      renderPopup();
      return;
    }
    sleepUntil = Date.now() + minutes * 60000;
    sleepTimer = setInterval(sleepTick, 200);
    logDbg('睡眠定时: ' + minutes + ' 分钟后渐弱暂停');
    renderPopup();
  }

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
    + '[data-soda-widgetstyle-row],[data-soda-clearbg-row],[data-soda-cover-row],'
    + '[data-soda-clearbg-card],[data-soda-hiddenbtns-card],[data-soda-fx-card]';

  function isSettingsAboutPage() {
    try {
      var h = String(location.hash || '');
      if (/\/about(\/|\?|$)/i.test(h)) return true;
    } catch (e) { /* ignore */ }
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return false;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    var text = '';
    try { text = (box && box.textContent) || ''; } catch (e) { text = ''; }
    return /营业执照和平台资质|违法和不良信息举报电话|汽水智能客服|客户服务热线/.test(text);
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

  /* ================= 清掉背景绘制（只留文字与控件） ================= */

  var CLEARBG_BASE = 'rgb(18,18,18)';   // App 主窗口自身的底色

  /* 目标：去掉 App 的背景绘制，页面上只剩文字与控件。
     只用「清背景绘制 + 隐藏媒体节点」的写法，不整块 opacity:0 ——
     因为 .background 的尺寸等于整窗，万一它其实是包住全部 UI 的外壳，
     整块隐藏会把歌词也一起干掉；而 img/video/canvas 里不可能装文字，
     隐藏它们一定是安全的。
     透出来的是什么取决于窗口本身：窗口透明就是桌面，否则是窗口底色。 */
  var CLEARBG_STYLE_ID = 'soda-clearbg-style';
  var CLEARBG_CLASS = 'soda-clear-bg';
  var CLEARBG_PAINT_OFF = 'soda-paint-off';
  var CLEARBG_PAINT_FLAT = 'soda-paint-flat';  // 大面积容器：只铺实底，绝不套玻璃（否则切页会透出上一页）
  var CLEARBG_BAR_OFF = 'soda-bar-off';
  var CLEARBG_AMBIENT_OFF = 'soda-ambient-off';
  var CLEARBG_GLASS = 'soda-glass-on';   // 评论区/抽屉/弹层这类「大面板」，由类名关键词+面积扫出来
  var clearBgPaintAt = 0;      // 定时补扫的节流时间戳
  var clearBgGlassAt = 0;      // 毛玻璃面板补扫的节流时间戳
  /* 两种模式并存，由 bgMode 选择：
     · black        —— 近黑实底：根/body 铺不透明近黑，面板铺底色，表面比底下略亮。
                       开启「面板模糊」后表面与评论区/抽屉等大面板改半透明 + backdrop-filter，
                       压在它们下面的页面内容会被糊掉（毛玻璃），半径可调。
     · transparent  —— 玻璃化：根/面板/表面都半透明 + 背景模糊，主窗口透明时能直接看到桌面；
                       窗口不透明时看到的是窗口底色，不会比原来更糟（优雅降级）。
     两种模式共用同一套「清掉 App 自己的绘制」前置规则：
       · .background 外壳与其中的媒体节点隐掉；
       · 氛围层（整屏图片型绘制，即按封面生成的模糊背景）隐掉——否则会像一张大照片糊在所有页面上；
       · 空心细长条（歌词占位骨架条）去掉绘制。
     不透明度滑块两种模式都生效（black 模式下控制表面的亮度）；
     面板模糊滑块两种模式都生效（black 模式下 0 = 回到实底）。 */
  function blurDecl(px) {
    return 'backdrop-filter:blur(' + px + 'px) saturate(1.15) !important;'
      + '-webkit-backdrop-filter:blur(' + px + 'px) saturate(1.15) !important;';
  }

  function clearBgCss() {
    /* 共用的前置规则：先把 App 自己的背景绘制清干净 */
    var head = ''
      + 'html.' + CLEARBG_CLASS + ',html.' + CLEARBG_CLASS + ' body,html.' + CLEARBG_CLASS + ' #app{'
      + 'background:transparent !important;}'
      + 'html.' + CLEARBG_CLASS + ' .background{background:transparent !important;box-shadow:none !important;'
      + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}'
      + 'html.' + CLEARBG_CLASS + ' .background > *{background-image:none !important;box-shadow:none !important;}'
      + 'html.' + CLEARBG_CLASS + ' .background img,'
      + 'html.' + CLEARBG_CLASS + ' .background canvas,html.' + CLEARBG_CLASS + ' .background picture{opacity:0 !important;}'
      + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_AMBIENT_OFF + '{background:none !important;box-shadow:none !important;}'
      + 'html.' + CLEARBG_CLASS + ' img.' + CLEARBG_AMBIENT_OFF + ',html.' + CLEARBG_CLASS + ' video.' + CLEARBG_AMBIENT_OFF + ','
      + 'html.' + CLEARBG_CLASS + ' canvas.' + CLEARBG_AMBIENT_OFF + ',html.' + CLEARBG_CLASS + ' picture.' + CLEARBG_AMBIENT_OFF + '{opacity:0 !important;}'
      + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_BAR_OFF + '{background:none !important;box-shadow:none !important;}'
      /* 评论区「展开 / 回复」：App 在折叠评论底部盖一条 22px 高的 rgb(var(--color-base-8))
         实色条（颜色取自封面），清掉背景后就是一块突兀的彩色方块。
         这条实色原本正好压住正文第 11 行（行高 22px、容器 242px = 11 行），
         直接透明会把那行字露在按钮底下，所以改成：
           · 容器固定 242px，正文自己只排 10 行（220px），第 11 行空出来
           · 遮罩底色透明 —— 按钮正好落在空出来的那一行，没有色块也没有残字
         :has 用来只对「确实出现展开条」的评论生效。 */
      + 'html.' + CLEARBG_CLASS + ' .comment-block-container.collapsed .main-content:has(.main-content-expand-mask){'
      + 'height:242px !important;max-height:242px !important;}'
      + 'html.' + CLEARBG_CLASS + ' .main-content:has(.main-content-expand-mask) .main-content-text{'
      + 'display:block !important;max-height:220px !important;overflow:hidden !important;}'
      + 'html.' + CLEARBG_CLASS + ' .main-content-expand-mask{background-color:transparent !important;'
      + 'background-image:none !important;box-shadow:none !important;}'
      + 'html.' + CLEARBG_CLASS + ' .main-content-expand-mask:before{background:none !important;}';
    var panels = 'html.' + CLEARBG_CLASS + ' .main,html.' + CLEARBG_CLASS + ' .sidebar,'
      + 'html.' + CLEARBG_CLASS + ' .page,html.' + CLEARBG_CLASS + ' .player-box,'
      + 'html.' + CLEARBG_CLASS + ' .placeholder,html.' + CLEARBG_CLASS + ' .bottom-player{';

    if (bgMode === 'black') {
      /* 近黑实底：面板 = 纯底色；表面 = 底色再提一点（滑块给亮度），加发丝描边。
         窗口本身是 transparent（主进程补丁），所以黑底必须由页面自己画，
         否则面板之间的缝隙会漏出桌面。

         注意实底铺在 #app 上，不铺 html/body：
         根元素 html 的背景会被提升成「画布背景」，而画布背景不受 html 的 clip-path 裁剪，
         结果就是窗口圆角被这层实底重新填成方角（原样/透明模式没有这层实底，所以圆角正常）。
         body 背景在 html 背景为透明时同样会被传播到画布，同样不能用。 */
      var v = Math.round(18 + (255 - 18) * surfaceAlpha * 0.08);
      var solid = 'rgb(' + v + ',' + v + ',' + v + ')';
      var edge = 'box-shadow:inset 0 0 0 1px rgba(255,255,255,'
        + (0.02 + surfaceAlpha * 0.06).toFixed(3) + ') !important;';
      var base = 'html.' + CLEARBG_CLASS + ',html.' + CLEARBG_CLASS + ' body{'
        + 'background:transparent !important;}'
        + 'html.' + CLEARBG_CLASS + ' #app{background:' + CLEARBG_BASE + ' !important;}';
      var flat = 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_FLAT + '{';

      if (!(panelBlur > 0)) {
        /* 毛玻璃关闭：维持原来的实底，表面纯色、面板纯底色 */
        return head + base
          + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_OFF + '{background-color:' + solid
          + ' !important;background-image:none !important;' + edge + '}'
          + flat + 'background:' + CLEARBG_BASE + ' !important;box-shadow:none !important;}'
          + panels + 'background:' + CLEARBG_BASE + ' !important;box-shadow:none !important;}';
      }

      /* 毛玻璃开启：表面/小面板改成半透明 + backdrop-filter，
         压在这些层下面的内容（例如评论抽屉底下的歌单）会被糊掉；
         评论区/抽屉/弹层这类没有固定类名的「大面板」由 scanGlassPanels 打上
         CLEARBG_GLASS 标记，再套同一层玻璃。

         但「整屏容器」（.main / .page / .bottom-player / .sidebar / .player-box / .placeholder）
         必须保持不透明实底、且不挂 backdrop-filter：
         它们背后只有 #app 的黑底，玻璃没有视觉收益；而路由切换时新旧页面会短暂共存，
         容器一透明就透出上一页，再叠上整屏模糊就是「旧页残影 + 双播放条 + 整屏发糊」。
         这条规则写在「表面」规则之后，同特异性覆盖它。 */
      var glass = blurDecl(panelBlur);
      var surfA = clamp(0.35 + surfaceAlpha * 0.55, 0, 1).toFixed(3);
      return head + base
        + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_OFF + '{background-color:rgba(' + v + ',' + v + ',' + v + ','
        + surfA + ') !important;background-image:none !important;' + glass + edge + '}'
        + flat + 'background:' + CLEARBG_BASE + ' !important;box-shadow:none !important;'
        + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}'
        + panels + 'background:' + CLEARBG_BASE + ' !important;box-shadow:none !important;'
        + 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}'
        + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_GLASS + '{background-color:rgba(' + v + ',' + v + ',' + v + ','
        + surfA + ') !important;background-image:none !important;' + glass + '}';
    }

    /* 透明模式：面板半透明 + 模糊；表面更透一点 + 发丝描边；
       大面积容器同样只做半透明、不挂 backdrop-filter（整屏模糊 == 切页残影）。

       弹窗（支付 / VIP）只把「最外层底板」做成半透明，内部元素一律不动：
       内部一旦半透明 + 模糊，就会露出弹窗自己的内容副本（重影）。
       所以这里只针对 markDialogRoots() 打出来的 .soda-dialog-root。 */
    var a = surfaceAlpha;
    var blur = panelBlur > 0 ? blurDecl(panelBlur) : '';
    var flatA = 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_FLAT + '{';
    return head
      + 'html.' + CLEARBG_CLASS + ' .' + CLEARBG_PAINT_OFF + '{background-color:rgba(18,18,18,'
      + (a * 0.6).toFixed(3) + ') !important;background-image:none !important;' + blur
      + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06) !important;}'
      + flatA + 'background:rgba(18,18,18,' + a.toFixed(3) + ') !important;box-shadow:none !important;}'
      + panels + 'background:rgba(18,18,18,' + a.toFixed(3) + ') !important;box-shadow:none !important;' + blur + '}'
      + 'html.' + CLEARBG_CLASS + ' .' + DIALOG_ROOT_CLASS + '{background-color:rgba(18,18,18,'
      + a.toFixed(3) + ') !important;}';
  }

  /* 视频音乐（MV）的画面是「内容」，不是背景绘制：既不能被清掉，也不该被玻璃化。
     之前按面积把它当成「氛围层」隐掉了，结果视频背景模式下 MV 区域整块变透明。
     判据：<video> 本身 / 类名带 video、mv 的容器 / 内部含 <video> 的容器
     （querySelector 只在面积 ≥5% 视口的元素上做，避免整页遍历拖慢）。
     canvas 不能一概排除：App 的氛围背景也是 canvas 画的。 */
  function isVideoContent(el, area, vw, vh) {
    if (el.tagName === 'VIDEO') return true;
    var cls = ((el.className && String(el.className)) || '') + ' ' + (el.id || '');
    if (cls !== ' ' && /video|mv-?player|\bmv\b/i.test(cls)) return true;
    if (area >= vw * vh * 0.05 && el.querySelector && el.querySelector('video')) return true;
    return false;
  }

  /* 支付 / VIP 这类弹窗自带背景层和层级（.purchase、.offer-list、二维码等），
     把它们半透明化 + 模糊，会露出弹窗自己的内容副本，整块变成重影。
     所以整块跳过，任何清理/玻璃化都不碰。 */
  var DIALOG_SEL = '[class*="dialog"],[class*="modal"],[class*="popup"],[class*="purchase"],'
    + '[class*="vip"],[class*="qrcode"],[class*="offer"],[class*="payment"]';
  var DIALOG_ROOT_CLASS = 'soda-dialog-root';   // 弹窗最外层底板（透明模式下单独半透明化）
  var dialogRootAt = 0;

  function isDialogArea(el) {
    return !!(el && el.closest && el.closest(DIALOG_SEL));
  }

  /* 挑出弹窗里「够大的底板」打标记（排除 vip 徽标这类小东西）。
     之前限定「父级不能再属于弹窗区域」，结果弹窗外面还包着一层 .vip-xxx 容器时，
     真正的底板也被判成内层而跳过，整块弹窗就一点透明度都没有。
     现在按面积挑：弹窗里每一块够大的纯色底板都做半透明，层层透下来，
     视觉上就是「玻璃弹窗」；不做模糊，所以不会出现内容副本。 */
  function markDialogRoots() {
    var now = Date.now();
    if (now - dialogRootAt < 2500) return;
    dialogRootAt = now;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return;
    var list;
    try { list = document.querySelectorAll(DIALOG_SEL); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el || !el.classList || el.classList.contains(DIALOG_ROOT_CLASS)) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e2) { continue; }
      if (r.width * r.height < vw * vh * 0.05) continue;        // 小徽标不算
      el.classList.add(DIALOG_ROOT_CLASS);
    }
  }

  /* 清掉铺满视口的背景绘制：这类元素只可能是背景 / 根容器，不可能是按钮面板，
     所以清它是安全的。先只读收集候选、再统一写入，避免读写交错反复触发重排。
     走得通说明纯色是 DOM 画的；一处都扫不到，说明那是窗口自身的底色（CSS 管不到）。 */
  function clearViewportPaints() {
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return 0;

    var nodes;
    try { nodes = document.querySelectorAll('body, body *'); } catch (e) { return 0; }   // 底色可能画在 #app 之外

    /* 规则按「绘制类型」区分大小：
       · 纯色底 —— 门槛 1.5% 视口。评论输入框这类「表面」都在这条线上；
         再小的（播放按钮、角标、标签）是图标控件，清了会让图标在纯黑上看不见，所以放过。
       · 渐变 / 图片底 —— 仍要求够大（8% 视口），免得把卡片上的装饰渐变也抹了。
       带 url() 的背景一律不动：那是封面之类的图片内容，不是底色。 */
    var minArea = vw * vh * 0.015;
    var gradientMinArea = vw * vh * 0.08;
    var targets = [];
    var flats = [];
    var bars = [];
    var ambient = [];
    for (var i = 0; i < nodes.length && i < 4000; i++) {
      var el = nodes[i];
      /* html/body 不参与标记：
         · 它们的背景会被提升成「画布背景」，不受窗口圆角的 clip-path 裁剪（会把圆角填成方角）；
         · 它们已经被 head 规则统一设成 transparent，整窗实底由 #app 负责；
         · 给它们套半透明 + backdrop-filter 等于把整页做成玻璃层，
           路由切换时新旧页面共存 → 旧页透出来、整屏发糊，还多一层全屏合成。 */
      if (el.tagName === 'HTML' || el.tagName === 'BODY') continue;
      if (el.classList && (el.classList.contains(CLEARBG_PAINT_OFF) || el.classList.contains(CLEARBG_PAINT_FLAT)
        || el.classList.contains(CLEARBG_BAR_OFF) || el.classList.contains(CLEARBG_AMBIENT_OFF))) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      var area = r.width * r.height;
      if (area < vw * vh * 0.0004) continue;                      // 过小的一律不看（图标 / 角标）
      if (isVideoContent(el, area, vw, vh)) continue;             // MV 画面是内容，跳过
      if (isDialogArea(el)) continue;                             // 支付/VIP 等弹窗整块不动
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      var bgImage = cs.backgroundImage || 'none';
      var tag = el.tagName;

      /* 氛围层：整屏的「图片型」绘制 = App 按封面生成的模糊背景。
         真封面约占 16% 视口，够不到 25% 这条线，所以不会误伤。

         额外的内容保护：<img> 只有在 .background 背景壳里才可能是氛围层。
         评论区图片、歌词页封面这类「内容图」一旦被撑到 25% 视口（点开大图、
         长截图、窗口缩小），就会被误判成氛围层打上 opacity:0 —— 表现就是
         用着用着评论区的图全没了。 */
      var isMedia = tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'PICTURE';
      var inBackdrop = !!(el.closest && el.closest('.background'));
      if (area >= vw * vh * 0.25 && (isMedia || bgImage.indexOf('url(') >= 0)
        && (tag !== 'IMG' || inBackdrop)) {
        ambient.push(el);
        continue;
      }
      if (bgImage.indexOf('url(') >= 0) continue;                 // 封面等图片内容，不动

      var solidPaint = !!cs.backgroundColor
        && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
        && cs.backgroundColor !== 'transparent';
      if (!solidPaint && !(bgImage !== 'none' && area >= gradientMinArea)) continue;

      /* 空心细长条 = 歌词占位骨架条这类装饰。它们原本靠封面的模糊图当底才不显眼，
         换成纯色底后就会变成一条条明显色条，所以单独一档把绘制整个去掉。
         判据「无文字 + 无子元素 + 又细又长」，并排除播放条内部 ——
         进度条轨道也是空的长条，不能误伤。 */
      var thinEmpty = r.height > 0 && r.height < 30 && r.width > 120
        && (!el.textContent || !el.textContent.replace(/\s+/g, ''))
        && el.children.length === 0
        && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SELECT'
        && !(el.closest && el.closest('.bottom-player'));
      if (solidPaint && thinEmpty) { bars.push(el); continue; }

      if (area < minArea) continue;
      /* 大面积容器（≥40% 视口）单独归类：只铺实底，毛玻璃模式下也不做半透明/模糊。
         它们背后就是 #app 的黑底，玻璃没收益；而路由切换时新旧页面共存，
         一透明就透出上一页，再叠整屏模糊就是残影/错位。 */
      if (area >= vw * vh * 0.4) { flats.push(el); continue; }
      targets.push(el);
    }

    var names = [];
    for (var k = 0; k < targets.length; k++) {
      var t = targets[k];
      t.classList.add(CLEARBG_PAINT_OFF);
      names.push(t.tagName + '.' + (String(t.className || '').split(/\s+/)[0] || '-'));
    }
    var flatNames = [];
    for (var f = 0; f < flats.length; f++) {
      flats[f].classList.add(CLEARBG_PAINT_FLAT);
      flatNames.push(flats[f].tagName + '.' + (String(flats[f].className || '').split(/\s+/)[0] || '-'));
    }
    var barNames = [];
    for (var m = 0; m < bars.length; m++) {
      bars[m].classList.add(CLEARBG_BAR_OFF);
      barNames.push(bars[m].tagName + '.' + (String(bars[m].className || '').split(/\s+/)[0] || '-'));
    }
    var ambNames = [];
    for (var n = 0; n < ambient.length; n++) {
      ambient[n].classList.add(CLEARBG_AMBIENT_OFF);
      ambNames.push(ambient[n].tagName + '.' + (String(ambient[n].className || '').split(/\s+/)[0] || '-'));
    }
    if (names.length || barNames.length || ambNames.length || flatNames.length) {
      var brief = names.slice(0, 8).join(', ') + (names.length > 8 ? (' …共 ' + names.length + ' 处') : '');
      logDbg('背景清理: 表面 ' + names.length + ' 处[' + brief + '] 大容器 ' + flatNames.length +
        ' 处[' + flatNames.slice(0, 4).join(', ') + '] 空心条 ' + barNames.length +
        ' 处[' + barNames.slice(0, 6).join(', ') + '] 氛围层 ' + ambNames.length +
        ' 处[' + ambNames.slice(0, 4).join(', ') + ']');
    }
    return names.length + barNames.length + flatNames.length;
  }

  /* 评论区 / 抽屉 / 弹层这类「大面板」没有能钉死的类名，用「类名关键词 + 面积」兜底识别，
     打上 CLEARBG_GLASS 交给黑底模式的毛玻璃规则。只在真的需要糊的时候扫，并设数量上限，
     免得整页元素都挂上 backdrop-filter 把 GPU 吃满。
     面积门槛 3% 视口：评论里的小卡片也叫 comment，但它们糊了没意义；
     超过 90% 视口的大容器背后没有东西可糊，跳过。 */
  /* 只认评论区/抽屉这类「背后压着内容」的面板。
     弹窗（modal/dialog/popup/sheet）不在此列：它们自带背景与层级，
     再套一层半透明 + 模糊就是一团重影（见 DIALOG_SEL 的说明）。 */
  var GLASS_HINTS = ['comment', 'reply', 'drawer', 'panel'];
  function scanGlassPanels() {
    if (bgMode === 'off' || !(panelBlur > 0)) return 0;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return 0;
    var nodes;
    try { nodes = document.querySelectorAll('body *'); } catch (e) { return 0; }

    var found = [];
    for (var i = 0; i < nodes.length && i < 4000; i++) {
      var el = nodes[i];
      if (el.classList && el.classList.contains(CLEARBG_GLASS)) continue;
      var name = ((el.className && String(el.className)) || '') + ' ' + (el.id || '');
      name = name.toLowerCase();
      var hit = false;
      for (var h = 0; h < GLASS_HINTS.length; h++) {
        if (name.indexOf(GLASS_HINTS[h]) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      var area = r.width * r.height;
      if (area < vw * vh * 0.03 || area > vw * vh * 0.9) continue;
      if (isVideoContent(el, area, vw, vh)) continue;   // MV 播放器不当玻璃面板
      if (isDialogArea(el)) continue;                   // 支付/VIP 弹窗不做玻璃
      found.push(el);
      if (found.length >= 12) break;
    }

    var brief = [];
    for (var k = 0; k < found.length; k++) {
      found[k].classList.add(CLEARBG_GLASS);
      brief.push(found[k].tagName + '.' + (String(found[k].className || '').split(/\s+/)[0] || '-'));
    }
    if (brief.length) logDbg('毛玻璃面板: ' + brief.length + ' 处[' + brief.join(', ') + ']');
    return brief.length;
  }

  function ensureClearBgStyle() {
    var css = clearBgCss();
    var old = document.getElementById(CLEARBG_STYLE_ID);
    if (old && old.isConnected) {
      if (old.textContent !== css) old.textContent = css;   // 参数改了要跟着变
      return;
    }
    var s = document.createElement('style');
    s.id = CLEARBG_STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* 首次开启时把背景层的结构写进日志，方便确认到底遮干净了没有 */
  function describeClearBg() {
    var list = document.querySelectorAll('.background');
    var parts = [];
    for (var i = 0; i < list.length && i < 3; i++) {
      var el = list[i];
      var kids = [];
      for (var k = 0; k < el.children.length && k < 5; k++) {
        var c = el.children[k];
        kids.push(c.tagName + (c.className ? '.' + String(c.className).split(/\s+/)[0] : ''));
      }
      var cs = null;
      try { cs = getComputedStyle(el); } catch (e) { /* ignore */ }
      var paint = 'none';
      if (cs) {
        if (cs.backgroundImage && cs.backgroundImage !== 'none') paint = 'image';
        else if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') paint = cs.backgroundColor;
      }
      parts.push(el.tagName + '.' + (String(el.className || '').split(/\s+/)[0] || '-')
        + ' 绘制=' + paint + ' 子=[' + kids.join(', ') + ']');
    }
    return parts.length ? parts.join(' | ') : '(未找到 .background)';
  }

  function applyClearBg() {
    var root = document.documentElement;
    if (!root) return;
    if (bgMode === 'off') {
      if (root.classList.contains(CLEARBG_CLASS)) {
        root.classList.remove(CLEARBG_CLASS);
        logDbg('背景模式: 原样（不处理）');
      }
      return;
    }
    ensureClearBgStyle();
    if (!root.classList.contains(CLEARBG_CLASS)) {
      root.classList.add(CLEARBG_CLASS);
      logDbg('背景模式: ' + bgMode + ' | ' + describeClearBg());
    }
    var now = Date.now();
    if (now - clearBgPaintAt > 4000) {   // 每 4 秒补扫一次（Vue 重渲染后可能又画上底色）
      clearBgPaintAt = now;
      clearViewportPaints();
    }
    if (now - clearBgGlassAt > 4000) {   // 毛玻璃面板同理：面板重建后标记会丢，定期补
      clearBgGlassAt = now;
      scanGlassPanels();
    }
    /* 透明模式下弹窗底板也要跟着透明（黑底模式保持弹窗原样） */
    if (bgMode === 'transparent') markDialogRoots();
  }

  function setBgMode(mode) {
    bgMode = normBgMode(mode);
    ls(CFG.bgModeKey, bgMode);
    clearBgPaintAt = 0;          // 允许下一轮立刻补扫
    clearBgGlassAt = 0;
    applyClearBg();
    logDbg('背景模式: ' + bgMode);
  }

  /* 三档选择器：原样 / 黑底 / 透明（两种背景样式并存，随时切换） */
  function buildBgModeSeg() {
    ensureFxStyle();
    var seg = document.createElement('div');
    seg.className = 'soda-fx-seg';
    var opts = [['off', '原样'], ['black', '黑底'], ['transparent', '透明']];
    for (var i = 0; i < opts.length; i++) {
      (function (code, label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.setAttribute('data-mode', code);
        if (bgMode === code) b.classList.add('on');
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          setBgMode(code);
          for (var k = 0; k < seg.children.length; k++) {
            seg.children[k].classList.toggle('on', seg.children[k].getAttribute('data-mode') === bgMode);
          }
        });
        seg.appendChild(b);
      })(opts[i][0], opts[i][1]);
    }
    return seg;
  }

  /* ================= 任务栏播控样式（主窗口设置，widget 窗口应用） ================= */

  /* 只写一个 localStorage 键：widget 窗口在另一个文档里，通过 storage 事件立刻收到，
     不需要 IPC。外观的具体样式在脚本开头的 widget 分支里（WIDGET_MBAR_CSS）。 */
  function widgetStyleGet() {
    try { return ls(CFG.widgetStyleKey) === 'musicbar' ? 'musicbar' : 'native'; } catch (e) { return 'native'; }
  }

  function widgetStyleSet(v) {
    ls(CFG.widgetStyleKey, v === 'musicbar' ? 'musicbar' : 'native');
    logDbg('任务栏播控样式: ' + (v === 'musicbar' ? 'MusicBar' : '官方'));
  }

  function buildWidgetStyleSeg() {
    ensureFxStyle();
    var seg = document.createElement('div');
    seg.className = 'soda-fx-seg';
    var opts = [['native', '官方'], ['musicbar', 'MusicBar']];
    var cur = widgetStyleGet();
    for (var i = 0; i < opts.length; i++) {
      (function (code, label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (cur === code) b.classList.add('on');
        b.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          widgetStyleSet(code);
          var all = seg.querySelectorAll('button');
          for (var k = 0; k < all.length; k++) all[k].classList.remove('on');
          b.classList.add('on');
        });
        seg.appendChild(b);
      })(opts[i][0], opts[i][1]);
    }
    return seg;
  }

  function injectWidgetStyleRow() {
    injectNativeRow(
      'data-soda-widgetstyle-row',
      '任务栏播控样式',
      '官方 = 汽水原生迷你播控；MusicBar = 按 MusicBar 源码的尺寸与配色复刻（渐变底、顶部频谱、底部进度、28px 按钮），只换外观不动功能',
      function () { return buildWidgetStyleSeg(); });
  }

  /* 进度调节键固定为小键盘 4 / 6。
     用 e.code 判断物理键位：NumLock 关闭时这两个键的 key 会变成 ArrowLeft/Right，
     但 code 仍然是 Numpad4/Numpad6，所以关不关 NumLock 都能用，也不会误吃方向键。 */
  function seekKeyDir(e) {
    var code = (e && e.code) || '';
    if (code === 'Numpad4') return -1;
    if (code === 'Numpad6') return 1;
    return 0;
  }

  /* 任务栏播控是独立窗口，拿不到音频流，所以由主窗口把「频谱 + 进度」快照写进 localStorage
     （同源、跨窗口；widget 那边靠 storage 事件即时收到）。只在 MusicBar 样式下推送。 */
  var widgetPushBuf = null;
  var widgetVisBuf = null;
  var widgetPushAt = 0;
  var playlistCtx = false;     // 是否「从歌单里放歌」（决定模式按钮 2 档还是 3 档）

  var widgetColors = null;
  var widgetPair = null;      // 未压暗的那一对，用来做抖动抑制
  var widgetColorAt = 0;
  var widgetHeavyAt = 0;

  /* 和「圆形频谱」用同一套配色：
     · 主源就是频谱正在用的 visPalette（refreshVisPalette 内部：背景渐变 → 封面 6x6 → 兜底），
       换封面 / 每隔几秒都会重算，所以两边颜色永远一致；
     · 频谱取色被关掉时，visPalette 为空，这里自己按同样顺序算一次。
     只做 0.9 秒节流，取不到就沿用上一次的颜色。 */
  var widgetColorSrc = '';

  function widgetPaletteColors() {
    var now = Date.now();

    /* 先看封面有没有换：换了就立刻重算，不等节流（这是「不同步」的主要来源） */
    var el = null;
    var img = null;
    var src = '';
    try {
      el = coverEl();
      img = el && (el.tagName === 'IMG' ? el : (el.querySelector ? el.querySelector('img') : null));
      src = (img && (img.currentSrc || img.src)) || '';
    } catch (e) { src = ''; }

    var changed = !!(src && src !== widgetColorSrc);
    if (!changed) {
      if (now - widgetColorAt < 300) return widgetColors;
      if (now - widgetHeavyAt < 1000) return widgetColors;   // 没换歌时，重取色限频 1 秒
    }
    widgetColorAt = now;
    widgetHeavyAt = now;
    if (src) widgetColorSrc = src;

    /* 优先级和圆形频谱一致：App 的主题调色板 → 封面像素 → 背景渐变 */
    var pair = null;
    try { pair = paletteFromThemeVars(28); } catch (e) { pair = null; }
    if (!pair || pair.length < 2) {
      try { pair = paletteFromCover(28); } catch (e) { pair = null; }
    }
    if (!pair || pair.length < 2) {
      try { pair = paletteFromBackground(true); } catch (e) { pair = null; }
    }
    if (!pair || pair.length < 2) {
      try { pair = paletteFromBackground(false); } catch (e) { pair = null; }
    }
    if (!pair || pair.length < 2) {
      try { pair = visPalette; } catch (e) { pair = null; }
    }
    if (!pair || pair.length < 2) return widgetColors;   // 取不到就沿用上一次，别闪

    pair = [punch(pair[0], 1.35), punch(pair[1], 1.35)];
    if (widgetPair && pairDiff(widgetPair, pair) < 60) pair = widgetPair;   // 抖动抑制：别一秒一变
    widgetPair = pair;
    var dim = function (c, k) {
      return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
    };
    widgetColors = [dim(pair[0], 0.62), dim(pair[1], 0.48)];
    return widgetColors;
  }

  function pushWidgetData() {
    if (widgetStyleGet() !== 'musicbar') return;
    var now = Date.now();
    /* 频谱刷新要跟得上，和绘制一样 55ms 推一次 */
    if (now - widgetPushAt < 55) return;
    widgetPushAt = now;

    /* 颜色：函数内部按封面地址缓存 + 0.8 秒节流，换歌后很快跟上 */
    widgetColors = widgetPaletteColors() || widgetColors;

    var p = 0;
    var fill = document.querySelector('.bottom-player .progress .slider-fill');
    var track = document.querySelector('.bottom-player .progress .slider-track');
    if (fill && track) {
      try {
        var fr = fill.getBoundingClientRect();
        var tr = track.getBoundingClientRect();
        if (tr.width > 0) p = fr.width / tr.width;
      } catch (e) { /* ignore */ }
    }
    /* 播放状态：优先看音频上下文，其次看 media 元素，任务栏播控那边靠它切换播放/暂停图标 */
    var playing = false;
    try {
      var actx = visAnalyser && visAnalyser.context;
      if (actx && actx.state === 'running') playing = true;
    } catch (e) { /* ignore */ }
    if (!playing) {
      try {
        var els = allMedia();
        for (var m = 0; m < els.length; m++) {
          if (els[m] && !els[m].paused && els[m].currentTime > 0) { playing = true; break; }
        }
      } catch (e) { /* ignore */ }
    }

    /* 当前是不是「从歌单里放歌」：决定任务栏那个模式按钮有几档
       （普通播放 2 档，歌单内多一个随机）。

       不能只看当前 hash —— 从歌单点开「左封面右歌词」的详情页后 hash 会变成播放页，
       按 hash 判断就会把三档打回两档。所以改成「记住来源」：
       进过歌单就置 true，只有明确回到首页/搜索这些非歌单页才置 false，
       详情页这种中间态沿用上一次的值。 */
    var inPlaylist = false;
    try {
      var hash = location.hash || '';
      if (/playlist|songlist|sheet|album|collect|favorite|my-like/i.test(hash)) {
        playlistCtx = true;
      } else if (/player-feed|home|discover|search|recommend|radio/i.test(hash)) {
        playlistCtx = false;
      }
      inPlaylist = playlistCtx;
    } catch (e) { inPlaylist = playlistCtx; }

    /* 播放模式的真实状态：直接看原生按钮当前的图标（三段路径各对应一档），
       这样在汽水界面里切档位、或者在任务栏那边切，两边都能保持一致 */
    var modeNow = '';
    try {
      var mb = appPlayModeButton();
      var mp = mb && mb.querySelector('svg path');
      var md = (mp && mp.getAttribute('d')) || '';
      if (md.indexOf('M42 19.492') >= 0) modeNow = 'list';
      else if (md.indexOf('M43.995 21.347') >= 0) modeNow = 'one';
      else if (md.indexOf('m37.23 4.516') >= 0) modeNow = 'shuffle';
    } catch (e) { modeNow = ''; }

    /* 频谱：和任务栏那边一样取 26 根，等宽对数分频（MusicBar 也是 FFT 分段 + 80ms 刷新） */
    var v = [];
    if (visAnalyser) {
      try {
        if (!widgetVisBuf || widgetVisBuf.length !== visAnalyser.frequencyBinCount) {
          widgetVisBuf = new Uint8Array(visAnalyser.frequencyBinCount);
        }
        visAnalyser.getByteFrequencyData(widgetVisBuf);
        /* MusicBar 是 100 根条，这里也推 100 个频段（对数分布，低频密一点） */
        for (var vi = 0; vi < 100; vi++) {
          var vidx = Math.floor(Math.pow((vi + 1) / 100, 1.7) * (widgetVisBuf.length * 0.55));
          v.push(widgetVisBuf[Math.min(widgetVisBuf.length - 1, vidx)]);
        }
      } catch (e) { v = []; }
    }

    /* 高潮点：App 原生底部进度条上的 .slider-dot 就是它，
       行内 left 是「占整首的百分比」—— 直接读过来换算成 0~1 推给播控条。 */
    var hot = 0;
    try {
      var dotEl = document.querySelector('.bottom-player .progress .slider-dot');
      if (dotEl) {
        var lf = parseFloat(dotEl.style.left);
        if (isFinite(lf)) hot = Math.max(0, Math.min(1, lf / 100));
      }
    } catch (e) { hot = 0; }

    try {
      ls(CFG.widgetDataKey, JSON.stringify({
        p: Math.round(p * 1000) / 1000,
        h: Math.round(hot * 1000) / 1000,
        c: widgetColors,
        pl: playing ? 1 : 0,
        ctx: inPlaylist ? 1 : 0,
        md: modeNow,
        v: v,
      }));
    } catch (e) { /* ignore */ }
  }

  setInterval(pushWidgetData, 250);

  /* ================= 任务栏播控 → 主窗口命令 ================= */

  /* 任务栏那条上的「播放模式」按钮点了以后，从这边去点 App 自己的按钮。
     汽水没给播放模式按钮暴露类名，只能按 title / aria-label 找；找不到就只保留
     任务栏那边的本地图标状态（日志里会说明）。 */
  /* 汽水源码里这个按钮长这样：
       <div class="button" @click="protocolOf(ServiceId.queue).togglePlayOrder()">
         <ListLoopSvg /> / <SingleLoopSvg /> / <ShuffleSvg />
       它没有 title / aria-label（提示是自定义 FloatingTip），只能按图标认。
       ListLoopSvg 的路径是两段 A8.3 圆弧，特征很稳定。 */
  function appPlayModeButton() {
    /* 1) 结构定位最稳：源码里顺序是「歌词 → 播放模式 → 音量(VolumeBox) → … → 播放队列」，
          音量按钮里一定有 .volume-box-wrapper，取它的前一个按钮就是播放模式 */
    try {
      var vol = document.querySelector('.bottom-player .volume-box-wrapper');
      if (vol) {
        var volBtn = vol.closest('.button');
        var prev = volBtn && volBtn.previousElementSibling;
        if (prev && prev.classList && prev.classList.contains('button')) return prev;
      }
    } catch (e) { /* ignore */ }

    /* 2) 按图标特征：ListLoopSvg 的路径里有这两段独有片段 */
    var cands;
    try { cands = document.querySelectorAll('.bottom-player .button'); } catch (e) { cands = []; }
    for (var i = 0; i < cands.length; i++) {
      var p = cands[i].querySelector('svg path');
      var d = (p && p.getAttribute('d')) || '';
      if (/l6\.363\s*4\.636/.test(d) || /H17v2\.864/.test(d)) return cands[i];
    }

    /* 3) 兜底：右侧工具区里「歌词、播放模式、音量、队列」的第三个 */
    var right = document.querySelector('.bottom-player .controls.actions.actions-right')
      || document.querySelector('.bottom-player .actions-right');
    if (right) {
      var btns = right.querySelectorAll('.button');
      if (btns.length >= 4) return btns[3];
    }
    return null;
  }

  /* 少推荐（不喜欢）：源码在底部条 actions-left，图标是 DisLikeSvg，
     路径以 M10.482 11.405 开头，据此定位原生按钮。 */
  function appDislikeButton() {
    var cands;
    try { cands = document.querySelectorAll('.bottom-player .button'); } catch (e) { return null; }
    for (var i = 0; i < cands.length; i++) {
      var p = cands[i].querySelector('svg path');
      var d = (p && p.getAttribute('d')) || '';
      if (d.indexOf('M10.482 11.405') >= 0) return cands[i];
    }
    return null;
  }

  /* 任务栏进度条 → 原生 slider。start / move / end 三段式，
     点一下是 start+end，按住拖就是 start → move… → end。 */
  var seekActive = false;

  function appSeek(phase, ratio) {
    var track = document.querySelector('.bottom-player .progress .slider-track');
    if (!track) return false;
    var tr;
    try { tr = track.getBoundingClientRect(); } catch (e) { return false; }
    if (!tr || tr.width <= 0) return false;
    var r = Math.max(0, Math.min(1, ratio || 0));
    var x = tr.left + r * tr.width;
    var y = tr.top + tr.height / 2;
    var fire = function (type, buttons) {
      var base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: buttons, which: 1 };
      try {
        track.dispatchEvent(new PointerEvent(type, Object.assign({
          pointerId: 7, pointerType: 'mouse', isPrimary: true
        }, base)));
      } catch (e) { /* ignore */ }
      try {
        track.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse'), base));
      } catch (e) { /* ignore */ }
    };

    if (phase === 'start') {
      fire('pointerdown', 1);
      seekActive = true;
    } else if (phase === 'move') {
      if (!seekActive) { fire('pointerdown', 1); seekActive = true; }
      fire('pointermove', 1);
    } else {
      if (seekActive) fire('pointermove', 1);
      fire('pointerup', 0);
      seekActive = false;
    }
    return true;
  }

  /* ================= 小键盘 ←/→ 微调进度 =================
   *
   * 播控条上的进度条能看能点，键盘调整走这里：Numpad4 / Numpad6
   * （NumLock 关掉时它们就是 ArrowLeft / ArrowRight），每次 ±5 秒。
   *
   * 注意：汽水根本没有 <audio>/<video> 元素（日志里 audio=0 video=0），
   * 播放走 Web Audio，所以「改媒体元素 currentTime」这条路从源头就不成立。
   * 它自己的底部条 .bottom-player 上绑了键盘处理：
   *   左 → protocolOf(player).seekSeconds(progressSeconds - 5)
   *   右 → protocolOf(player).seekSeconds(progressSeconds + 5)
   * 给它派发一个合成按键即可 —— 走 App 自己的 seek 通道，界面、进度、音质全都同步，
   * 窗口最小化时也一样有效（不依赖焦点）。
   */
  var SEEK_STEP = 5;

  function seekBy(delta) {
    var bar = null;
    try { bar = document.querySelector('.bottom-player'); } catch (e) { bar = null; }
    if (!bar) return false;
    var right = delta > 0;
    var times = Math.max(1, Math.round(Math.abs(delta) / SEEK_STEP));
    for (var i = 0; i < times; i++) {
      try {
        bar.dispatchEvent(new KeyboardEvent('keydown', {
          key: right ? 'ArrowRight' : 'ArrowLeft',
          code: right ? 'ArrowRight' : 'ArrowLeft',
          keyCode: right ? 39 : 37,
          which: right ? 39 : 37,
          bubbles: true,
          cancelable: true
        }));
      } catch (e) { return false; }
    }
    return true;
  }

  /* 按一下给个轻提示，免得分不清「没生效」和「跳了但进度条太细看不出来」 */
  var seekTipEl = null;
  var seekTipTimer = 0;

  function showSeekTip(sec) {
    try {
      if (!seekTipEl) {
        seekTipEl = document.createElement('div');
        seekTipEl.id = 'soda-seek-tip';
        seekTipEl.style.cssText = 'position:fixed;left:50%;bottom:96px;'
          + 'transform:translateX(-50%);z-index:2147483000;pointer-events:none;'
          + 'padding:6px 14px;border-radius:16px;background:rgba(20,20,22,.8);color:#fff;'
          + 'font-size:13px;font-weight:500;letter-spacing:.5px;opacity:0;'
          + 'transition:opacity .16s ease;box-shadow:0 4px 16px rgba(0,0,0,.28);';
        document.body.appendChild(seekTipEl);
      }
      seekTipEl.textContent = (sec > 0 ? '快进 ' : '后退 ') + Math.abs(sec) + ' 秒';
      seekTipEl.style.opacity = '1';
      if (seekTipTimer) clearTimeout(seekTipTimer);
      seekTipTimer = setTimeout(function () {
        if (seekTipEl) seekTipEl.style.opacity = '0';
      }, 700);
    } catch (e) { /* ignore */ }
  }

  /* 主进程用（主窗口最小化 / 收进托盘时，键盘事件到不了渲染层，
     由主进程的 globalShortcut 调这个入口） */
  window.__sodaSeekBy = function (d) {
    var ok = seekBy(d);
    if (ok) showSeekTip(d);
    return ok;
  };

  window.addEventListener('storage', function (e) {
    if (!e || e.key !== 'sodaSpeedMod.widgetCmd' || !e.newValue) return;
    var cmd = null;
    try { cmd = JSON.parse(e.newValue); } catch (err) { return; }
    if (!cmd) return;

    if (cmd.t === 'seek') {
      if (!appSeek(cmd.phase || 'end', cmd.r)) logDbg('进度跳转: 没找到进度条');
      return;
    }
    if (cmd.t === 'seekRel') {
      /* 任务栏播控那边按的小键盘 ←/→：按秒数相对跳转 */
      if (!seekBy(cmd.d || 0)) logDbg('进度调节: 没找到可跳转的媒体元素');
      return;
    }
    if (cmd.t === 'dislike') {
      var dbtn = appDislikeButton();
      if (dbtn) {
        try { dbtn.click(); } catch (err) { /* ignore */ }
        logDbg('少推荐: 已转发到原生按钮');
      } else {
        logDbg('少推荐: 没找到原生按钮（应为带 M10.482 11.405 图标那个）');
      }
      return;
    }
    if (cmd.t !== 'mode') return;

    var btn = appPlayModeButton();
    if (btn) {
      try { btn.click(); } catch (err) { /* ignore */ }
      logDbg('播放模式: 已转发到原生按钮');
    } else {
      logDbg('播放模式: 没找到原生按钮（应为 .bottom-player 里带 A8.3 圆弧图标的那个）');
    }
  });

  /* 底部条上没有播放模式按钮（13 个按钮都认过了：圆形头像、音符、麦克风、三点、播放/暂停/下一首、
     音质、音效、分享、收藏、队列），大概率在「播放队列」面板里。
     这里点开队列按钮，把面板里的按钮结构打出来，用来定位真正的模式按钮。 */
  function probeModeButton() {
    var right = document.querySelector('.bottom-player .actions-right');
    var list = right ? right.querySelectorAll('.button') : null;
    var queueBtn = list && list.length ? list[list.length - 1] : null;
    if (!queueBtn) {
      logDbg('播放模式探测: 找不到队列按钮');
      return;
    }
    try { queueBtn.click(); } catch (e) { /* ignore */ }
    setTimeout(function () {
      var panel = document.querySelector('.playlist, .queue, [class*="queue"], [class*="playlist"]');
      if (!panel) {
        logDbg('播放模式探测: 队列面板没出现');
        return;
      }
      var bs = panel.querySelectorAll('button, .button');
      var out = [];
      for (var i = 0; i < bs.length && i < 15; i++) {
        var p = bs[i].querySelector('svg path');
        out.push(i + ' cls="' + String(bs[i].className || '').slice(0, 28)
          + '" path="' + (p ? String(p.getAttribute('d') || '').slice(0, 90) : '-') + '"');
      }
      logDbg('队列面板按钮:\n' + out.join('\n'));
    }, 600);
  }

  /* 找不到播放模式按钮时，把底部所有按钮的 title / aria / 图标路径打出来，
     方便按实际结构去认（汽水的按钮基本不写 title）。 */
  function dumpBottomButtons() {
    var btns;
    try { btns = document.querySelectorAll('.bottom-player .button'); } catch (e) { return; }
    var out = [];
    for (var i = 0; i < btns.length && i < 20; i++) {
      var b = btns[i];
      var svg = b.querySelector('svg');
      var p = b.querySelector('svg path');
      out.push(i
        + ' parent="' + String((b.parentElement && b.parentElement.className) || '').slice(0, 26) + '"'
        + ' cls="' + String(b.className || '').slice(0, 30) + '"'
        + ' viewBox="' + (svg ? (svg.getAttribute('viewBox') || '-') : '-') + '"'
        + ' path="' + (p ? String(p.getAttribute('d') || '').slice(0, 120) : '-') + '"');
    }
    logDbg('底部按钮清单:\n' + out.join('\n'));
  }

  function injectClearBgRow() {
    injectNativeRow(
      'data-soda-clearbg-row',
      '背景模式',
      '原样 = 不动 App 背景；黑底 = 清掉色块铺近黑实底（挡住宿主背景，可用下方「面板模糊」把评论区等面板做成毛玻璃）；透明 = 整层玻璃化，可透出桌面',
      function () { return buildBgModeSeg(); });
  }

  function setSurfaceAlpha(v) {
    surfaceAlpha = clamp(numOr(v, surfaceAlpha), 0, 1);
    ls(CFG.surfaceAlphaKey, String(surfaceAlpha));
    ensureClearBgStyle();
  }

  /* 面板/评论区毛玻璃半径：0 = 关闭（面板回到实底），越大越糊 */
  function setPanelBlur(v) {
    panelBlur = clamp(numOr(v, panelBlur), 0, 60);
    ls(CFG.panelBlurKey, String(panelBlur));
    clearBgGlassAt = 0;          // 允许下一轮立刻重新标记面板
    ensureClearBgStyle();
    scanGlassPanels();
  }

  /* 表面不透明度：0 = 完全透明（能看穿），1 = 完全不透明；面板模糊：评论区等大面板毛玻璃半径 */
  function injectClearBgCard() {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box || box.querySelector('[data-soda-clearbg-card]')) return;
    ensureFxStyle();

    var el = document.createElement('div');
    el.className = 'soda-fx-card';
    el.setAttribute('data-soda-clearbg-card', '1');

    var title = document.createElement('div');
    title.className = 'soda-fx-title';
    title.textContent = '整体不透明度（0 = 全透明）';
    el.appendChild(title);

    el.appendChild(buildFxRange('不透明', 0, 1, 0.05, surfaceAlpha,
      function (v) { setSurfaceAlpha(v); },
      function (v) { return Math.round(v * 100) + '%'; }));

    el.appendChild(buildFxRange('面板模糊', 0, 60, 1, panelBlur,
      function (v) { setPanelBlur(v); },
      function (v) { return v < 1 ? '关' : Math.round(v) + 'px'; }));

    box.appendChild(el);
  }

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

  /* ================= 评论区图片：内嵌查看器 ================= */

  /* 汽水点评论区的图片会新开一个独立窗口（app://resources/imagePreview.asar），
     这里改成就地看：背景模糊、图片居中、右上角关闭、滚轮缩放、拖拽平移、双击复位、Esc 关闭。
     拦截挂在 document 的捕获阶段 —— 比 App 自己的 click 处理更早，stopPropagation 之后
     App 就不会再去创建那个独立窗口了。评论区容器的类名取自 App 的样式表
     （.comment-view-container / .comment-block-container / .comment-item-wrapper …）。 */
  var IV_ID = 'soda-img-viewer';
  var ivZoom = 1, ivX = 0, ivY = 0, ivDrag = null;

  function ensureIvStyle() {
    if (document.getElementById('soda-iv-style')) return;
    var css = ''
      + '#' + IV_ID + '{position:fixed;inset:0;z-index:2147483647;display:none;overflow:hidden;'
      + 'align-items:center;justify-content:center;}'
      /* 遮罩就是一层不透明深色底，不做透视、不做模糊：
         窗口是 transparent 的，backdrop-filter 采样透明区域会当成黑色，
         界面本身又是不透明/半透明面板，怎么调都只会得到一块纯色，不如直接用纯色。 */
      + '#' + IV_ID + ' .soda-iv-mask{position:absolute;inset:0;background:#0a0a0c;}'
      /* App 的全局样式是 img{pointer-events:none}，不显式打开的话图片收不到拖拽/双击，
         点击还会穿透到遮罩上（一点就关）。 */
      + '#' + IV_ID + ' .soda-iv-img{position:relative;max-width:92vw;max-height:88vh;border-radius:8px;'
      + 'box-shadow:0 20px 64px rgba(0,0,0,.55);cursor:grab;user-select:none;-webkit-user-drag:none;'
      + 'pointer-events:auto !important;}'
      + '#' + IV_ID + '.dragging .soda-iv-img{cursor:grabbing;}'
      + '#' + IV_ID + ' .soda-iv-close{position:absolute;top:16px;right:18px;width:36px;height:36px;'
      + 'border:none;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:16px;'
      + 'line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;'
      + 'transition:background .15s ease;}'
      + '#' + IV_ID + ' .soda-iv-close:hover{background:rgba(255,255,255,.28);}';
    var s = document.createElement('style');
    s.id = 'soda-iv-style';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function ivApply() {
    var box = document.getElementById(IV_ID);
    if (!box) return;
    var img = box.querySelector('.soda-iv-img');
    if (img) img.style.transform = 'translate(' + ivX + 'px,' + ivY + 'px) scale(' + ivZoom + ')';
  }

  function closeImageViewer() {
    var box = document.getElementById(IV_ID);
    if (!box) return;
    box.style.display = 'none';
    box.classList.remove('dragging');
    var img = box.querySelector('.soda-iv-img');
    if (img) img.removeAttribute('src');   // 断开图片引用
    ivZoom = 1; ivX = 0; ivY = 0; ivDrag = null;
  }

  function isImageViewerOpen() {
    var box = document.getElementById(IV_ID);
    return !!box && box.style.display !== 'none';
  }

  function openImageViewer(src) {
    ensureIvStyle();
    var box = document.getElementById(IV_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = IV_ID;
      box.innerHTML = '<div class="soda-iv-mask"></div>'
        + '<img class="soda-iv-img" draggable="false" alt="">'
        + '<button class="soda-iv-close" type="button" title="关闭（Esc）">✕</button>';
      document.body.appendChild(box);

      var im = box.querySelector('.soda-iv-img');

      /* 关闭按钮 / 遮罩：在 document 捕获阶段处理，并在原地把事件掐断。
         只靠 viewer 内部的冒泡 stopPropagation 不够 —— App 关评论抽屉的判断常常挂在
         更早的捕获阶段，那样点关闭按钮会被当成「点到抽屉外面」，连评论一起关掉。
         捕获阶段 stopImmediatePropagation 之后，App 完全看不到这次点击。
         注意必须「按下不关、click 才关」：若 pointerdown 就把 viewer 隐藏，
         随后的 click 目标会变成下面的页面元素，照样漏给 App。
         图片上的事件不能这样拦（会把拖拽/双击监听一起掐掉），那边只走冒泡阻止。 */
      function ivBlockClose(e) {
        if (!isImageViewerOpen()) return;
        var t = e.target;
        if (!t || !t.closest || !t.closest('#' + IV_ID)) return;
        if (!t.closest('.soda-iv-close') && !t.closest('.soda-iv-mask')) return;
        e.stopImmediatePropagation();
        if (e.type !== 'click') return;   // 按下阶段不 preventDefault，否则 click 可能不生成
        e.preventDefault();
        closeImageViewer();
      }
      document.addEventListener('pointerdown', ivBlockClose, true);
      document.addEventListener('mousedown', ivBlockClose, true);
      document.addEventListener('click', ivBlockClose, true);

      /* 滚轮缩放：以光标位置为锚点，缩放前后光标下的那个像素保持不动。
         锚点用图片的实际包围盒中心（getBoundingClientRect 已含平移/缩放），
         而不是「视口中心 + 平移量」——图片不在正中心时（拖过、或长宽比极端）那样算会偏。 */
      box.addEventListener('wheel', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var rect = im.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        /* deltaMode: 0=像素 1=行 2=页，统一换算成像素，避免不同设备滚一格跳一大截 */
        var step = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 100 : 1));
        var k = Math.exp(-step * 0.0012);
        var next = Math.min(8, Math.max(0.2, ivZoom * k));
        k = next / ivZoom;
        if (k === 1) return;
        ivX += (e.clientX - cx) * (1 - k);
        ivY += (e.clientY - cy) * (1 - k);
        ivZoom = next;
        ivApply();
      }, { passive: false });

      /* 把 viewer 内部的鼠标事件挡在 viewer 上：App 靠「点到抽屉外面」来关评论区，
         不挡的话点关闭按钮会连评论一起关掉。冒泡阶段停（按钮自身监听先执行）。 */
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']
        .forEach(function (t) {
          box.addEventListener(t, function (e) { e.stopPropagation(); }, false);
        });

      /* 拖拽平移（按住图片拖动） */
      im.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        ivDrag = { x: e.clientX, y: e.clientY, tx: ivX, ty: ivY };
        box.classList.add('dragging');
        try { im.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      im.addEventListener('pointermove', function (e) {
        if (!ivDrag) return;
        ivX = ivDrag.tx + (e.clientX - ivDrag.x);
        ivY = ivDrag.ty + (e.clientY - ivDrag.y);
        ivApply();
      });
      function endDrag() {
        ivDrag = null;
        box.classList.remove('dragging');
      }
      im.addEventListener('pointerup', endDrag);
      im.addEventListener('pointercancel', endDrag);

      /* 双击复位 */
      im.addEventListener('dblclick', function () {
        ivZoom = 1; ivX = 0; ivY = 0;
        ivApply();
      });

      /* Esc 关闭：捕获阶段拦下，别让 App 顺手把评论抽屉也关了 */
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !isImageViewerOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        closeImageViewer();
      }, true);
    }

    var img = box.querySelector('.soda-iv-img');
    ivZoom = 1; ivX = 0; ivY = 0;
    img.src = src;
    ivApply();
    box.style.display = 'flex';
  }

  /* 找出点击处那张「够大的」图片。
     App 的全局样式是 img{pointer-events:none}，所以 e.target 往往是包着图片的 div：
     旧版直接取容器里第一个 img，点到九宫格第二张时拿到的是第一张，尺寸也对不上，
     于是有的图看着没反应。这里改成按点击坐标命中 —— 遍历附近的 img，谁盖住了光标就用谁。
     小图（表情、头像、点赞图标）按 60px 门槛排除。 */
  function findImgAt(x, y, scope) {
    var list;
    try { list = (scope || document).querySelectorAll('img'); } catch (e) { return ''; }
    for (var i = 0; i < list.length; i++) {
      var im = list[i];
      var r;
      try { r = im.getBoundingClientRect(); } catch (e) { continue; }
      if (r.width < 60 || r.height < 60) continue;
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) {
        var s = im.currentSrc || im.src;
        if (s) return s;
      }
    }
    return '';
  }

  function findCommentImgSrc(el, x, y) {
    var scope = el.closest && el.closest('.comment-view-container,.comment-view-scroll-container,'
      + '.comment-block-container,.comment-item-wrapper,.subject-comment-wrapper,.side-panel,'
      + '[class*="comment"],[class*="reply"]');
    if (scope) {
      var src = findImgAt(x, y, scope);
      if (src) return src;

      /* 用 background-image 渲染的图片：从点击处往上找几层 */
      var n = el, depth = 0;
      while (n && n !== scope && depth < 6) {
        var cs = null;
        try { cs = getComputedStyle(n); } catch (e) { cs = null; }
        var bg = cs && cs.backgroundImage;
        if (bg && bg.indexOf('url(') === 0) {
          var m = bg.match(/url\(["']?(.+?)["']?\)/);
          var r2;
          try { r2 = n.getBoundingClientRect(); } catch (e2) { r2 = null; }
          if (m && r2 && r2.width >= 60 && r2.height >= 60) return m[1];
        }
        n = n.parentElement; depth++;
      }
    }
    /* 兜底：光标是 zoom-in 就说明这本来就是「点开看大图」的区域 */
    var style = null;
    try { style = getComputedStyle(el); } catch (e3) { style = null; }
    if (style && style.cursor === 'zoom-in') return findImgAt(x, y, null);
    return '';
  }

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    if (target.closest('#' + IV_ID)) return;      // viewer 自己的按钮各管各的
    var src = findCommentImgSrc(target, e.clientX, e.clientY);
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    logDbg('评论图片: 内嵌查看 ' + src.slice(0, 90));
    openImageViewer(src);
  }, true);

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

  /* ================= 长按隐藏按钮 ================= */

  /* 长按任意按钮 600ms → 它右上角出现红色圆叉，点叉即可把这个按钮隐藏。
     隐藏用 display:none，布局由 App 自己的 flex 让位，后面的元素实时补上来。
     隐藏项按「标签 + 首个类名 + 文本」记进 localStorage，Vue 重渲染后按钮回来了
     也会被重新隐藏；要全部恢复就在控制台执行 __sodaSpeedMod.showHiddenButtons()。 */
  var HIDE_STORE = 'sodaSpeedMod.hiddenButtons';
  var HIDE_MARK_ID = 'soda-hide-mark';
  var HIDE_TARGET_CLASS = 'soda-hide-target';
  var HIDE_TARGET_SEL = 'button,[role="button"],[class*="btn"],[class*="button"]';
  var hideTimer = 0, hidePressEl = null, hidePressPt = null;
  var hideEditEl = null, hideMarkRAF = 0, hideSwallowUntil = 0;
  var hideAppliedEls = [];     // 本轮真正被我们隐藏的元素，恢复时只动这些

  function hideReadList() {
    try {
      var raw = ls(HIDE_STORE);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      /* 只认新格式（key 有 4 段）。旧记录没有序号段，会匹配到一大批同类按钮，
         直接丢掉，免得「恢复」之前一直被打回原形。 */
      return arr.filter(function (k) {
        return typeof k === 'string' && k.split('|').length === 4;
      });
    } catch (e) { return []; }
  }

  function hideWriteList(list) {
    try { ls(HIDE_STORE, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  /* 指纹：标签 + 首个类名 + 文本/aria + 在父级中的序号。
     加序号是因为 App 里大量按钮共用同一个类名（.button / .icon 之类），
     只靠「标签+类名」会把同类按钮全部认成同一个，隐藏一个就会连带隐藏一批。 */
  function hideKeyOf(el) {
    if (!el || !el.tagName) return '';
    var cls = '';
    if (typeof el.className === 'string') {
      var parts = el.className.trim().split(/\s+/).filter(function (c) {
        return c && c.indexOf('soda-') !== 0;
      });
      cls = parts[0] || '';
    }
    var txt = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    if (!txt) txt = (el.textContent || '').replace(/\s+/g, '').slice(0, 12);
    var idx = 0;
    var p = el.parentElement;
    if (p) {
      for (var i = 0; i < p.children.length; i++) {
        if (p.children[i] === el) { idx = i; break; }
      }
    }
    return el.tagName + '|' + cls + '|' + txt + '|' + idx;
  }

  function hideTargetOf(node) {
    var el = node && node.closest ? node.closest(HIDE_TARGET_SEL) : null;
    if (!el) return null;
    if (el.closest('#' + IV_ID + ',#' + HIDE_MARK_ID + ',.soda-fx-card')) return null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return null;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return null; }
    if (r.width < 16 || r.height < 16) return null;
    return el;
  }

  function ensureHideStyle() {
    if (document.getElementById('soda-hide-style')) return;
    var s = document.createElement('style');
    s.id = 'soda-hide-style';
    s.textContent = ''
      + '.' + HIDE_TARGET_CLASS + '{outline:2px dashed rgba(255,64,80,.9) !important;'
      + 'outline-offset:2px;border-radius:4px;}'
      + '#' + HIDE_MARK_ID + '{position:fixed;z-index:2147483647;width:22px;height:22px;'
      + 'border:none;border-radius:50%;background:#e5484d;color:#fff;display:none;'
      + 'align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.45);transform:translate(50%,-50%);}'
      + '#' + HIDE_MARK_ID + ':hover{background:#f25a5f;}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* 叉按钮跟着目标元素走（编辑期间每帧对一次位置，滚动/动画都不会掉队） */
  function hideMarkFollow() {
    var mark = document.getElementById(HIDE_MARK_ID);
    if (!hideEditEl || !mark) { hideMarkRAF = 0; return; }
    var r = hideEditEl.getBoundingClientRect();
    mark.style.left = (r.right - 2) + 'px';
    mark.style.top = (r.top + 2) + 'px';
    hideMarkRAF = window.requestAnimationFrame(hideMarkFollow);
  }

  function stopHideEdit() {
    if (hideEditEl) hideEditEl.classList.remove(HIDE_TARGET_CLASS);
    hideEditEl = null;
    if (hideMarkRAF) { window.cancelAnimationFrame(hideMarkRAF); hideMarkRAF = 0; }
    var mark = document.getElementById(HIDE_MARK_ID);
    if (mark) mark.style.display = 'none';
  }

  function startHideEdit(el) {
    ensureHideStyle();
    stopHideEdit();
    hideEditEl = el;
    el.classList.add(HIDE_TARGET_CLASS);
    hideSwallowUntil = Date.now() + 500;   // 松手那一下的点击不要触发按钮本身

    var mark = document.getElementById(HIDE_MARK_ID);
    if (!mark) {
      mark = document.createElement('button');
      mark.id = HIDE_MARK_ID;
      mark.type = 'button';
      mark.title = '隐藏这个按钮';
      mark.textContent = '✕';
      mark.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var target = hideEditEl;
        if (target) {
          var key = hideKeyOf(target);
          var list = hideReadList();
          if (key && list.indexOf(key) < 0) {
            list.push(key);
            hideWriteList(list);
          }
          target.style.display = 'none';
          hideMarkApplied(target);
          logDbg('已隐藏按钮: ' + key + '（共 ' + list.length + ' 项，设置页可恢复）');
        }
        stopHideEdit();
      });
      document.body.appendChild(mark);
    }
    mark.style.display = 'flex';
    if (!hideMarkRAF) hideMarkRAF = window.requestAnimationFrame(hideMarkFollow);
  }

  /* 按记录重新隐藏（每 1.5s 补一次，抵消 Vue 重建）。
     每个 key 只处理「一处」—— 之前是只要 key 命中就把所有同类元素都隐藏，
     于是一个按钮被隐藏后，类名相同的其他按钮也跟着消失，看起来就是「长按别的按钮没反应」。 */
  function applyHiddenButtons() {
    var list = hideReadList();
    if (!list.length) return;
    var nodes;
    try { nodes = document.querySelectorAll(HIDE_TARGET_SEL); } catch (e) { return; }
    var done = {};
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = hideKeyOf(el);
      if (!key || list.indexOf(key) < 0 || done[key]) continue;
      if (el.style.display === 'none') {
        done[key] = 1;      // 已经隐藏着的那个就是它，这个 key 不再处理别的元素
        hideMarkApplied(el);
        continue;
      }
      done[key] = 1;
      el.style.display = 'none';
      hideMarkApplied(el);
    }
  }

  function hideMarkApplied(el) {
    if (el && hideAppliedEls.indexOf(el) < 0) hideAppliedEls.push(el);
  }

  /* 只恢复「我们隐藏过」的那些，不动 App 自己 display:none 的元素 */
  function showHiddenButtons() {
    var n = 0;
    for (var i = 0; i < hideAppliedEls.length; i++) {
      var el = hideAppliedEls[i];
      if (el && el.style && el.style.display === 'none') {
        el.style.display = '';
        n++;
      }
    }
    hideAppliedEls.length = 0;
    hideWriteList([]);
    logDbg('已恢复隐藏按钮 ' + n + ' 个');
  }

  /* 设置页卡片：显示隐藏了几个按钮 + 一键恢复。没有隐藏项时整张卡片不出现。 */
  function injectHiddenButtonsCard() {
    var sample = document.querySelector('.setting-menu-item');
    if (!sample) return;
    var card = sample.parentElement;
    var box = card && card.parentElement;
    if (!box) return;

    var list = hideReadList();
    var old = box.querySelector('[data-soda-hiddenbtns-card]');
    if (!list.length) {
      if (old && old.parentNode) old.parentNode.removeChild(old);
      return;
    }

    ensureFxStyle();
    if (old) {
      var oldTitle = old.querySelector('.soda-fx-title');
      var want = '隐藏的按钮（' + list.length + ' 个）';
      if (oldTitle && oldTitle.textContent !== want) oldTitle.textContent = want;
      return;
    }

    var el = document.createElement('div');
    el.className = 'soda-fx-card';
    el.setAttribute('data-soda-hiddenbtns-card', '1');

    var title = document.createElement('div');
    title.className = 'soda-fx-title';
    title.textContent = '隐藏的按钮（' + list.length + ' 个）';
    el.appendChild(title);

    var tip = document.createElement('div');
    tip.className = 'soda-fx-line';
    tip.style.display = 'block';
    tip.style.lineHeight = '1.6';
    tip.textContent = '长按任意按钮，点它右上角的红色叉即可隐藏；这里可以一次性恢复。';
    el.appendChild(tip);

    var seg = document.createElement('div');
    seg.className = 'soda-fx-seg';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '恢复全部';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var n = hideReadList().length;
      showHiddenButtons();
      if (el.parentNode) el.parentNode.removeChild(el);
      logDbg('设置页: 已恢复隐藏按钮 ' + n + ' 个');
    });
    seg.appendChild(btn);
    el.appendChild(seg);
    box.appendChild(el);
  }

  document.addEventListener('pointerdown', function (e) {
    /* 编辑态下点到别处就退出（点到叉按钮自己不算） */
    if (hideEditEl && e.target !== document.getElementById(HIDE_MARK_ID)) {
      if (!hideEditEl.contains(e.target)) stopHideEdit();
    }
    if (e.button !== 0) return;
    var el = hideTargetOf(e.target);
    if (!el) return;
    hidePressEl = el;
    hidePressPt = { x: e.clientX, y: e.clientY };
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      hideTimer = 0;
      if (!hidePressEl) return;
      var target = hidePressEl;
      hidePressEl = null;
      startHideEdit(target);
    }, 600);
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!hideTimer || !hidePressPt) return;
    if (Math.abs(e.clientX - hidePressPt.x) > 8 || Math.abs(e.clientY - hidePressPt.y) > 8) {
      clearTimeout(hideTimer);
      hideTimer = 0;
      hidePressEl = null;
    }
  }, true);

  function hidePressEnd() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    hidePressEl = null;
    hidePressPt = null;
  }
  document.addEventListener('pointerup', hidePressEnd, true);
  document.addEventListener('pointercancel', function () {
    hidePressEnd();
    stopHideEdit();
  }, true);

  /* 长按刚生效时，松手产生的那次 click 要吞掉，否则会顺带触发按钮原本的功能 */
  document.addEventListener('click', function (e) {
    if (Date.now() > hideSwallowUntil) return;
    if (!hideEditEl || !hideEditEl.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && hideEditEl) {
      e.preventDefault();
      e.stopPropagation();
      stopHideEdit();
    }
  }, true);

  setInterval(applyHiddenButtons, 1500);

  /* ================= 音量区滚轮调节音量 ================= */

  /* 鼠标停在音量图标 / 音量弹层上滚轮，直接调音量。
     优先走 App 自己的音量滑块（.volume-box 里的垂直 slider）：
     模拟一次 pointerdown→move→up，让 App 的 store 自己更新，UI 和声音一起变；
     拿不到滑块（弹层还没展开）就退回去直接设 media.volume。 */
  var VOLUME_ZONE_SEL = '[class*="volume"],[class*="mute"],[aria-label*="音量"],[title*="音量"]';
  var volAnchor = null;   // 音量图标所在的小矩形（由弹层位置反推，见 captureVolumeAnchor）

  /* 音量弹层是贴在图标「正上方」弹出来的，而且弹层一出现就说明指针正在图标上。
     用它反推出图标那块区域：这样指针停在图标上（不必滑进弹层）滚轮也能调音量。
     每次滚轮/扫描都刷新一次锚点，弹层换了位置也跟着走。 */
  function captureVolumeAnchor() {
    var box = document.querySelector('.volume-box-wrapper');
    if (!box) return;
    var r;
    try { r = box.getBoundingClientRect(); } catch (e) { return; }
    if (r.width < 4 || r.height < 4) return;
    var cx = r.left + r.width / 2;
    volAnchor = {
      left: cx - 18,
      right: cx + 18,
      top: r.bottom - 2,
      bottom: r.bottom + 34
    };
  }

  function inVolumeAnchor(x, y) {
    return !!volAnchor && x >= volAnchor.left && x <= volAnchor.right
      && y >= volAnchor.top && y <= volAnchor.bottom;
  }

  function volumeTrack() {
    return document.querySelector('.volume-box .slider-track')
      || document.querySelector('.volume-box-wrapper .slider-track')
      || document.querySelector('.volume-box .slider')
      || document.querySelector('.volume-box-wrapper .slider');
  }

  function currentVolumeRatio() {
    var track = volumeTrack();
    if (track) {
      var fill = track.querySelector('.slider-fill');
      var tr;
      try { tr = track.getBoundingClientRect(); } catch (e) { tr = null; }
      if (fill && tr && tr.height > 4) {
        var fr = fill.getBoundingClientRect();
        if (tr.height > 0) return Math.max(0, Math.min(1, fr.height / tr.height));
      }
    }
    var media = document.querySelector('audio,video');
    if (media) return media.muted ? 0 : media.volume;
    return 0.5;
  }

  function setVolumeRatio(ratio) {
    ratio = Math.max(0, Math.min(1, ratio));
    var track = volumeTrack();
    var tr;
    if (track) {
      try { tr = track.getBoundingClientRect(); } catch (e) { tr = null; }
    }
    if (track && tr && tr.height > 4) {
      var x = tr.left + tr.width / 2;
      var y = tr.bottom - ratio * tr.height;
      var fire = function (type, buttons) {
        var base = {
          bubbles: true, cancelable: true, clientX: x, clientY: y,
          button: 0, buttons: buttons
        };
        try {
          if (type.indexOf('pointer') === 0) {
            track.dispatchEvent(new PointerEvent(type, Object.assign({
              pointerId: 1, pointerType: 'mouse', isPrimary: true
            }, base)));
          } else {
            track.dispatchEvent(new MouseEvent(type, base));
          }
        } catch (e) { /* ignore */ }
      };
      /* Slider 组件可能走 pointer 也可能走 mouse，两套都发一遍（值一样，不会重复生效） */
      fire('pointerdown', 1); fire('mousedown', 1);
      fire('pointermove', 1); fire('mousemove', 1);
      fire('pointerup', 0); fire('mouseup', 0);
      return true;
    }
    var media = document.querySelector('audio,video');
    if (media) {
      media.volume = ratio;
      media.muted = ratio <= 0.001;
      return true;
    }
    return false;
  }

  document.addEventListener('wheel', function (e) {
    var t = e.target;
    if (!t) return;
    /* 先把锚点刷新一遍：指针停在图标上时弹层通常已经弹出来了，据此拿到图标位置 */
    captureVolumeAnchor();
    var inZone = !!(t.closest && t.closest(VOLUME_ZONE_SEL));
    /* 类名匹配不到图标时（App 的音量按钮没有 volume 类名），退而用位置判定 */
    if (!inZone && !inVolumeAnchor(e.clientX, e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    var cur = currentVolumeRatio();
    /* 步长按滚动量自适应：鼠标滚轮一格（deltaY≈100）约 6%，触控板的小增量按比例缩小，
       否则触控板一次滑动会甩出几十个事件，音量直接冲到 0 或 100。 */
    var step = Math.min(0.08, Math.max(0.01, Math.abs(e.deltaY) * 0.0006));
    var next = cur + (e.deltaY < 0 ? step : -step);
    next = Math.max(0, Math.min(1, next));
    if (Math.abs(next - cur) < 0.002) return;
    setVolumeRatio(next);
  }, { passive: false, capture: true });

  /* ================= 临时诊断：底部播放条结构 ================= */

  /* 移植 MusicBar 外观需要知道官方播放条里每个节点的类名 / 尺寸 / 层级，
     以及歌曲信息来源。只在第一次拿到播放条时打印一次，之后不再输出。 */
  var barDumpDone = false;
  function dumpPlayerBar() {
    if (barDumpDone) return;
    var bar = document.querySelector('.bottom-player');
    if (!bar) return;
    var r0;
    try { r0 = bar.getBoundingClientRect(); } catch (e) { return; }
    if (!r0 || r0.height < 20) return;
    barDumpDone = true;

    var out = [];
    (function walk(el, depth) {
      if (depth > 4 || out.length > 90) return;
      var cls = String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      var r;
      try { r = el.getBoundingClientRect(); } catch (e2) { r = { width: 0, height: 0 }; }
      out.push('  '.repeat(depth) + el.tagName.toLowerCase() + (cls ? '.' + cls : '')
        + '[' + Math.round(r.width) + 'x' + Math.round(r.height) + ']'
        + (txt ? ' "' + txt + '"' : '')
        + (el.tagName === 'IMG' ? ' src=' + String(el.currentSrc || el.src || '').slice(0, 60) : ''));
      for (var i = 0; i < el.children.length && i < 12; i++) walk(el.children[i], depth + 1);
    })(bar, 0);

    logDbg('播控结构[' + Math.round(r0.width) + 'x' + Math.round(r0.height) + ']:\n' + out.join('\n'));
    var ms = navigator.mediaSession && navigator.mediaSession.metadata;
    logDbg('MediaSession: ' + (ms
      ? ('title=' + ms.title + ' | artist=' + ms.artist + ' | artwork=' + ((ms.artwork && ms.artwork[0] && ms.artwork[0].src) || 'none'))
      : '无'));
    logDbg('媒体元素: audio=' + document.querySelectorAll('audio').length
      + ' video=' + document.querySelectorAll('video').length
      + ' playbackState=' + ((navigator.mediaSession && navigator.mediaSession.playbackState) || '-'));
  }

  /* ================= 快捷键 ================= */

  /* 小键盘 ←/→（Numpad4 / Numpad6）：快进/后退 5 秒。
     Alt 组合键留给下面的倍速快捷键；输入框里不抢键。 */
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    /* seekBy 会往下派发合成按键，这里必须只处理真人按键，否则会自己触发自己 */
    if (e.isTrusted === false) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
    var dir = seekKeyDir(e);
    if (!dir) return;
    if (!seekBy(dir * SEEK_STEP)) {           // 没在播歌就把按键交还给 App
      logDbg('进度调节: 找不到 .bottom-player');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    showSeekTip(dir * SEEK_STEP);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    var handled = true;
    switch (e.key) {
      case 'ArrowUp': setRate(rate + CFG.step); showPopup(); break;
      case 'ArrowDown': setRate(rate - CFG.step); showPopup(); break;
      case 'ArrowRight': setRate(rate + 0.25); showPopup(); break;
      case 'ArrowLeft': setRate(rate - 0.25); showPopup(); break;
      case '0': case ')': setRate(1); showPopup(); break;
      case 'm': case 'M': suspend(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ================= 诊断 ================= */

  function probe() {
    var deep = deepScan(document, []);
    console.log('%c[倍速Mod] 诊断', 'color:#7ccfff;font-weight:600', {
      媒体元素: deep.length,
      已接管: known.length,
      AudioContext: (window.__sodaAudioContexts || []).length,
      AudioBufferSource: (window.__sodaABSNodes || []).length,
      AudioWorklet: (window.__sodaWorklets || []).join(',') || '(无)',
      目标倍速: fmt(rate),
      状态: suspended ? '已停用' : '生效中'
    });
    diagAudio('probe');
    return { rate: rate, media: deep.length };
  }

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

  /* ================= 启动 ================= */

  /* 单个注入任务出错不要拖垮同一轮里的其它任务 */
  function runSafely(fn) {
    try { fn(); } catch (e) { logDbg('任务异常: ' + ((e && e.message) || e)); }
  }

  function boot() {
    applyAll();
    injectBrand();
    ls('sodaSpeedMod.anchorOffset', '');   // 清掉旧版手动校准的残留，避免影响自动定位

    /* 排障日志先注册：即使下面 startVis 抛错，也能在日志里看到「脚本跑过了」以及架构信息 */
    setTimeout(function () { diagAudio('8s'); }, 8000);
    setTimeout(function () { diagAudio('25s'); }, 25000);

    if (spectrumOn) {
      try { startVis(); } catch (e) { logDbg('频谱初始化失败: ' + ((e && e.message) || e)); }
    }

    /* 只把「外部（App 自己）」的变动当触发源：我们插封面 / 挪爱心产生的变动
       不再触发下一轮扫描。否则滚动时每 120ms 就会自激一次全页扫描 + 组件树遍历，
       表现就是「一滚动列表就一直刷新」。 */
    var scanTimer = 0;
    new MutationObserver(function (records) {
      var external = 0;
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (ourRecord(r)) continue;
        external++;
        stat.add += r.addedNodes.length;
        stat.del += r.removedNodes.length;
        for (var a = 0; a < r.addedNodes.length && stat.samples.length < 3; a++) {
          stat.samples.push('+' + nodeBrief(r.addedNodes[a]));
        }
        for (var b = 0; b < r.removedNodes.length && stat.samples.length < 3; b++) {
          stat.samples.push('-' + nodeBrief(r.removedNodes[b]));
        }
      }
      if (!external) { stat.selfBatches++; return; }
      stat.batches++;
      stat.recs += external;
      if (scanTimer) return;
      scanTimer = setTimeout(function () {
        scanTimer = 0;
        stat.passes++;
        runSafely(injectBrand);
        runSafely(injectMenuItems);
        if (isSettingsAboutPage()) {
          /* 关于页只用原生内容：把已经插进去的 Mod 设置行摘干净，并停止这一轮的注入 */
          runSafely(removeInjectedSettingRows);
        } else {
          runSafely(injectWheelSwitchRow);
          runSafely(injectSpectrumColorRow);
          runSafely(injectWidgetStyleRow);
          runSafely(injectClearBgRow);
          runSafely(injectClearBgCard);
          runSafely(injectBrandFxCard);
          runSafely(injectHiddenButtonsCard);
          runSafely(injectRowCoverRow);
        }
        runSafely(applyClearBg);
        runSafely(clearViewportPaints);   // 面板被重建时立刻补扫，别等 4 秒的定时
        runSafely(dumpPlayerBar);
        runSafely(syncRowCovers);
        runSafely(resetSongQueryOnNav);
        runSafely(injectSongSearch);
        runSafely(syncUnplayable);
        runSafely(injectPlaylistMenu);
      }, 120);
    }).observe(document.documentElement, { childList: true, subtree: true });

    logDbg('引导 r2 已生效（app-dir/CDP 通道，含滚动修复）');

    setInterval(function () {
      if (suspended) return;
      for (var i = 0; i < known.length; i++) normalize(known[i]);
      applyAudioNodes();
      runSafely(applyClearBg);   // 兜底：定时补一次，保证清背景一直生效
    }, 1000);

    setInterval(function () {
      if (suspended) return;
      var found = deepScan(document, []);
      for (var i = 0; i < found.length; i++) remember(found[i]);
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.__sodaSpeedMod = {
    get rate() { return rate; },
    set rate(v) { setRate(v); },
    setRate: setRate,
    suspend: suspend,
    show: showPopup,
    hide: hidePopup,
    probe: probe,
    get suspended() { return suspended; },
    get wheelSwitch() { return wheelOn; },
    set wheelSwitch(v) { setWheelSwitch(v); },
    get keepPitch() { return CFG.keepPitch; },
    set keepPitch(v) { setKeepPitch(v); },
    get spectrum() { return spectrumOn; },
    set spectrum(v) { setSpectrum(v); },
    get sleepMs() { return sleepRemainMs(); },
    setSleep: setSleep,
    get brandFx() { return brandFx; },
    set brandFx(v) { setBrandFx(v); },
    get brandFxSpeed() { return fxSpeed; },
    set brandFxSpeed(v) { setFxSpeed(v); },
    get brandFxSat() { return fxSat; },
    set brandFxSat(v) { setFxSat(v); },
    get rowCover() { return rowCoverOn; },
    set rowCover(v) { setRowCover(v); },
    get hideUnplayable() { return hideUnplayable; },
    set hideUnplayable(v) { setHideUnplayable(v); },
    get hiddenButtons() { return hideReadList(); },
    showHiddenButtons: showHiddenButtons,
    clearHiddenButtons: showHiddenButtons,
    get widgetStyle() { return widgetStyleGet(); },
    set widgetStyle(v) { widgetStyleSet(v); }
  };
})();
