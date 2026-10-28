/**
 * 构建脚本：按固定顺序把 src/ 下的模块拼成 soda-speed.js
 *
 * 用法：node build.mjs
 *
 * 说明：
 *   - 所有模块拼进同一个 IIFE 作用域，函数 / 变量互相可见，和拆分前行为一致；
 *   - 拼接顺序由下面的 ORDER 决定（文件名不带序号，避免依赖排序规则）；
 *   - src/ 里有 ORDER 未列出的文件会提示，新增模块记得加进来。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* fileURLToPath 而不是手撕 URL：路径里带空格 / 中文时 pathname 会是 %20 编码的 */
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'soda-speed.js');

const ORDER = [
  'core.js',            // 公共部分：页面判定、配置、存储、日志
  'widget-bar.js',      // 播控条：拖拽、按钮、频谱、进度条
  'widget-edit.js',     // 播控按钮长按编辑态（红叉）
  'widget-panel.js',    // 播控歌单面板
  'speed.js',           // 倍速核心
  'speed-popup.js',     // 倍速弹窗
  'menu.js',            // 「更多」菜单注入
  'pitch.js',           // 变速不变调
  'spectrum.js',        // 环形频谱
  'spectrum-color.js',  // 频谱配色
  'sleep.js',           // 睡眠定时器
  'wheel.js',           // 滚轮切歌
  'clearbg.js',         // 背景清理 / 毛玻璃
  'widget-style.js',    // 播控样式设置
  'resume.js',          // 恢复上次播放（保存 / 队列续播 / 历史兜底）
  'widget-cmd.js',      // 播控 ↔ 主窗口命令、歌单数据源
  'round.js',           // 窗口圆角
  'image-viewer.js',    // 评论图片查看器
  'lyric-color.js',     // 歌词配色
  'hide-buttons.js',    // 主窗口按钮长按隐藏 + 恢复卡片
  'volume.js',          // 音量区滚轮
  'diag-playerbar.js',  // 底部播放条结构诊断
  'shortcuts.js',       // 快捷键
  'diag.js',            // 运行诊断
  'brand.js',           // 侧边栏品牌名
  'brand-fx.js',        // 品牌名特效
  'row-cover.js',       // 歌单行封面
  'unplayable.js',      // 隐藏不可播放曲目
  'scroll-diag.js',     // 滚动期诊断
  'boot.js',            // 启动
];

if (!fs.existsSync(SRC_DIR)) {
  console.error('找不到 src/ 目录');
  process.exit(1);
}

const missing = ORDER.filter((f) => !fs.existsSync(path.join(SRC_DIR, f)));
if (missing.length) {
  console.error('ORDER 里列出了不存在的模块：' + missing.join(', '));
  process.exit(1);
}

const extra = fs.readdirSync(SRC_DIR)
  .filter((f) => /\.js$/.test(f) && ORDER.indexOf(f) < 0);
if (extra.length) {
  console.warn('提示：src/ 下这些文件不在 ORDER 里，本次不会被打包：' + extra.join(', '));
}

const head = '/* 由 build.mjs 从 src/ 生成，请修改 src/ 下的文件后运行 node build.mjs */\n';
let body = '';
for (const f of ORDER) {
  body += fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
}

/* 整包套一个 IIFE：所有模块共用同一个作用域，也不会把变量漏到页面全局。
   == 括号放在这里而不是某个模块里，这样每个 src 文件单独看也是语法合法的 == */
const out = head + '(function () {\n' + body + '})();\n';

fs.writeFileSync(OUT, out, 'utf8');
console.log('已生成 soda-speed.js：' + ORDER.length + ' 个模块，' + out.split('\n').length + ' 行');
