import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(new URL('..', import.meta.url).pathname);
const mainRs = await readFile(resolve(root, 'src/main.rs'), 'utf8');
const marker = 'var ICON_EDIT';
const markerIndex = mainRs.indexOf(marker);
if (markerIndex < 0) throw new Error('desktop script marker not found');
const scriptStart = mainRs.lastIndexOf('<script>', markerIndex);
const scriptEnd = mainRs.indexOf('</script>', markerIndex);
if (scriptStart < 0 || scriptEnd < 0) throw new Error('desktop script block not found');

const desktopScript = mainRs
  .slice(scriptStart + '<script>'.length, scriptEnd)
  .replaceAll('{{', '{')
  .replaceAll('}}', '}')
  .replaceAll('{stat_words_js}', '字')
  .replaceAll('{stat_chars_js}', '字符')
  .replaceAll('{btn_edit}', 'Edit')
  .replaceAll('{btn_preview}', 'Preview')
  .replaceAll('{btn_split}', 'Split View')
  .replaceAll('{btn_split_exit}', 'Exit Split View')
  .replaceAll('{btn_format}', 'Format Markdown (Alt+F)');

const hiddenFormatCss = mainRs.match(/body:not\(\.editing\) #btn-format \{\{[^\n]*\}\}/)?.[0];
if (!hiddenFormatCss) throw new Error('format button visibility rule not found');
const hiddenFormatRule = hiddenFormatCss.replaceAll('{{', '{').replaceAll('}}', '}');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.setContent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      :root { --content-scale: 1; }
      body { margin: 0; font: 15px/1.6 system-ui, sans-serif; }
      #app { width: 100%; box-sizing: border-box; margin: 0 auto; padding: 24px; }
      #preview { font-size: calc(15px * var(--content-scale)); }
      #editor {
        display: none;
        width: 100%;
        box-sizing: border-box;
        border: none;
        outline: none;
        resize: none;
        overflow: hidden;
        font: calc(14px * var(--content-scale))/1.6 monospace;
        background: transparent;
        color: inherit;
        padding: 0;
      }
      body.editing #preview { display: none; }
      body.editing #editor { display: block; padding: 16px 24px; }
      body.editing #app { max-width: none; padding: 0; }
      body.editing #btn-open,
      body.editing #btn-search,
      body.editing #btn-print { display: none; }
      ${hiddenFormatRule}
      .toolbar { position: fixed; top: 0; right: 0; z-index: 10; display: flex; gap: 6px; }
      .toolbar button { width: 34px; height: 34px; }
      .toolbar button[hidden] { display: none !important; }
      .zoom-popover { display: none; }
      .zoom-control.open .zoom-popover { display: flex; }
      .tabbar { display: none; }
    </style>
  </head>
  <body class="has-tabs">
    <div class="tabbar">
      <div id="tabs"></div>
      <div id="doc-stats"></div>
      <button id="tab-open"></button>
    </div>
    <div class="toolbar">
      <button id="btn-open"></button>
      <button id="btn-search"></button>
      <button id="btn-toggle"></button>
      <button id="btn-split" aria-pressed="false"></button>
      <button id="btn-format" hidden></button>
      <button id="btn-print"></button>
      <div id="zoom-control" class="zoom-control">
        <button id="btn-zoom"></button>
        <div class="zoom-popover">
          <button id="btn-zoom-out"></button>
          <button id="btn-zoom-reset"></button>
          <button id="btn-zoom-in"></button>
        </div>
      </div>
      <button id="btn-update" hidden></button>
    </div>
    <div class="findbar">
      <input id="find-input">
      <span id="find-state"></span>
      <button id="find-prev"></button>
      <button id="find-next"></button>
      <button id="find-close"></button>
    </div>
    <div id="app">
      <div id="preview"><h1>Title</h1></div>
      <textarea id="editor"></textarea>
    </div>
    <script>
      window.__messages = [];
      window.ipc = { postMessage(message) { window.__messages.push(message); } };
    </script>
    <script>${desktopScript}</script>
  </body>
</html>`);

const fail = (label, detail) => {
  throw new Error(`${label}: ${JSON.stringify(detail)}`);
};
const readMessages = () => page.evaluate(() => window.__messages.slice());

const messySource = '#   Title\n\n*   item one\n*   item two\n';
const formattedSource = '# Title\n\n- item one\n- item two\n';

await page.evaluate(() => window.__setTabs([
  { id: 7, name: 'format.md', path: '/tmp/format.md', active: true, format: true },
]));
await page.evaluate((source) => window.__setContent(
  '<h1>Title</h1>',
  source,
  '',
  false,
  false,
), messySource);

let state = await page.evaluate(() => ({
  display: getComputedStyle(document.getElementById('btn-format')).display,
  editing: document.body.classList.contains('editing'),
}));
if (state.editing || state.display !== 'none') {
  fail('format button must stay hidden outside source edit', state);
}

await page.locator('#btn-toggle').click();
await page.waitForTimeout(60);
state = await page.evaluate(() => ({
  display: getComputedStyle(document.getElementById('btn-format')).display,
  hidden: document.getElementById('btn-format').hidden,
  title: document.getElementById('btn-format').title,
}));
if (state.display === 'none' || state.hidden) {
  fail('format button must be visible for Markdown source edit', state);
}
if (state.title !== 'Format Markdown (Alt+F)') {
  fail('format button tooltip is wrong', state);
}

await page.locator('#btn-format').click();
await page.waitForTimeout(60);
let messages = await readMessages();
if (!messages.includes(`format:7\n${messySource}`)) {
  fail('format button must request formatting for the active tab', messages);
}

await page.evaluate((source) => window.__applyFormattedSource(7, source), formattedSource);
await page.waitForTimeout(60);
state = await page.evaluate(() => ({
  value: document.getElementById('editor').value,
  dirty: window.__messages.includes('dirty:1'),
  stats: document.getElementById('doc-stats').textContent,
}));
if (state.value !== formattedSource) fail('formatted source was not applied', state);
if (!state.dirty) fail('formatting must mark the document dirty', state);
if (state.stats !== '22 字 · 31 字符') fail('formatting must refresh document stats', state);

await page.waitForTimeout(750);
messages = await readMessages();
if (!messages.includes(`save:${formattedSource}`)) {
  fail('formatted source must go through autosave', messages);
}

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
await page.keyboard.press(`${modifier}+Z`);
await page.waitForTimeout(120);
state = await page.evaluate(() => ({ value: document.getElementById('editor').value }));
if (state.value !== messySource) {
  fail('native undo must restore the pre-format source', state);
}

const formatCountBeforeShortcut = (await readMessages())
  .filter((message) => message.startsWith('format:')).length;
await page.locator('#editor').click();
await page.keyboard.press('Alt+F');
await page.waitForTimeout(60);
messages = await readMessages();
const formatCountAfterShortcut = messages
  .filter((message) => message.startsWith('format:')).length;
if (formatCountAfterShortcut !== formatCountBeforeShortcut + 1) {
  fail('Alt+F must request formatting', messages);
}
if (!messages[messages.length - 1].startsWith('format:7\n')) {
  fail('shortcut must format the active tab', messages);
}

await page.locator('#editor').fill('# typed after format request\n');
await page.evaluate((source) => window.__applyFormattedSource(7, source), formattedSource);
state = await page.evaluate(() => ({ value: document.getElementById('editor').value }));
if (state.value !== '# typed after format request\n') {
  fail('stale format result must not overwrite newer typing', state);
}

const valueBeforeWrongTab = await page.evaluate(
  () => document.getElementById('editor').value,
);
await page.evaluate((source) => window.__applyFormattedSource(99, source), formattedSource);
state = await page.evaluate(() => ({ value: document.getElementById('editor').value }));
if (state.value !== valueBeforeWrongTab) {
  fail('format result from another tab must be dropped', state);
}

await page.evaluate(() => window.__setTabs([
  { id: 8, name: 'notes.txt', path: '/tmp/notes.txt', active: true, format: false },
]));
await page.waitForTimeout(60);
state = await page.evaluate(() => ({
  hidden: document.getElementById('btn-format').hidden,
  display: getComputedStyle(document.getElementById('btn-format')).display,
}));
if (!state.hidden || state.display !== 'none') {
  fail('non-Markdown documents must not offer formatting', state);
}

const formatCountBeforeGuard = (await readMessages())
  .filter((message) => message.startsWith('format:')).length;
await page.keyboard.press('Alt+F');
await page.waitForTimeout(60);
const formatCountAfterGuard = (await readMessages())
  .filter((message) => message.startsWith('format:')).length;
if (formatCountAfterGuard !== formatCountBeforeGuard) {
  fail('shortcut must not format non-Markdown documents', { formatCountBeforeGuard, formatCountAfterGuard });
}

await browser.close();
console.log('[desktop-format-verify] OK');
