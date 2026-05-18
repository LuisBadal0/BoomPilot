const tabState = new Map();

function getOrCreateState(tabId) {
  const existing = tabState.get(tabId);
  if (existing) return existing;
  const created = { volume: 100, voiceBoost: 0, bassBoost: 0 };
  tabState.set(tabId, created);
  return created;
}

async function updateBadge() {
  const changedCount = [...tabState.values()].filter((item) => item.volume !== 100 || item.voiceBoost !== 0 || item.bassBoost !== 0).length;
  await browser.browserAction.setBadgeBackgroundColor({ color: '#01696f' });
  await browser.browserAction.setBadgeText({ text: changedCount ? String(changedCount) : '' });
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'GET_TAB_AUDIO_STATE') {
    const state = getOrCreateState(message.tabId);
    return Promise.resolve(state);
  }

  if (message.type === 'SAVE_TAB_AUDIO_STATE') {
    const state = getOrCreateState(message.tabId);
    if (typeof message.volume === 'number') state.volume = message.volume;
    if (typeof message.voiceBoost === 'number') state.voiceBoost = message.voiceBoost;
    if (typeof message.bassBoost === 'number') state.bassBoost = message.bassBoost;
    updateBadge();
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

browser.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  updateBadge();
});
