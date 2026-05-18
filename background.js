const tabState = new Map();

function getOrCreateState(tabId) {
  const existing = tabState.get(tabId);
  if (existing) return existing;

  const created = { volume: 100, voiceBoost: 0, bassBoost: 0 };
  tabState.set(tabId, created);
  return created;
}

function getBadgeTextForState(state) {
  if (!state) return '';
  if (state.volume === 100) return '';
  return String(Math.round(state.volume));
}

async function updateBadge(tabId) {
  if (typeof tabId !== 'number') {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = activeTab && activeTab.id;
  }

  if (typeof tabId !== 'number') return;

  const state = getOrCreateState(tabId);
  const text = getBadgeTextForState(state);

  await browser.browserAction.setBadgeBackgroundColor({
    tabId,
    color: '#d96a45'
  });
  await browser.browserAction.setBadgeTextColor({
    tabId,
    color: '#ffffff'
  });

  await browser.browserAction.setBadgeText({
    tabId,
    text
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'GET_TAB_AUDIO_STATE') {
    const state = getOrCreateState(message.tabId);
    return Promise.resolve(state);
  }

  if (message.type === 'SAVE_TAB_AUDIO_STATE') {
    const state = getOrCreateState(message.tabId);
    const previousVolume = state.volume;

    if (typeof message.volume === 'number') state.volume = message.volume;
    if (typeof message.voiceBoost === 'number') state.voiceBoost = message.voiceBoost;
    if (typeof message.bassBoost === 'number') state.bassBoost = message.bassBoost;

    if (state.volume !== previousVolume) {
      updateBadge(message.tabId);
    }

    return Promise.resolve({ ok: true });
  }

  if (message.type === 'LIST_CHANGED_TABS') {
    return browser.tabs.query({}).then((tabs) => {
      const items = tabs
        .map((tab) => {
          const state = getOrCreateState(tab.id);
          return {
            tabId: tab.id,
            title: tab.title,
            url: tab.url,
            favIconUrl: tab.favIconUrl,
            audible: tab.audible,
            volume: state.volume,
            voiceBoost: state.voiceBoost,
            bassBoost: state.bassBoost
          };
        })
        .filter((item) => item.volume !== 100 || item.voiceBoost !== 0 || item.bassBoost !== 0);

      return { items };
    });
  }

  return undefined;
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  updateBadge(tabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') updateBadge(tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  updateBadge();
});
