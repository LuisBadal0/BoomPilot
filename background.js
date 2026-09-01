const tabState = new Map();
const injectedTabs = new Set();
const DEFAULT_STATE = Object.freeze({ volume: 100, voiceBoost: 0, bassBoost: 0 });
const STORAGE_KEY = 'boompilot_tabState_v1';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeState(input = {}) {
  return {
    volume: clamp(Number.isFinite(input.volume) ? input.volume : DEFAULT_STATE.volume, 0, 500),
    voiceBoost: clamp(Number.isFinite(input.voiceBoost) ? input.voiceBoost : DEFAULT_STATE.voiceBoost, 0, 100),
    bassBoost: clamp(Number.isFinite(input.bassBoost) ? input.bassBoost : DEFAULT_STATE.bassBoost, 0, 100)
  };
}

function isChanged(state) {
  return state.volume !== 100 || state.voiceBoost !== 0 || state.bassBoost !== 0;
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

function getStorageArea() {
  // storage.session is ideal for tabState (cleared on browser close, not on suspend)
  // Fallback to storage.local for older Firefox.
  try {
    if (browser.storage.session) return browser.storage.session;
  } catch {}
  return browser.storage.local;
}

async function persistTabState() {
  try {
    const area = getStorageArea();
    await area.set({ [STORAGE_KEY]: Array.from(tabState.entries()) });
  } catch {}
}

async function restoreTabState() {
  try {
    const area = getStorageArea();
    const data = await area.get(STORAGE_KEY);
    const entries = data && data[STORAGE_KEY];
    if (Array.isArray(entries)) {
      for (const [tabId, state] of entries) {
        if (typeof tabId === 'number') tabState.set(tabId, normalizeState(state));
      }
    }
  } catch {}
}

async function ensureContentScript(tabId) {
  if (injectedTabs.has(tabId)) return true;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    injectedTabs.add(tabId);
    return true;
  } catch {
    return false;
  }
}

async function updateBadge(tabId) {
  if (typeof tabId !== 'number') {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = activeTab && activeTab.id;
  }
  if (typeof tabId !== 'number') return;

  const state = getOrCreateState(tabId);
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#d96a45' });
  if (browser.action.setBadgeTextColor) {
    await browser.action.setBadgeTextColor({ tabId, color: '#ffffff' });
  }
  await browser.action.setBadgeText({ tabId, text: getBadgeTextForState(state) });
}

browser.runtime.onMessage.addListener((message = {}, sender = {}) => {
  if (message.type === 'GET_TAB_AUDIO_STATE') {
    const tabId = sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : message.tabId;
    if (typeof tabId !== 'number') return Promise.resolve({ ...DEFAULT_STATE });
    return Promise.resolve(getOrCreateState(tabId));
  }

  if (message.type === 'SAVE_TAB_AUDIO_STATE') {
    const tabId = sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : message.tabId;
    if (typeof tabId !== 'number') return Promise.resolve({ ok: false });

    const previous = getOrCreateState(tabId);
    const next = normalizeState(message);
    tabState.set(tabId, next);
    persistTabState();

    if (next.volume !== previous.volume || next.voiceBoost !== previous.voiceBoost || next.bassBoost !== previous.bassBoost) {
      updateBadge(tabId);
    }
    return Promise.resolve({ ok: true });
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
          ...getOrCreateState(tab.id)
        }))
        .filter((item) => isChanged(item))
    }));
  }

  return undefined;
});

browser.tabs.onActivated.addListener(({ tabId }) => updateBadge(tabId));

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') injectedTabs.delete(tabId);
  if (changeInfo.status === 'complete' && tab && isInjectableUrl(tab.url)) updateBadge(tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  injectedTabs.delete(tabId);
  persistTabState();
  updateBadge();
});

browser.runtime.onInstalled.addListener(async () => {
  await restoreTabState();
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && isInjectableUrl(tab.url)) ensureContentScript(tab.id);
  }
});

browser.runtime.onStartup.addListener(async () => {
  await restoreTabState();
});

// Restore immediately on background load (MV3 service worker restart)
restoreTabState();
