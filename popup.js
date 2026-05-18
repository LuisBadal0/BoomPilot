async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
async function sendVolume(tabId, volume) {
  await browser.tabs.sendMessage(tabId, { type: 'SET_VOLUME', volume });
  await browser.runtime.sendMessage({ type: 'SAVE_TAB_VOLUME', tabId, volume });
}
function shortUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}
function renderChangedTabs(items, activeTabId) {
  const list = document.getElementById('changedTabs');
  if (!items.length) {
    list.innerHTML = '<div class="empty">No tabs changed yet.</div>';
    return;
  }
  list.innerHTML = items.map(item => `
    <div class="tab-item" data-tab-id="${item.tabId}">
      <div class="tab-main">
        <div class="tab-title">${(item.title || 'Untitled tab').replace(/[<>&"]/g, '')}${item.tabId === activeTabId ? ' • current' : ''}</div>
        <div class="tab-url">${shortUrl(item.url).replace(/[<>&"]/g, '')}</div>
      </div>
      <div class="pill">${item.volume}%</div>
    </div>
  `).join('');
  for (const node of list.querySelectorAll('.tab-item')) {
    node.addEventListener('click', async () => {
      const tabId = Number(node.dataset.tabId);
      await browser.tabs.update(tabId, { active: true });
      window.close();
    });
  }
}
(async function init() {
  const slider = document.getElementById('volume');
  const value = document.getElementById('value');
  const reset = document.getElementById('reset');
  const mute = document.getElementById('mute');
  const tab = await getActiveTab();
  if (!tab || !tab.id) { value.textContent = 'N/A'; slider.disabled = true; reset.disabled = true; mute.disabled = true; return; }
  const [state, changedTabsResponse] = await Promise.all([
    browser.runtime.sendMessage({ type: 'GET_TAB_VOLUME', tabId: tab.id }),
    browser.runtime.sendMessage({ type: 'LIST_CHANGED_TABS' })
  ]);
  const current = state && typeof state.volume === 'number' ? state.volume : 100;
  slider.value = String(current);
  value.textContent = `${current}%`;
  renderChangedTabs(changedTabsResponse.items || [], tab.id);
  slider.addEventListener('input', async () => {
    const volume = Number(slider.value);
    value.textContent = `${volume}%`;
    try {
      await sendVolume(tab.id, volume);
      const changed = await browser.runtime.sendMessage({ type: 'LIST_CHANGED_TABS' });
      renderChangedTabs(changed.items || [], tab.id);
    } catch (error) {
      value.textContent = 'Reload tab';
    }
  });
  reset.addEventListener('click', async () => {
    slider.value = '100';
    value.textContent = '100%';
    try {
      await sendVolume(tab.id, 100);
      const changed = await browser.runtime.sendMessage({ type: 'LIST_CHANGED_TABS' });
      renderChangedTabs(changed.items || [], tab.id);
    } catch (error) {
      value.textContent = 'Reload tab';
    }
  });
  mute.addEventListener('click', async () => {
    slider.value = '0';
    value.textContent = '0%';
    try {
      await sendVolume(tab.id, 0);
      const changed = await browser.runtime.sendMessage({ type: 'LIST_CHANGED_TABS' });
      renderChangedTabs(changed.items || [], tab.id);
    } catch (error) {
      value.textContent = 'Reload tab';
    }
  });
})();
