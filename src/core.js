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
  'use strict';
  if (window.__sodaSpeedMod) return;

  /* 脚本内部任何未捕获异常都写进 %TEMP%\soda-mod.log，方便定位「某功能没反应」 */
  window.addEventListener('error', function (e) {
    try {
      console.log('[倍速Mod] 脚本异常: ' + ((e && e.message) || e) +
        ' @' + ((e && e.filename) || '') + ':' + ((e && e.lineno) || 0));
    } catch (err) { /* ignore */ }
  });

