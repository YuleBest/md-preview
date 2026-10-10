import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(new URL('..', import.meta.url).pathname);
const screenshotDir = process.env.SPLIT_VERIFY_SCREENSHOT_DIR
  ?? '/tmp/md-preview-split-verify';
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
  .replaceAll('{btn_split_exit}', 'Exit Split View');

const splitCssStart = mainRs.indexOf('/* Split view');
const splitCssEnd = mainRs.indexOf('@page', splitCssStart);
if (splitCssStart < 0 || splitCssEnd < 0) throw new Error('split view CSS block not found');
const splitCss = mainRs.slice(splitCssStart, splitCssEnd)
  .replaceAll('{{', '{')
  .replaceAll('}}', '}');
const darkSplitRule = mainRs.match(/body\.editing\.split #editor \{\{ border-color: #333; \}\}/)?.[0];
if (!darkSplitRule) throw new Error('dark split divider rule not found');
const darkSplitCss = darkSplitRule.replaceAll('{{', '{').replaceAll('}}', '}');
const printCss = mainRs.match(/@media print \{\{[\s\S]*?\n\}\}/)?.[0];
if (!printCss) throw new Error('print stylesheet block not found');
const printCssSource = printCss.replaceAll('{{', '{').replaceAll('}}', '}');

const browser = await chromium.launch();
await mkdir(screenshotDir, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('https://md-preview.test/**', (route) => route.fulfill({
  contentType: 'text/html',
  body: '<!doctype html><title>MD Preview split verify</title>',
}));
await page.goto('https://md-preview.test/');

const previewHtml = Array.from(
  { length: 60 },
  (_, index) => `<p>Rendered paragraph ${index + 1}</p>`,
).join('');
const editorText = Array.from(
  { length: 60 },
  (_, index) => `Source line ${index + 1}`,
).join('\n');

await page.setContent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      :root { color-scheme: light dark; --chrome-top: 10px; --content-scale: 1; }
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
      #preview .mdp-table-wrap {
        width: min(calc(100vw - 64px), 1280px);
        margin: 1em 0 1em 50%;
        transform: translateX(-50%);
        overflow-x: auto;
      }
      ${splitCss}
      @media (prefers-color-scheme: dark) { ${darkSplitCss} }
      ${printCssSource}
      .toolbar { position: fixed; top: 0; right: 0; z-index: 10; display: flex; gap: 6px; }
      .toolbar button { width: 34px; height: 34px; }
      .toolbar button.active { outline: 2px solid #0969da; }
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
      <div id="preview">${previewHtml}</div>
      <textarea id="editor">${editorText}</textarea>
    </div>
    <script>
      window.__messages = [];
      window.ipc = { postMessage(message) { window.__messages.push(message); } };
    </script>
    <script>${desktopScript}</script>
  </body>
</html>`);

const readMessages = () => page.evaluate(() => window.__messages.slice());
const fail = (label, detail) => {
  throw new Error(`${label}: ${JSON.stringify(detail)}`);
};

await page.evaluate(() => window.__setTabs([
  { id: 42, name: 'split.md', path: '/tmp/split.md', active: true },
]));
await page.evaluate(() => window.__setContent(
  '<h1>Split preview</h1>',
  '# Source title\n',
  '',
  false,
  false,
));

let state = await page.evaluate(() => ({
  editing: document.body.classList.contains('editing'),
  split: document.body.classList.contains('split'),
  previewDisplay: getComputedStyle(document.getElementById('preview')).display,
  editorDisplay: getComputedStyle(document.getElementById('editor')).display,
  pressed: document.getElementById('btn-split').getAttribute('aria-pressed'),
}));
if (state.editing || state.split || state.previewDisplay !== 'block' || state.editorDisplay !== 'none') {
  fail('initial preview state is wrong', state);
}
if (state.pressed !== 'false') fail('split button starts pressed', state);
await page.screenshot({ path: resolve(screenshotDir, '01-preview-only.png') });

await page.locator('#btn-split').click();
await page.waitForTimeout(60);
state = await page.evaluate(() => {
  const editor = document.getElementById('editor').getBoundingClientRect();
  const preview = document.getElementById('preview').getBoundingClientRect();
  return {
    editing: document.body.classList.contains('editing'),
    split: document.body.classList.contains('split'),
    previewDisplay: getComputedStyle(document.getElementById('preview')).display,
    editorDisplay: getComputedStyle(document.getElementById('editor')).display,
    editorLeft: editor.left,
    previewLeft: preview.left,
    editorWidth: editor.width,
    previewWidth: preview.width,
    editorTop: editor.top,
    previewTop: preview.top,
    activeElement: document.activeElement.id,
    pressed: document.getElementById('btn-split').getAttribute('aria-pressed'),
    title: document.getElementById('btn-split').title,
    toggleTitle: document.getElementById('btn-toggle').title,
    messages: window.__messages.slice(),
  };
});
if (!state.editing || !state.split) fail('split click did not enter split mode', state);
if (state.previewDisplay !== 'block' || state.editorDisplay !== 'block') {
  fail('split mode must show both panes', state);
}
if (!(state.editorLeft < state.previewLeft)) fail('source pane must be left of preview', state);
if (Math.abs(state.editorWidth - state.previewWidth) > 2) fail('panes are not equal width', state);
if (Math.abs(state.editorTop - state.previewTop) > 1) fail('panes do not start at the same top', state);
if (state.activeElement !== 'editor') fail('editor did not take focus', state);
if (state.pressed !== 'true' || state.title !== 'Exit Split View') {
  fail('split button state is wrong', state);
}
if (state.toggleTitle !== 'Preview') fail('edit toggle must keep preview semantics', state);
if (!state.messages.includes('render:42\n# Source title\n')) {
  fail('entering split must request a fresh render', state.messages);
}
await page.screenshot({ path: resolve(screenshotDir, '02-split-1440.png') });

await page.locator('#editor').fill('# Split title\n\n- one\n- two\n');
await page.waitForTimeout(350);
let messages = await readMessages();
const renderMessages = messages.filter((message) => message.startsWith('render:'));
const lastRender = renderMessages[renderMessages.length - 1];
if (lastRender !== 'render:42\n# Split title\n\n- one\n- two\n') {
  fail('typing must post a debounced live render for the active tab', renderMessages);
}
if (!messages.includes('dirty:1')) fail('typing must mark the document dirty', messages);

await page.evaluate(() => window.__setPreview('<h1>Split title</h1>', false, false));
state = await page.evaluate(() => ({
  previewHtml: document.getElementById('preview').innerHTML,
  split: document.body.classList.contains('split'),
}));
if (!state.split || !state.previewHtml.includes('<h1>Split title</h1>')) {
  fail('live preview update did not land in the visible preview pane', state);
}

await page.waitForTimeout(500);
messages = await readMessages();
if (!messages.includes('save:# Split title\n\n- one\n- two\n')) {
  fail('autosave must keep running in split mode', messages);
}

await page.locator('#btn-split').click();
await page.waitForTimeout(60);
state = await page.evaluate(() => ({
  editing: document.body.classList.contains('editing'),
  split: document.body.classList.contains('split'),
  previewDisplay: getComputedStyle(document.getElementById('preview')).display,
  editorDisplay: getComputedStyle(document.getElementById('editor')).display,
  pressed: document.getElementById('btn-split').getAttribute('aria-pressed'),
  title: document.getElementById('btn-split').title,
}));
if (!state.editing || state.split || state.editorDisplay !== 'block' || state.previewDisplay !== 'none') {
  fail('leaving split must fall back to source-only edit', state);
}
if (state.pressed !== 'false' || state.title !== 'Split View') {
  fail('split button did not reset', state);
}

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
await page.keyboard.press(`${modifier}+Shift+E`);
await page.waitForTimeout(60);
state = await page.evaluate(() => ({
  editing: document.body.classList.contains('editing'),
  split: document.body.classList.contains('split'),
}));
if (!state.editing || !state.split) fail('keyboard shortcut did not restore split mode', state);

await page.locator('#btn-toggle').click();
await page.waitForTimeout(60);
state = await page.evaluate(() => ({
  editing: document.body.classList.contains('editing'),
  split: document.body.classList.contains('split'),
  previewDisplay: getComputedStyle(document.getElementById('preview')).display,
  editorDisplay: getComputedStyle(document.getElementById('editor')).display,
}));
if (state.editing || state.split || state.previewDisplay !== 'block' || state.editorDisplay !== 'none') {
  fail('toggle from split must return to preview-only', state);
}

await page.locator('#btn-split').click();
await page.waitForTimeout(60);
await page.evaluate(() => window.__setEmptyPreview('<p>No document</p>'));
await page.waitForTimeout(350);
state = await page.evaluate(() => ({
  empty: document.body.classList.contains('empty'),
  editing: document.body.classList.contains('editing'),
  split: document.body.classList.contains('split'),
  pressed: document.getElementById('btn-split').getAttribute('aria-pressed'),
  toggleTitle: document.getElementById('btn-toggle').title,
  renderCount: window.__messages.filter((message) => message.startsWith('render:')).length,
}));
if (!state.empty || state.editing || state.split || state.pressed !== 'false') {
  fail('empty state must reset split mode', state);
}
if (state.toggleTitle !== 'Edit') fail('empty state must restore the edit icon label', state);

await page.evaluate(() => window.__setContent(
  '<p>Rendered paragraph 1</p>',
  '# Source title\n',
  '',
  false,
  false,
));
await page.locator('#btn-split').click();
await page.waitForTimeout(60);
const renderCountBeforeEmpty = (await readMessages())
  .filter((message) => message.startsWith('render:')).length;
await page.locator('#editor').fill('# pending render\n');
await page.evaluate(() => window.__setEmptyPreview('<p>No document</p>'));
await page.waitForTimeout(350);
const renderCountAfterEmpty = (await readMessages())
  .filter((message) => message.startsWith('render:')).length;
if (renderCountAfterEmpty !== renderCountBeforeEmpty) {
  fail('pending live render must not fire after leaving the document', {
    renderCountBeforeEmpty,
    renderCountAfterEmpty,
  });
}

await page.evaluate(() => window.__setContent(
  '<p>Rendered paragraph 1</p>',
  Array.from({ length: 60 }, (_, index) => `Source line ${index + 1}`).join('\n'),
  '',
  false,
  false,
));
await page.locator('#btn-split').click();
await page.waitForTimeout(60);
for (const [width, height] of [[1440, 900], [900, 700], [390, 844]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(60);
  const layout = await page.evaluate(() => {
    const editor = document.getElementById('editor').getBoundingClientRect();
    const preview = document.getElementById('preview').getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      editorWidth: editor.width,
      previewWidth: preview.width,
      editorTop: editor.top,
      previewTop: preview.top,
    };
  });
  if (layout.documentOverflow > 1) fail(`split view overflows at ${width}px`, layout);
  if (Math.abs(layout.editorWidth - layout.previewWidth) > 2) {
    fail(`split view columns diverge at ${width}px`, layout);
  }
  if (Math.abs(layout.editorTop - layout.previewTop) > 1) {
    fail(`split view columns misalign at ${width}px`, layout);
  }
  if (width === 900) {
    await page.screenshot({ path: resolve(screenshotDir, '03-split-900.png') });
  }
  if (width === 390) {
    await page.screenshot({ path: resolve(screenshotDir, '04-split-390.png') });
  }
}

await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => {
  document.getElementById('preview').innerHTML =
    '<div class="mdp-table-wrap"><table style="width:2400px"><tr>'
    + '<td>Wide table cell</td></tr></table></div>';
});
await page.waitForTimeout(60);
const tableState = await page.evaluate(() => {
  const wrap = document.querySelector('.mdp-table-wrap');
  return {
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    wrapScroll: wrap.scrollWidth - wrap.clientWidth,
  };
});
if (tableState.documentOverflow > 1) fail('wide table must not widen the split view', tableState);
if (tableState.wrapScroll <= 1) fail('wide table must scroll inside the preview column', tableState);

await page.emulateMedia({ colorScheme: 'dark' });
const darkBorder = await page.evaluate(
  () => getComputedStyle(document.getElementById('editor')).borderRightColor,
);
if (darkBorder !== 'rgb(51, 51, 51)') fail('dark mode divider color is wrong', { darkBorder });
await page.screenshot({ path: resolve(screenshotDir, '05-split-dark.png') });

await page.emulateMedia({ colorScheme: 'light', media: 'print' });
const printState = await page.evaluate(() => ({
  appDisplay: getComputedStyle(document.getElementById('app')).display,
  previewDisplay: getComputedStyle(document.getElementById('preview')).display,
  editorDisplay: getComputedStyle(document.getElementById('editor')).display,
  previewWidth: document.getElementById('preview').getBoundingClientRect().width,
  documentWidth: document.documentElement.clientWidth,
}));
if (printState.appDisplay !== 'block' || printState.previewDisplay !== 'block'
    || printState.editorDisplay !== 'none') {
  fail('print layout must collapse split mode to the full-width preview', printState);
}
if (Math.abs(printState.previewWidth - printState.documentWidth) > 2) {
  fail('print preview must span the full page width', printState);
}
await page.emulateMedia({ colorScheme: 'light', media: 'screen' });

await writeFile(resolve(screenshotDir, 'last-run.txt'), `${new Date().toISOString()}\n`, 'utf8');

await browser.close();
console.log(`[desktop-split-view-verify] OK (screenshots: ${screenshotDir})`);
