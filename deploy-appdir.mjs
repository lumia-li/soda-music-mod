/**
 * 部署 Mod 到汽水音乐主进程
 *
 * 原理: 该客户端的 OnlyLoadAppFromAsar fuse 为 disabled，
 *       把 resources/app.asar 移走后，Electron 会转而加载 resources/app 目录。
 *       目录模式便于随时改代码，且不涉及 asar 重建与完整性校验。
 *
 * 安装目录的确定顺序：
 *   1. 命令行 --res "<resources 目录>"（或 --res="..."）
 *   2. 环境变量 SODA_RES
 *   3. 注册表卸载项里的 InstallLocation / DisplayIcon
 *   4. 常见安装位置（%LOCALAPPDATA%\Programs 等，含其下的版本号子目录）
 * 都不匹配时会直接报错，不会去猜盘符。
 *
 * 用法: node deploy-appdir.mjs
 *       node deploy-appdir.mjs --res "D:\某处\Soda Music\3.5.1\resources"
 *       node deploy-appdir.mjs --restore   还原为原始 asar 模式
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/* ---------- 定位 resources 目录 ---------- */

function argValue(name) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1]) return args[i + 1];
    if (args[i].startsWith(name + '=')) return args[i].slice(name.length + 1);
  }
  return '';
}

/* 一个目录像不像 resources：里面应该有 app.asar，或者已经部署过（app 目录 / modbak） */
function looksLikeRes(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, 'app.asar'))
      || fs.existsSync(path.join(dir, 'app.asar.modbak'))
      || fs.existsSync(path.join(dir, 'app'));
  } catch (e) { return false; }
}

/* 传进来的可能是安装目录，也可能是 resources 目录本身 */
function resFromDir(dir) {
  if (!dir) return '';
  let p = dir;
  try { p = path.resolve(dir); } catch (e) { return ''; }
  if (looksLikeRes(p)) return p;
  const sub = path.join(p, 'resources');
  if (looksLikeRes(sub)) return sub;
  return '';
}

/* 用 PowerShell 查找（reg query 的输出是控制台代码页，中文路径 / 中文 DisplayName 会乱码，
   交给 PowerShell 读注册表并统一输出 UTF-8 更稳）。查找顺序：
     1. 卸载项里的 DisplayIcon / InstallLocation
     2. 正在运行的 SodaMusic 进程路径
     3. 实在找不到，再对各固定磁盘做一次深度 3 的浅层扫描 */
function psQuery(script) {
  try {
    return execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) { return ''; }
}

function resFromShell() {
  const script = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    '$ErrorActionPreference="SilentlyContinue"',
    '$out=@()',
    '$keys=@("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",'
      + '"HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",'
      + '"HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*")',
    'Get-ItemProperty $keys | Where-Object { $_.DisplayIcon -match "SodaMusic\\.exe" -or $_.InstallLocation -match "Soda" -or $_.DisplayName -match "汽水|Soda" } | ForEach-Object { if($_.DisplayIcon){$out+=$_.DisplayIcon}; if($_.InstallLocation){$out+=$_.InstallLocation} }',
    'Get-Process SodaMusic | ForEach-Object { if($_.Path){$out+=$_.Path} }',
    'if(-not $out){ [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq "Fixed" } | ForEach-Object { Get-ChildItem -Path $_.Root -Filter SodaMusic.exe -Recurse -Depth 3 -File -ErrorAction SilentlyContinue | ForEach-Object { $out+=$_.FullName } } }',
    '$out | Select-Object -Unique',
  ].join('; ');

  const out = psQuery(script);
  for (const line of String(out).split(/\r?\n/)) {
    let raw = line.trim().replace(/^"|"$/g, '');
    if (!raw) continue;
    raw = raw.replace(/",\s*\d+$/, '').replace(/,\s*\d+$/, '');   // DisplayIcon 常见形式： "...\SodaMusic.exe",0
    const dir = /\.exe$/i.test(raw) ? path.dirname(raw) : raw;
    const hit = resFromDir(dir);
    if (hit) return hit;
  }
  return '';
}

function resFromCommonPaths() {
  const names = ['Soda Music', 'SodaMusic', '汽水音乐'];
  const bases = [];
  const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']];
  for (const root of roots) {
    if (!root) continue;
    for (const n of names) {
      bases.push(path.join(root, n));
      bases.push(path.join(root, 'Programs', n));
    }
  }
  for (const base of bases) {
    const hit = resFromDir(base);
    if (hit) return hit;
  }
  /* 安装器一般会带一层版本号目录：<base>\<version>\resources */
  for (const base of bases) {
    let kids = [];
    try { kids = fs.readdirSync(base); } catch (e) { continue; }
    for (const k of kids) {
      const hit = resFromDir(path.join(base, k));
      if (hit) return hit;
    }
  }
  return '';
}

const RES = (function () {
  const explicit = argValue('--res') || process.env.SODA_RES || '';
  if (explicit) {
    const hit = resFromDir(explicit);
    if (!hit) {
      throw new Error('指定的目录里找不到 app.asar：' + explicit
        + '\n请确认路径指向汽水音乐的 resources 目录（与 SodaMusic.exe 同级的 resources 文件夹）');
    }
    return hit;
  }
  return resFromShell() || resFromCommonPaths();
})();

if (!RES) {
  throw new Error('没能自动找到汽水音乐的安装目录。\n'
    + '请手动指定（右键桌面快捷方式 → 打开文件所在位置，取同一级里的 resources 目录）：\n'
    + '  node deploy-appdir.mjs --res "X:\\你的路径\\Soda Music\\版本号\\resources"');
}

console.log('安装目录: ' + RES);

/* 部署前先构建：src/ 下按功能拆分的模块要拼成 soda-speed.js 再拷贝 */
try {
  if (fs.existsSync(path.join(ROOT, 'src')) && fs.existsSync(path.join(ROOT, 'build.mjs'))) {
    execFileSync(process.execPath, [path.join(ROOT, 'build.mjs')], { stdio: 'inherit' });
  }
} catch (e) {
  console.log('构建失败（继续部署现有 soda-speed.js）: ' + ((e && e.message) || e));
}

/* soda-speed.js 是构建产物、不再入库，缺了就别往下走，否则会拷出一个空壳 */
if (!fs.existsSync(path.join(ROOT, 'soda-speed.js'))) {
  throw new Error('缺少 soda-speed.js，且自动构建没有生成。\n'
    + '先手动执行一次：node build.mjs');
}

const ASAR = path.join(RES, 'app.asar');
const BAK = path.join(RES, 'app.asar.modbak');
const APPDIR = path.join(RES, 'app');
const UNPACKED = path.join(RES, 'app.asar.unpacked');
const MOD_SRC = path.join(ROOT, 'soda-main.js');

const ENTRY = 'require("./soda-main.js");\n'
  + 'module.exports = require("./entry.node").entry({ exports, require, module, __filename, __dirname })\n';

function readAsar(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 4) throw new Error('不是合法的 asar: ' + file);
  const headerLen = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString('utf8'));
  return { buf, header, dataStart: 8 + headerLen };
}

function extractAsar(file, dest) {
  const { buf, header, dataStart } = readAsar(file);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  (function walk(node, dir) {
    for (const [name, item] of Object.entries(node.files)) {
      const target = path.join(dir, name);
      if (item.files) {
        fs.mkdirSync(target, { recursive: true });
        walk(item, target);
      } else if (item.unpacked) {
        // 数据在 app.asar.unpacked，稍后单独复制
      } else {
        const off = Number(item.offset);
        fs.writeFileSync(target, buf.subarray(dataStart + off, dataStart + off + item.size));
      }
    }
  })(header, dest);
}

if (process.argv.includes('--restore')) {
  if (!fs.existsSync(BAK)) throw new Error('找不到备份 ' + BAK);
  fs.copyFileSync(BAK, ASAR);
  fs.rmSync(APPDIR, { recursive: true, force: true });
  console.log('已还原为 asar 模式');
  process.exit(0);
}

if (!fs.existsSync(MOD_SRC)) throw new Error('缺少 ' + MOD_SRC);

if (fs.existsSync(ASAR)) {
  if (!fs.existsSync(BAK)) {
    fs.copyFileSync(ASAR, BAK);
    console.log('已备份 -> ' + BAK);
  }
  fs.rmSync(ASAR);
  console.log('已移出 app.asar（改用 resources/app 目录加载）');
}

if (!fs.existsSync(APPDIR)) {
  if (!fs.existsSync(BAK)) throw new Error('找不到 app.asar.modbak，无法首次解包');
  extractAsar(BAK, APPDIR);
  console.log('已解包到 ' + APPDIR);
  if (fs.existsSync(UNPACKED)) {
    let n = 0;
    for (const name of fs.readdirSync(UNPACKED)) {
      const src = path.join(UNPACKED, name);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(APPDIR, name));
        n++;
      }
    }
    console.log('已复制 ' + n + ' 个原生模块到 app 目录');
  }
}

fs.writeFileSync(path.join(APPDIR, 'entry.js'), ENTRY, 'utf8');
fs.writeFileSync(path.join(APPDIR, 'soda-main.js'), fs.readFileSync(MOD_SRC));
fs.copyFileSync(path.join(ROOT, 'soda-speed.js'), path.join(APPDIR, 'soda-speed.js'));
console.log('已写入 entry.js 钩子、soda-main.js、soda-speed.js');

/* 播控字体：主进程会读同目录下的 misans.woff2（优先）/ misans.ttf，base64 内嵌进任务栏播控窗口 */
let fontCopied = 0;
for (const name of ['misans.woff2', 'misans.ttf']) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(APPDIR, name));
  fontCopied++;
  console.log('已写入 ' + name + '（' + Math.round(fs.statSync(src).size / 1048576 * 10) / 10 + 'MB，播控字体）');
}
if (!fontCopied) console.log('警告: 缺少 misans.woff2 / misans.ttf，播控会回落到系统字体');
console.log('\n现在重新打开汽水音乐即可。诊断日志: %TEMP%\\soda-mod.log');
