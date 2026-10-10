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
  .replaceAll('{btn_format}', 'Format Markdown (Alt+F)')
  .replaceAll('{menu_bold}', 'Bold')
  .replaceAll('{menu_italic}', 'Italic')
  .replaceAll('{menu_strike}', 'Strikethrough')
  .replaceAll('{menu_inline_code}', 'Inline Code')
  .replaceAll('{menu_link}', 'Link')
  .replaceAll('{menu_bullet_list}', 'Bullet List')
  .replaceAll('{menu_numbered_list}', 'Numbered List')
  .replaceAll('{menu_quote}', 'Quote')
  .replaceAll('{menu_code_block}', 'Code Block')
  .replaceAll('{menu_table}', 'Table')
  .replaceAll('{menu_table_template_js}', '| Column 1 | Column 2 |\\n| --- | --- |\\n| Cell | Cell |')
  .replaceAll('{menu_undo}', 'Undo')
  .replaceAll('{btn_undo}', 'Undo (Cmd/Ctrl+Z)')
  .replaceAll('{btn_autosave_on}', 'Autosave on (click to turn off)')
  .replaceAll('{btn_autosave_off}', 'Autosave off (Cmd/Ctrl+S saves manually)');

const menuCss = mainRs
  .split('\n')
  .filter((line) => line.startsWith('.editor-menu'))
  .join('\n')
  .replaceAll('{{', '{')
  .replaceAll('}}', '}');
if (!menuCss.includes('.editor-menu .menu-item')) {
  throw new Error('editor menu CSS not found');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.route('https://md-preview.test/**', (route) => route.fulfill({
  contentType: 'text/html',
  body: '<!doctype html><title>MD Preview editor test</title>',
}));
await page.goto('https://md-preview.test/');
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
      body:not(.editing) #btn-format { display: none !important; }
      ${menuCss}
      .toolbar { position: fixed; top: 0; right: 0; z-index: 10; display: flex; gap: 6px; }
      .toolbar button { width: 34px; height: 34px; }
      .toolbar button[hidden] { display: none !important; }
      .zoom-popover { display: none; }
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
      <button id="btn-undo"></button>
      <button id="btn-format" hidden></button>
      <button id="btn-autosave" aria-pressed="true"></button>
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
      <div id="preview"><p>preview</p></div>
      <textarea id="editor" spellcheck="false"></textarea>
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

async function setSource(text) {
  await page.evaluate((value) => {
    const editor = document.getElementById('editor');
    window.__markSaved(editor.value);
    window.__setContent('<p>preview</p>', value, '', false, false);
  }, text);
}

async function selectRange(start, end) {
  await page.evaluate(({ from, to }) => {
    const editor = document.getElementById('editor');
    editor.focus();
    editor.setSelectionRange(from, to);
  }, { from: start, to: end });
}

async function editorState() {
  return page.evaluate(() => {
    const editor = document.getElementById('editor');
    return {
      value: editor.value,
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
    };
  });
}

async function openMenuOnEditor(lineIndex = 0, column = 0) {
  const point = await page.evaluate(({ line, col }) => {
    const editor = document.getElementById('editor');
    const style = getComputedStyle(editor);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = style.fontSize + ' ' + style.fontFamily;
    const width = context.measureText('x'.repeat(col)).width;
    const lineHeight = parseFloat(style.lineHeight) || 22.4;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    return {
      x: Math.max(2, paddingLeft + width + 2),
      y: paddingTop + lineHeight * line + lineHeight / 2,
    };
  }, { line: lineIndex, col: column });
  await page.locator('#editor').click({ button: 'right', position: point });
  await page.waitForTimeout(60);
}

async function clickMenuItem(label) {
  await page.locator('.editor-menu .menu-item', { hasText: label }).first().click();
  await page.waitForTimeout(60);
}

await page.evaluate(() => window.__setTabs([
  { id: 3, name: 'menu.md', path: '/tmp/menu.md', active: true, format: true },
]));
await page.evaluate(() => window.__setContent('<p>preview</p>', 'alpha beta gamma\n', '', false, false));
await page.locator('#btn-toggle').click();
await page.waitForTimeout(60);

await setSource('alpha beta gamma\nsecond line\n');
await selectRange(6, 10);
await openMenuOnEditor(0, 7);

let state = await page.evaluate(() => {
  const menu = document.getElementById('editor-menu');
  const rect = menu.getBoundingClientRect();
  return {
    hidden: menu.hidden,
    itemCount: menu.querySelectorAll('.menu-item').length,
    separatorCount: menu.querySelectorAll('.menu-sep').length,
    labels: Array.prototype.map.call(menu.querySelectorAll('.menu-item span:first-child'), (span) => span.textContent),
    boldShortcut: menu.querySelector('[data-menu-action="bold"] .menu-shortcut').textContent,
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    focusedAction: document.activeElement.getAttribute('data-menu-action'),
  };
});
if (state.hidden) fail('right click must open the editor menu', state);
if (state.itemCount !== 11 || state.separatorCount !== 3) fail('menu item layout is wrong', state);
if (state.labels.join('|') !== 'Undo|Bold|Italic|Strikethrough|Inline Code|Link|Bullet List|Numbered List|Quote|Code Block|Table') {
  fail('menu labels are wrong', state);
}
if (state.boldShortcut !== 'Ctrl+B') fail('shortcut hint is wrong', state);
if (state.left < 0 || state.top < 0 || state.right > state.innerWidth + 1 || state.bottom > state.innerHeight + 1) {
  fail('menu must stay inside the viewport', state);
}
if (state.focusedAction !== 'undo') fail('menu must focus the first item', state);

await clickMenuItem('Bold');
state = await editorState();
if (state.value !== 'alpha **beta** gamma\nsecond line\n') fail('bold action failed', state);
if (state.selectionStart !== 8 || state.selectionEnd !== 12) fail('bold action lost the selection', state);

await openMenuOnEditor(0, 10);
await clickMenuItem('Bold');
state = await editorState();
if (state.value !== 'alpha beta gamma\nsecond line\n') fail('bold toggle did not unwrap', state);

await selectRange(6, 10);
await page.keyboard.press('Control+B');
await page.waitForTimeout(60);
state = await editorState();
if (state.value !== 'alpha **beta** gamma\nsecond line\n') fail('bold shortcut failed', state);
await page.keyboard.press('Control+B');
await page.waitForTimeout(60);

await setSource('alpha\n');
await selectRange(5, 5);
await page.keyboard.press('Control+B');
await page.waitForTimeout(60);
state = await editorState();
if (state.value !== 'alpha****\n' || state.selectionStart !== 7 || state.selectionEnd !== 7) {
  fail('bold without a selection must place the caret between markers', state);
}

await setSource('alpha beta gamma\nsecond line\n');
await selectRange(6, 10);
await openMenuOnEditor(0, 7);
await clickMenuItem('Italic');
state = await editorState();
if (state.value !== 'alpha *beta* gamma\nsecond line\n') fail('italic action failed', state);

await setSource('alpha beta gamma\n');
await selectRange(6, 10);
await openMenuOnEditor(0, 7);
await clickMenuItem('Strikethrough');
state = await editorState();
if (state.value !== 'alpha ~~beta~~ gamma\n') fail('strikethrough action failed', state);

await setSource('alpha beta gamma\n');
await selectRange(6, 10);
await openMenuOnEditor(0, 7);
await clickMenuItem('Inline Code');
state = await editorState();
if (state.value !== 'alpha `beta` gamma\n') fail('inline code action failed', state);

await setSource('alpha beta gamma\n');
await selectRange(6, 10);
await page.keyboard.press('Control+K');
await page.waitForTimeout(60);
state = await editorState();
if (state.value !== 'alpha [beta](url) gamma\n') fail('link shortcut failed', state);
if (state.value.slice(state.selectionStart, state.selectionEnd) !== 'url') {
  fail('link action must select the url placeholder', state);
}

await setSource('alpha beta gamma\n');
await selectRange(6, 10);
await page.keyboard.press('Control+Shift+Backquote');
await page.waitForTimeout(60);
state = await editorState();
if (state.value !== 'alpha `beta` gamma\n') fail('inline code shortcut failed', state);

await setSource('one\ntwo\n');
await selectRange(0, 'one\ntwo'.length);
await openMenuOnEditor(0, 1);
await clickMenuItem('Bullet List');
state = await editorState();
if (state.value !== '- one\n- two\n') fail('bullet list action failed', state);
await openMenuOnEditor(0, 1);
await clickMenuItem('Bullet List');
state = await editorState();
if (state.value !== 'one\ntwo\n') fail('bullet list toggle did not unwrap', state);

await setSource('one\ntwo\n');
await selectRange(0, 'one\ntwo'.length);
await openMenuOnEditor(0, 1);
await clickMenuItem('Numbered List');
state = await editorState();
if (state.value !== '1. one\n2. two\n') fail('numbered list action failed', state);

await setSource('one\ntwo\n');
await selectRange(0, 'one\ntwo'.length);
await openMenuOnEditor(0, 1);
await clickMenuItem('Quote');
state = await editorState();
if (state.value !== '> one\n> two\n') fail('quote action failed', state);

await setSource('alpha\n');
await selectRange(0, 5);
await openMenuOnEditor(0, 1);
await clickMenuItem('Code Block');
state = await editorState();
if (state.value !== '```\nalpha\n```\n') fail('code block action failed', state);

await setSource('intro\n');
await selectRange(6, 6);
await openMenuOnEditor(1, 0);
await clickMenuItem('Table');
state = await editorState();
if (state.value !== 'intro\n\n| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n') {
  fail('table action failed', state);
}

await setSource('alpha\n');
await selectRange(5, 5);
await page.keyboard.press('Control+B');
await page.waitForTimeout(60);
state = await editorState();
if (state.value !== 'alpha****\n') fail('bold must apply before the undo button check', state);
await page.locator('#btn-undo').click();
await page.waitForTimeout(80);
state = await editorState();
if (state.value !== 'alpha\n') fail('undo button must revert the last edit', state);

await selectRange(5, 5);
await page.keyboard.type('X');
await page.waitForTimeout(60);
state = await editorState();
if (state.value !== 'alphaX\n') fail('typing must apply before the Ctrl+Z check', state);
await page.keyboard.press('Control+Z');
await page.waitForTimeout(80);
state = await editorState();
if (state.value !== 'alpha\n') fail('Ctrl+Z must revert the last edit', state);

state = await page.evaluate(() => ({
  pressed: document.getElementById('btn-autosave').getAttribute('aria-pressed'),
  display: getComputedStyle(document.getElementById('btn-autosave')).display,
}));
if (state.pressed !== 'true' || state.display === 'none') {
  fail('autosave must default to on and be visible in edit mode', state);
}

await page.locator('#btn-autosave').click();
await page.waitForTimeout(60);
state = await page.evaluate(() => ({
  pressed: document.getElementById('btn-autosave').getAttribute('aria-pressed'),
  title: document.getElementById('btn-autosave').title,
  stored: localStorage.getItem('md-preview-autosave-v1'),
}));
if (state.pressed !== 'false' || state.title !== 'Autosave off (Cmd/Ctrl+S saves manually)' || state.stored !== '0') {
  fail('turning autosave off failed', state);
}

await page.evaluate(() => { window.__messages.length = 0; });
await page.locator('#editor').fill('manual save draft\n');
await page.waitForTimeout(900);
let messages = await page.evaluate(() => window.__messages.slice());
if (messages.some((message) => message.startsWith('save:'))) {
  fail('autosave off must not write after typing', messages);
}
await page.keyboard.press('Control+S');
await page.waitForTimeout(80);
messages = await page.evaluate(() => window.__messages.slice());
if (!messages.includes('save:manual save draft\n')) {
  fail('Ctrl+S must still save while autosave is off', messages);
}

await page.locator('#btn-autosave').click();
await page.waitForTimeout(60);
await page.evaluate(() => { window.__messages.length = 0; });
await page.locator('#editor').fill('autosave draft\n');
await page.waitForTimeout(900);
messages = await page.evaluate(() => window.__messages.slice());
if (!messages.includes('save:autosave draft\n')) {
  fail('autosave must write again once re-enabled', messages);
}
state = await page.evaluate(() => ({
  pressed: document.getElementById('btn-autosave').getAttribute('aria-pressed'),
  stored: localStorage.getItem('md-preview-autosave-v1'),
}));
if (state.pressed !== 'true' || state.stored !== '1') {
  fail('turning autosave back on failed', state);
}

await selectRange(0, 0);
await openMenuOnEditor(0, 0);
state = await page.evaluate(() => ({ hidden: document.getElementById('editor-menu').hidden }));
if (state.hidden) fail('menu must reopen for escape check', state);
await page.keyboard.press('Escape');
await page.waitForTimeout(60);
state = await page.evaluate(() => ({
  hidden: document.getElementById('editor-menu').hidden,
  editing: document.body.classList.contains('editing'),
}));
if (!state.hidden || !state.editing) fail('escape must close the menu without leaving edit', state);

await openMenuOnEditor(0, 0);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(40);
state = await page.evaluate(() => ({
  focusedAction: document.activeElement.getAttribute('data-menu-action'),
}));
if (state.focusedAction !== 'bold') fail('arrow key navigation failed', state);

await page.mouse.click(870, 650);
await page.waitForTimeout(60);
state = await page.evaluate(() => ({ hidden: document.getElementById('editor-menu').hidden }));
if (!state.hidden) fail('clicking outside must close the menu', state);

await browser.close();
console.log('[desktop-editor-verify] OK');
