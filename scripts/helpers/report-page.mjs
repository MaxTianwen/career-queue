import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { testBrowser } from './test-browser.mjs';
import { waitForDevToolsPort } from './browser-devtools.mjs';

// msedge.exe can hand off to another process and exit at once, so one-shot flags
// (--dump-dom, --screenshot) never see the page. Keep the browser on a DevTools port,
// wait until the page has posted its own report, save optional evidence, then close it.
export async function runReportPage({ url, profile, width, height, ready, timeoutMs = 45000, screenshot, dom }) {
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking'];
  if (width && height) args.push(`--window-size=${width},${height}`);
  const child = spawn(testBrowser, [...args, '--remote-debugging-port=0', '--user-data-dir=' + profile, url], {
    windowsHide: true
  });
  child.stdout.resume();
  child.stderr.resume();
  const sockets = [];
  const open = async target => {
    const ws = new WebSocket(target);
    sockets.push(ws);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let seq = 0;
    return (method, params = {}) =>
      new Promise(resolve => {
        const id = ++seq;
        const onMessage = event => {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          ws.removeEventListener('message', onMessage);
          resolve(message.result || {});
        };
        ws.addEventListener('message', onMessage);
        ws.send(JSON.stringify({ id, method, params }));
      });
  };
  try {
    const base = 'http://127.0.0.1:' + (await waitForDevToolsPort(profile, child));
    for (const end = Date.now() + timeoutMs; !ready() && Date.now() < end; )
      await new Promise(r => setTimeout(r, 100));
    const read = path => fetch(base + path, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
    // Edge may open its own welcome/sync tab beside ours; pick the tab on the test server.
    const origin = new URL(url).origin;
    const page = (await read('/json/list')).find(target => target.type === 'page' && target.url.startsWith(origin));
    if (page && (screenshot || dom)) {
      const send = await open(page.webSocketDebuggerUrl);
      if (screenshot) {
        const { data } = await send('Page.captureScreenshot', { format: 'png' });
        if (data) await writeFile(screenshot, Buffer.from(data, 'base64'));
      }
      if (dom) {
        const { result } = await send('Runtime.evaluate', {
          expression: 'document.documentElement.outerHTML',
          returnByValue: true
        });
        if (typeof result?.value === 'string') await writeFile(dom, result.value);
      }
    }
    const browser = await open((await read('/json/version')).webSocketDebuggerUrl);
    void browser('Browser.close');
  } finally {
    for (const ws of sockets) ws.close();
    child.kill();
  }
}
