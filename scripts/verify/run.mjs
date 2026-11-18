// End-to-end check of BoomPilot in a real Firefox.
//
//   npm run verify            (headless)
//   npm run verify -- --headed
//
// Installs a throwaway copy of the extension with a few test-only files
// (scripts/verify/ext), opens local test pages (fixtures.mjs), drives the
// real popup, and checks what the pages' media elements actually do.
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtures } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const headed = process.argv.includes('--headed');

// ---------------------------------------------------------------- build

function buildTestCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boompilot-verify-'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const files = new Set(['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'assets/icon.svg']);
  for (const script of manifest.background.scripts) files.add(script);
  for (const entry of manifest.content_scripts) for (const js of entry.js) files.add(js);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(dir, file));
  }
  for (const file of fs.readdirSync(path.join(here, 'ext'))) {
    fs.copyFileSync(path.join(here, 'ext', file), path.join(dir, file));
  }

  manifest.background.scripts.push('test-background.js');
  manifest.content_scripts.push({ matches: ['http://*/bridge.html'], js: ['test-bridge.js'], run_at: 'document_start' });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const popupHtml = path.join(dir, 'popup.html');
  const html = fs.readFileSync(popupHtml, 'utf8');
  const tag = '<script src="popup.js"></script>';
  if (!html.includes(tag)) throw new Error('popup.html no longer loads popup.js the way the verify run expects');
  fs.writeFileSync(popupHtml, html.replace(tag, `<script src="test-popup-shim.js"></script>\n${tag}`));
  return dir;
}

// ---------------------------------------------------------------- browser

let driver;
// Test pages open as tabs in the first window; the bridge page has a window
// of its own so that using it doesn't switch tabs under the popup.
let pagesHandle;
let bridgeHandle;
let sites;

// Runs a command in test-background.js through the bridge page.
async function bridge(command, args = {}) {
  await driver.switchTo().window(bridgeHandle);
  const reply = await driver.executeAsyncScript(`
    const [command, args, done] = arguments;
    const id = Math.random();
    const onReply = (event) => {
      if (!event.data || event.data.bpTestReply !== id) return;
      window.removeEventListener('message', onReply);
      done(event.data);
    };
    window.addEventListener('message', onReply);
    window.postMessage({ bpTestRequest: id, command, args }, '*');
  `, command, args);
  if (reply.error) throw new Error(`${command}: ${reply.error}`);
  return reply.result;
}

let pageCount = 0;

// Opens a test page in a new tab and returns its WebDriver handle and tab id.
async function openPage(pathname) {
  const url = `${sites.siteA}${pathname}?page=${++pageCount}`;
  await driver.switchTo().window(pagesHandle);
  await driver.switchTo().newWindow('tab');
  await driver.get(url);
  const handle = await driver.getWindowHandle();
  const tab = (await bridge('tabs')).find((t) => t.url === url);
  if (!tab) throw new Error(`No tab for ${url}`);
  return { handle, tabId: tab.id, url };
}

async function closePage(page) {
  await driver.switchTo().window(page.handle);
  await driver.close();
  await driver.switchTo().window(bridgeHandle);
}

// Reads the page's <audio id="media">, inside the iframe when frame is set.
async function media(page, { frame = false } = {}) {
  await driver.switchTo().window(page.handle);
  if (frame) await driver.switchTo().frame(0);
  const state = await driver.executeScript(`
    const m = document.getElementById('media');
    return m && { volume: m.volume, paused: m.paused, time: m.currentTime, error: m.error && m.error.code };
  `);
  await driver.switchTo().defaultContent();
  return state;
}

async function setPageVolume(page, volume) {
  await driver.switchTo().window(page.handle);
  await driver.executeScript('document.getElementById("media").volume = arguments[0];', volume);
}

// The real toolbar popup, opened for the given page.
class Popup {
  static async open(page) {
    await bridge('openPopup', { tabId: page.tabId });
    return new Popup();
  }

  state() {
    return bridge('popup', { action: 'state' });
  }

  click(selector) {
    return bridge('popup', { action: 'click', selector });
  }

  preset(volume) {
    return this.click(`.preset[data-volume="${volume}"]`);
  }

  close() {
    return bridge('popup', { action: 'close' });
  }
}

// ---------------------------------------------------------------- checks

const results = [];

// Polls read() until test passes or the timeout runs out; returns the last value.
async function eventually(read, test, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (test(value) || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
}

function expect(name, ok, detail) {
  results.push({ name, ok });
  console.log(ok ? `  PASS  ${name}` : `  FAIL  ${name}\n        got: ${JSON.stringify(detail)}`);
}

async function expectMedia(name, page, test, options) {
  const value = await eventually(() => media(page, options), (m) => Boolean(m) && test(m));
  expect(name, Boolean(value) && test(value), value);
}

const near = (a, b) => Math.abs(a - b) < 0.01;

async function playing(page, options) {
  const first = await media(page, options);
  await new Promise((r) => setTimeout(r, 600));
  const second = await media(page, options);
  return Boolean(first && second && !second.paused && second.time !== first.time && !second.error);
}

async function scenario(title, fn) {
  console.log(`\n${title}`);
  try {
    await fn();
  } catch (error) {
    expect(`${title} ran without errors`, false, String((error && error.stack) || error));
  }
}

async function main() {
  sites = await startFixtures();
  const options = new firefox.Options()
    // Let the test pages play sound without a click.
    .setPreference('media.autoplay.default', 0)
    .setPreference('media.autoplay.blocking_policy', 0)
    // Lets the run open the toolbar popup without a click.
    .setPreference('extensions.openPopupWithoutUserGesture.enabled', true);
  if (!headed) options.addArguments('-headless');
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);

  const copy = buildTestCopy();
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
  try {
    await driver.installAddon(copy, true);
    pagesHandle = await driver.getWindowHandle();
    await driver.switchTo().newWindow('window');
    await driver.get(`${sites.siteA}/bridge.html`);
    bridgeHandle = await driver.getWindowHandle();

    await scenario('Same-origin media (Web Audio)', async () => {
      const page = await openPage('/same-origin.html');
      expect('page plays before any change', await playing(page), await media(page));
      const popup = await Popup.open(page);
      const shown = await popup.preset(200);
      expect('popup shows Boosted, not Limited', shown.status === 'Boosted' && shown.value === '200', shown);
      await expectMedia('media element volume is left at 100%', page, (m) => near(m.volume, 1));
      expect('page still plays after boost', await playing(page), await media(page));
      const badge = await eventually(() => bridge('badge', { tabId: page.tabId }), (b) => b === '200');
      expect('toolbar badge shows 200', badge === '200', badge);
      const reset = await popup.click('#reset');
      expect('reset shows 100 and Normal', reset.value === '100' && reset.status === 'Normal', reset);
      const cleared = await eventually(() => bridge('badge', { tabId: page.tabId }), (b) => b === '');
      expect('badge hidden at 100%', cleared === '', cleared);
      await popup.close();
      await closePage(page);
    });

    await scenario('Cross-origin media without CORS (direct volume)', async () => {
      const page = await openPage('/cross-origin.html');
      const popup = await Popup.open(page);
      await popup.preset(50);
      await expectMedia('50% sets media volume to 0.5', page, (m) => near(m.volume, 0.5));
      expect('page still plays at 50%', await playing(page), await media(page));
      await setPageVolume(page, 0.8);
      await expectMedia('a page volume change keeps the 50% reduction (0.8 -> 0.4)', page, (m) => near(m.volume, 0.4));
      const boosted = await popup.preset(200);
      expect('popup shows Limited at 200%', boosted.status === 'Limited', boosted);
      await expectMedia('200% stops at the page volume (0.8)', page, (m) => near(m.volume, 0.8));
      const muted = await popup.click('#mute');
      expect('mute shows Muted', muted.status === 'Muted' && muted.slider === 0, muted);
      await expectMedia('mute sets media volume to 0', page, (m) => m.volume === 0);
      const unmuted = await popup.click('#mute');
      expect('unmute brings back 200%', unmuted.slider === 200, unmuted);
      await expectMedia('unmute restores media volume', page, (m) => near(m.volume, 0.8));
      await popup.click('#reset');
      await expectMedia('reset gives the page its own volume back', page, (m) => near(m.volume, 0.8));
      await popup.close();
      await closePage(page);
    });

    await scenario('Cross-origin media with CORS (Web Audio)', async () => {
      const page = await openPage('/cors.html');
      const popup = await Popup.open(page);
      const shown = await popup.preset(200);
      expect('popup shows Boosted, not Limited', shown.status === 'Boosted', shown);
      expect('page still plays after boost', await playing(page), await media(page));
      await popup.click('#reset');
      await popup.close();
      await closePage(page);
    });

    await scenario('Embedded player from another site (iframe)', async () => {
      const page = await openPage('/embed.html');
      await eventually(() => media(page, { frame: true }), Boolean);
      const popup = await Popup.open(page);
      await popup.preset(50);
      await expectMedia('50% reaches the media inside the iframe', page, (m) => near(m.volume, 0.5), { frame: true });
      await popup.click('#reset');
      await popup.close();
      await closePage(page);
    });

    await scenario('Media added after the change', async () => {
      const page = await openPage('/late.html');
      const popup = await Popup.open(page);
      await popup.preset(50);
      await expectMedia('media added later gets 50% too', page, (m) => near(m.volume, 0.5));
      await popup.click('#reset');
      await popup.close();
      await closePage(page);
    });

    await scenario('Remember per site', async () => {
      const host = new URL(sites.siteA).hostname;
      const first = await openPage('/cross-origin.html');
      const popup = await Popup.open(first);
      await popup.preset(50);
      const remembered = await popup.click('#remember');
      expect('remember button turns on', remembered.remembered === true, remembered);
      const stored = await eventually(() => bridge('storage', { key: 'siteSettings' }), (s) => s.siteSettings?.[host]?.volume === 50);
      expect(`volume saved for ${host}`, stored.siteSettings?.[host]?.volume === 50, stored);
      await popup.close();

      const second = await openPage('/cross-origin.html');
      await expectMedia('a new tab on the same site starts at 50%', second, (m) => near(m.volume, 0.5));
      const badge = await eventually(() => bridge('badge', { tabId: second.tabId }), (b) => b === '50');
      expect('the new tab shows badge 50', badge === '50', badge);

      const again = await Popup.open(second);
      const forgotten = await again.click('#remember');
      expect('remember button turns off', forgotten.remembered === false, forgotten);
      const cleared = await eventually(() => bridge('storage', { key: 'siteSettings' }), (s) => !s.siteSettings?.[host]);
      expect('site removed from storage', !cleared.siteSettings?.[host], cleared);
      await again.click('#reset');
      await again.close();
      await closePage(second);
      await closePage(first);
    });
  } finally {
    await driver.quit().catch(() => {});
    await sites.close();
    fs.rmSync(copy, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
