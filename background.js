const tabState = new Map();
const DEFAULT_STATE = Object.freeze({ volume: 100, voiceBoost: 0, bassBoost: 0 });

// Remembered sites: hostname -> audio state, kept in storage.local.
let siteSettings = {};
// Last site seen in each tab, so we only apply a remembered setting when
// the tab moves to a different site (not on every in-page navigation).
const tabHost = new Map();
// Tabs whose state currently comes from a remembered site.
const tabsFollowingSite = new Set();
let persistTimer = null;

const ready = browser.storage.local.get('siteSettings').then((stored) => {
  const saved = stored && stored.siteSettings;
  if (saved && typeof saved === 'object') siteSettings = saved;
}).catch(() => {});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeState(input = {}) {
  const state = {
    volume: clamp(Number.isFinite(input.volume) ? input.volume : DEFAULT_STATE.volume, 0, 500),
    voiceBoost: clamp(Number.isFinite(input.voiceBoost) ? input.voiceBoost : DEFAULT_STATE.voiceBoost, 0, 100),
    bassBoost: clamp(Number.isFinite(input.bassBoost) ? input.bassBoost : DEFAULT_STATE.bassBoost, 0, 100)
  };
  // The volume to go back to when unmuting; only meaningful while muted.
  if (state.volume === 0 && Number.isFinite(input.restoreVolume)) {
    state.restoreVolume = clamp(input.restoreVolume, 1, 500);
  }
  return state;
}

function isChanged(state) {
  return state.volume !== 100 || state.voiceBoost !== 0 || state.bassBoost !== 0;
}

function getMessageTabId(message, sender) {
  return typeof sender.tab?.id === 'number' ? sender.tab.id : message.tabId;
}

function getOrCreateState(tabId) {
  const existing = tabState.get(tabId);
  if (existing) return existing;
  const created = { ...DEFAULT_STATE };
  tabState.set(tabId, created);
  return created;
}

function getBadgeTextForState(state) {
  if (!state || state.volume === 100) return '';
  return String(Math.round(state.volume));
}

function isInjectableUrl(url = '') {
  return /^https?:/i.test(url);
}

function hostOf(url = '') {
  if (!isInjectableUrl(url)) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function persistSiteSettings() {
  // Slider drags save often; batch them into one storage write.
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    browser.storage.local.set({ siteSettings }).catch(() => {});
  }, 400);
}

async function getTabHost(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    return hostOf(tab.url);
  } catch {
    return null;
  }
}

// Called when a tab loads a page. Applies the remembered setting when the
// tab arrives on a remembered site, and drops it when the tab leaves.
function applySiteMemory(tabId, url) {
  const host = hostOf(url);
  if (tabHost.has(tabId) && tabHost.get(tabId) === host) return;
  tabHost.set(tabId, host);

  const saved = host && siteSettings[host];
  if (saved) {
    tabState.set(tabId, normalizeState(saved));
    tabsFollowingSite.add(tabId);
  } else if (tabsFollowingSite.has(tabId)) {
    tabState.set(tabId, { ...DEFAULT_STATE });
    tabsFollowingSite.delete(tabId);
  } else {
    return;
  }
  updateBadge(tabId);
}

async function ensureContentScript(tabId) {
  // content.js guards against double-injection itself.
  try {
    await browser.tabs.executeScript(tabId, { file: 'content.js', allFrames: true, runAt: 'document_idle' });
  } catch {}
}

async function updateBadge(tabId) {
  if (typeof tabId !== 'number') {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = activeTab && activeTab.id;
  }
  if (typeof tabId !== 'number') return;

  const state = getOrCreateState(tabId);
  try {
    await browser.browserAction.setBadgeBackgroundColor({ tabId, color: '#d96a45' });
    if (browser.browserAction.setBadgeTextColor) {
      await browser.browserAction.setBadgeTextColor({ tabId, color: '#ffffff' });
    }
    await browser.browserAction.setBadgeText({ tabId, text: getBadgeTextForState(state) });
  } catch {
    // The tab closed in the meantime.
  }
}

async function saveTabState(tabId, input) {
  await ready;
  const previous = getOrCreateState(tabId);
  const next = normalizeState(input);
  tabState.set(tabId, next);
  if (next.volume !== previous.volume) updateBadge(tabId);

  const host = await getTabHost(tabId);
  if (host && siteSettings[host]) {
    siteSettings[host] = next;
    tabHost.set(tabId, host);
    tabsFollowingSite.add(tabId);
    persistSiteSettings();
  }
  return { ok: true };
}

async function getSiteMemory(tabId) {
  await ready;
  const host = await getTabHost(tabId);
  return { host, remembered: Boolean(host && siteSettings[host]) };
}

async function setSiteMemory(tabId, enabled) {
  await ready;
  const host = await getTabHost(tabId);
  if (!host) return { host: null, remembered: false };

  if (enabled) {
    siteSettings[host] = normalizeState(getOrCreateState(tabId));
    tabHost.set(tabId, host);
    tabsFollowingSite.add(tabId);
  } else {
    delete siteSettings[host];
    // Other tabs on this site keep their current volume for now.
    for (const [id, seenHost] of tabHost) {
      if (seenHost === host) tabsFollowingSite.delete(id);
    }
  }
  persistSiteSettings();
  return { host, remembered: Boolean(enabled) };
}

browser.runtime.onMessage.addListener((message = {}, sender = {}) => {
  if (message.type === 'GET_TAB_AUDIO_STATE') {
    const tabId = getMessageTabId(message, sender);
    if (typeof tabId !== 'number') return Promise.resolve({ ...DEFAULT_STATE });
    return ready.then(() => {
      // A page asking for its state has just loaded: apply site memory now
      // in case it hasn't been applied yet (for example right after startup).
      if (sender.tab && sender.tab.url) applySiteMemory(tabId, sender.tab.url);
      return getOrCreateState(tabId);
    });
  }

  if (message.type === 'SAVE_TAB_AUDIO_STATE') {
    const tabId = getMessageTabId(message, sender);
    if (typeof tabId !== 'number') return Promise.resolve({ ok: false });
    return saveTabState(tabId, message);
  }

  if (message.type === 'GET_SITE_MEMORY') {
    if (typeof message.tabId !== 'number') return Promise.resolve({ host: null, remembered: false });
    return getSiteMemory(message.tabId);
  }

  if (message.type === 'SET_SITE_MEMORY') {
    if (typeof message.tabId !== 'number') return Promise.resolve({ host: null, remembered: false });
    return setSiteMemory(message.tabId, message.enabled === true);
  }

  if (message.type === 'LIST_CHANGED_TABS') {
    return browser.tabs.query({}).then((tabs) => ({
      items: tabs
        .map((tab) => ({
          tabId: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          audible: tab.audible,
          ...(tabState.get(tab.id) || { ...DEFAULT_STATE })
        }))
        .filter(isChanged)
    }));
  }

  return undefined;
});

browser.tabs.onActivated.addListener(({ tabId }) => updateBadge(tabId));

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) ready.then(() => applySiteMemory(tabId, changeInfo.url));
  if (changeInfo.status === 'complete' && tab && isInjectableUrl(tab.url)) updateBadge(tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  tabHost.delete(tabId);
  tabsFollowingSite.delete(tabId);
  updateBadge();
});

browser.runtime.onInstalled.addListener(async () => {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && isInjectableUrl(tab.url)) ensureContentScript(tab.id);
  }
});
