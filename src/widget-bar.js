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
    + 'position:relative !important;z-index:2 !important;}'
    /* 歌单按钮：和播放模式 / 少推荐同一套尺寸 */
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-list{width:32px !important;height:32px !important;'
    + 'min-width:32px !important;flex:0 0 32px !important;margin:0 !important;padding:0 !important;'
    + 'border:0 !important;display:flex !important;align-items:center !important;justify-content:center !important;'
    + 'background:transparent !important;color:#FDF5F5 !important;border-radius:16px !important;'
    + 'cursor:pointer !important;-webkit-app-region:no-drag !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-list:hover{background:rgba(255,255,255,.13) !important;'
    + 'color:#fff !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-list.on{background:rgba(255,255,255,.18) !important;color:#fff !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' .soda-mb-list svg{width:16px !important;height:16px !important;'
    + 'fill:currentColor !important;}'
    /* 七个按钮全隐藏后：右半区左右分栏，双击换歌 */
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-zones{position:fixed;right:0;top:0;bottom:0;width:50%;'
    + 'display:flex;z-index:6;-webkit-app-region:no-drag;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-zones i{flex:1;cursor:pointer;}'
    /* ===== 歌单面板：窗口向下（或向上）展开，播控条保持 46px 高度 ===== */
    + 'html.' + WIDGET_MBAR_CLASS + '.soda-panel-open .wrapper{position:fixed !important;left:0 !important;'
    + 'right:0 !important;height:46px !important;z-index:3 !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + '.soda-panel-down .wrapper{top:0 !important;bottom:auto !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + '.soda-panel-up .wrapper{top:auto !important;bottom:0 !important;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel{position:fixed;left:6px;right:6px;z-index:2;'
    + 'display:none;flex-direction:row;background:rgba(18,20,24,.97);border:0;'
    + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.055);overflow:hidden;font-size:12px;color:#FDF5F5;'
    + '-webkit-app-region:no-drag;}'
    + 'html.' + WIDGET_MBAR_CLASS + '.soda-panel-down #soda-widget-panel{top:52px;bottom:12px;'
    + 'border-radius:14px;animation:soda-pl-in-down .17s ease-out both;}'
    + 'html.' + WIDGET_MBAR_CLASS + '.soda-panel-up #soda-widget-panel{top:12px;bottom:52px;'
    + 'border-radius:14px;animation:soda-pl-in-up .17s ease-out both;}'
    + '@keyframes soda-pl-in-down{from{opacity:0;transform:translateY(-8px) scale(.985);}'
    + 'to{opacity:1;transform:none;}}'
    + '@keyframes soda-pl-in-up{from{opacity:0;transform:translateY(8px) scale(.985);}'
    + 'to{opacity:1;transform:none;}}'
    + '@keyframes soda-pl-out-down{to{opacity:0;transform:translateY(-6px) scale(.99);}}'
    + '@keyframes soda-pl-out-up{to{opacity:0;transform:translateY(6px) scale(.99);}}'
    + 'html.' + WIDGET_MBAR_CLASS + '.soda-panel-down #soda-widget-panel.soda-pl-closing{'
    + 'animation:soda-pl-out-down .15s ease-in both;}'
    + 'html.' + WIDGET_MBAR_CLASS + '.soda-panel-up #soda-widget-panel.soda-pl-closing{'
    + 'animation:soda-pl-out-up .15s ease-in both;}'
    + 'html.' + WIDGET_MBAR_CLASS + '.soda-panel-open #soda-widget-panel{display:flex;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-left{width:138px;flex:0 0 138px;'
    + 'border-right:1px solid rgba(255,255,255,.06);overflow-y:auto;overflow-x:hidden;padding:6px 6px 10px;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-sec{font-size:11px;'
    + 'color:rgba(255,255,255,.4);padding:8px 8px 4px;letter-spacing:.04em;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-item{display:flex;align-items:center;gap:7px;'
    + 'height:30px;padding:0 8px;border-radius:7px;cursor:pointer;color:rgba(255,255,255,.72);'
    + 'white-space:nowrap;-webkit-app-region:no-drag;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-item span{overflow:hidden;'
    + 'text-overflow:ellipsis;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-item:hover{background:rgba(255,255,255,.07);'
    + 'color:#fff;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-item.on{background:rgba(255,255,255,.14);'
    + 'color:#fff;font-weight:600;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-item svg{width:14px;height:14px;'
    + 'flex:0 0 14px;opacity:.85;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-right{flex:1 1 auto;min-width:0;'
    + 'overflow-y:auto;padding:6px;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song{display:flex;align-items:center;'
    + 'gap:9px;height:46px;padding:0 6px;border-radius:8px;cursor:pointer;background:none;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song img{width:34px;height:34px;'
    + 'border-radius:5px;object-fit:cover;background:rgba(255,255,255,.08);flex:0 0 34px;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song .t{min-width:0;flex:1 1 auto;'
    + 'display:flex;flex-direction:column;gap:2px;}'
    /* 正在播放：歌名 / 歌手用汽水官方绿（#00cb64），封面左侧显示频谱 */
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song.playing .t b,'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song.playing .t small{color:#00cb64;}'
    /* 左侧序号位：颜色 #7C7C7C、字重 500 */
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-idx{width:18px;flex:0 0 18px;'
    + 'text-align:center;font-size:11px;font-weight:500;color:#7C7C7C;'
    + 'font-variant-numeric:tabular-nums;line-height:12px;}'
    /* 频谱：照搬汽水 SoundWave（尺寸 12、三根 1.5px 白条、0.6s 错峰）
       —— 组件源码 sound-wave / s1 s2 s3 + @keyframes wave */
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-wave{position:relative;'
    + 'display:inline-block;width:12px;height:12px;vertical-align:middle;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-wave i{position:absolute;'
    + 'width:1.5px;border-radius:1px;background:#fff;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-wave i:nth-child(1){left:0;height:8px;top:2px;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-wave i:nth-child(2){left:5px;height:12px;top:0;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-wave i:nth-child(3){left:10px;height:8px;top:2px;}'
    + '@keyframes soda-pl-wave{0%{height:8px;top:2px;}50%{height:4px;top:4px;}'
    + '100%{height:8px;top:2px;}}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song.playing .soda-pl-wave i:nth-child(1){'
    + 'animation:soda-pl-wave .6s ease 0s infinite;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song.playing .soda-pl-wave i:nth-child(2){'
    + 'animation:soda-pl-wave .6s ease .4s infinite;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song.playing .soda-pl-wave i:nth-child(3){'
    + 'animation:soda-pl-wave .6s ease .8s infinite;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song .t b{font-size:12px;'
    + 'font-weight:600;color:#FDF5F5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-song .t small{font-size:11px;'
    + 'color:rgba(255,255,255,.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel .soda-pl-tip{padding:20px 12px;font-size:12px;'
    + 'color:rgba(255,255,255,.45);text-align:center;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel ::-webkit-scrollbar{width:6px;}'
    + 'html.' + WIDGET_MBAR_CLASS + ' #soda-widget-panel ::-webkit-scrollbar-thumb{'
    + 'background:rgba(255,255,255,.16);border-radius:3px;}';

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

  /* ================= 播控按钮：长按隐藏 / 设置页恢复 =================
   *
   * 长按 0.6 秒把按钮从播控条上摘掉，隐藏列表存 localStorage；
   * 主窗口设置页里的「播控按钮」一行可以一键恢复。
   */
  var WIDGET_HIDDEN_KEY = 'sodaSpeedMod.widgetHidden';
  var WIDGET_BTN_SELECTOR = {
    mode: '.soda-mb-mode',
    dislike: '.soda-mb-dislike',
    list: '.soda-mb-list',
  };

  function widgetHiddenList() {
    var raw = '';
    try { raw = localStorage.getItem(WIDGET_HIDDEN_KEY) || ''; } catch (e) { raw = ''; }
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
    } catch (e) { return []; }
  }

  function widgetIsHidden(key) {
    return widgetHiddenList().indexOf(key) >= 0;
  }

  function widgetHideBtn(key) {
    var list = widgetHiddenList();
    if (list.indexOf(key) < 0) list.push(key);
    try { localStorage.setItem(WIDGET_HIDDEN_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    var sel = WIDGET_BTN_SELECTOR[key];
    if (sel) {
      var nodes = document.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
      }
    }
    if (key === 'list' && plPanelOpen) plClose();
    try { widgetApplyHidden(); } catch (e) { /* ignore */ }
    try { console.log('[倍速Mod] 播控按钮: 已隐藏 ' + key); } catch (e) { /* ignore */ }
  }

  /* 长按 0.6 秒进入编辑态（按钮右上角出现红叉）；
     长按触发后吞掉紧随其后的 click，免得顺带执行按钮本身的功能 */
  function widgetAttachHold(el, key) {
    if (!el || el.__sodaHold) return;
    el.__sodaHold = true;
    var timer = 0;
    var fired = false;

    var cancel = function () {
      if (timer) { clearTimeout(timer); timer = 0; }
    };

    el.addEventListener('pointerdown', function () {
      cancel();
      fired = false;
      timer = setTimeout(function () {
        timer = 0;
        fired = true;
        widgetEnterEdit();
      }, 600);
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', function (e) {
      if (!fired) return;
      fired = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

