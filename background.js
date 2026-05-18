const tabVolumes = new Map();

function badgeText(volume) {
  if (typeof volume !== 'number' || volume === 100) return '';
  if (volume <= 0) return '0';
  if (volume < 1000) return String(Math.round(volume));
  return `${Math.round(volume / 10) / 100}k`;
}

async function updateBadge(tabId, volume) {
  const text = badgeText(volume);
  await browser.browserAction.setBadgeText({ tabId, text });
  if (text) {
    await browser.browserAction.setBadgeBackgroundColor({ tabId, color: volume === 0 ? '#7a1f1f' : '#c94b00' });
  }
  await browser.browserAction.setTitle({ tabId, title: volume === 100 ? 'BoomPilot' : `BoomPilot — ${volume}%` });
}

async function cleanupMissingTabs() {
  const openTabs = await browser.tabs.query({});
  const openIds = new Set(openTabs.map(tab => tab.id));
  for (const tabId of [...tabVolumes.keys()]) {
    if (!openIds.has(tabId)) tabVolumes.delete(tabId);
  }
}

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'SAVE_TAB_VOLUME') {
    tabVolumes.set(message.tabId, message.volume);
    await updateBadge(message.tabId, message.volume);
    return { ok: true };
  }
  if (message.type === 'GET_TAB_VOLUME') {
    const volume = tabVolumes.get(message.tabId) ?? 100;
    await updateBadge(message.tabId, volume);
    return { volume };
  }
  if (message.type === 'LIST_CHANGED_TABS') {
    await cleanupMissingTabs();
    const tabs = await browser.tabs.query({ currentWindow: true });
    const items = tabs
      .filter(tab => tabVolumes.has(tab.id) && tabVolumes.get(tab.id) !== 100)
      .map(tab => ({
        tabId: tab.id,
        title: tab.title || 'Untitled tab',
        url: tab.url || '',
        audible: !!tab.audible,
        volume: tabVolumes.get(tab.id)
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
    return { items };
  }
  return false;
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const volume = tabVolumes.get(tabId) ?? 100;
  await updateBadge(tabId, volume);
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabVolumes.delete(tabId);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const volume = tabVolumes.get(tabId) ?? 100;
  await updateBadge(tabId, volume);
  try { await browser.tabs.sendMessage(tabId, { type: 'SET_VOLUME', volume }); } catch (error) {}
});
