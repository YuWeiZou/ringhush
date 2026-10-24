import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(ROOT, 'logs');
const ERROR_LOG = path.join(LOG_DIR, 'server-errors.log');

function logFatal(scope, err) {
  const message = err?.stack ?? err?.message ?? String(err);
  const line = `[${new Date().toISOString()}] ${scope}\n${message}\n\n`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(ERROR_LOG, line, 'utf8');
  } catch {
    // 日志写不进去时仍然输出到控制台
  }
  console.error(`[${scope}]`, err);
}

let server;
try {
  ({ server } = await import('./server/index.js'));
} catch (err) {
  logFatal('startup', err);
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  logFatal('uncaughtException', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  logFatal('unhandledRejection', err);
  process.exit(1);
});

const port = Number(process.env.PORT) || 3001;
const url = `http://localhost:${port}`;
let opened = false;

function fallbackMessage() {
  console.log('');
  console.log('============================================================');
  console.log(`黑暗森林已启动：${url}`);
  console.log('如果浏览器没有自动打开，请手动访问上面的地址。');
  console.log('同一局域网的朋友请打开启动日志里的 LAN 地址。');
  console.log('============================================================');
  console.log('');
}

function openBrowser() {
  if (opened) return;
  opened = true;
  if (process.env.DARK_FOREST_NO_OPEN === '1' || process.env.DARK_FOREST_SKIP_OPEN === '1') {
    fallbackMessage();
    return;
  }

  try {
    if (process.platform === 'win32') {
      // 用 wscript + ShellExecute 打开默认浏览器。wscript 隐藏，
      // 浏览器以 normal window state 打开；不会多出 cmd 窗口。
      const opener = path.join(ROOT, 'open-browser.vbs');
      const child = spawn('wscript.exe', ['//nologo', opener, url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', () => {
        // explorer 兜底
        const fallback = spawn('explorer.exe', [url], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        fallback.on('error', () => {
          console.log('自动打开浏览器失败，请手动访问：' + url);
          fallbackMessage();
        });
        fallback.unref();
      });
      child.unref();
      console.log(`已请求系统浏览器打开：${url}`);
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      console.log(`已请求系统浏览器打开：${url}`);
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
      console.log(`已请求系统浏览器打开：${url}`);
    }
  } catch (err) {
    console.log(`自动打开浏览器失败：${err.message}`);
    fallbackMessage();
  }
}

server.on('error', (err) => {
  logFatal('server.error', err);
  console.error('服务启动失败。若端口 3001 被占用，请关闭占用程序后重试。');
  process.exit(1);
});

server.on('close', () => {
  if (!process.exitCode) {
    logFatal('server.close', new Error('HTTP/WebSocket server closed unexpectedly'));
    process.exit(1);
  }
});

function scheduleOpen() {
  setTimeout(openBrowser, 350);
}

if (server.listening) scheduleOpen();
else server.once('listening', scheduleOpen);

// 即使 listening 事件异常，也给一个兜底，避免用户完全看不到页面。
setTimeout(openBrowser, 1800);
