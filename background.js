const tabState = new Map();
const injectedTabs = new Set();
const DEFAULT_STATE = Object.freeze({ volume: 100, voiceBoost: 0, bassBoost: 0 });

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

async function ensureContentScript(tabId) {
  if (injectedTabs.has(tabId)) return true;
  try {
    await browser.tabs.executeScript(tabId, { file: 'content.js', runAt: 'document_idle' });
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
  await browser.browserAction.setBadgeBackgroundColor({ tabId, color: '#d96a45' });
  if (browser.browserAction.setBadgeTextColor) {
    await browser.browserAction.setBadgeTextColor({ tabId, color: '#ffffff' });
  }
  await browser.browserAction.setBadgeText({ tabId, text: getBadgeTextForState(state) });
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

    if (next.volume !== previous.volume) updateBadge(tabId);
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
        .filter(isChanged)
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
  updateBadge();
});

browser.runtime.onInstalled.addListener(async () => {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && isInjectableUrl(tab.url)) ensureContentScript(tab.id);
  }
});
