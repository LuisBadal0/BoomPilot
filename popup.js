async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
function shortUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; }
}
function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
async function sendVolume(tabId, volume) {
  await browser.tabs.sendMessage(tabId, { type: 'SET_VOLUME', volume });
  await browser.runtime.sendMessage({ type: 'SAVE_TAB_VOLUME', tabId, volume });
}
function updateStatus(volume) {
  const status = document.getElementById('status');
  if (volume === 0) status.textContent = 'Muted';
  else if (volume < 100) status.textContent = 'Lowered';
  else if (volume === 100) status.textContent = 'Normal';
  else status.textContent = 'Boosted';
}
async function refreshChangedTabs(activeTabId) {
  const list = document.getElementById('changedTabs');
  const count = document.getElementById('count');
  const { items = [] } = await browser.runtime.sendMessage({ type: 'LIST_CHANGED_TABS' });
  count.textContent = `${items.length} tab${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    list.innerHTML = '<div class="empty">No tabs changed yet.</div>';
    return;
  }
  list.innerHTML = items.map(item => `
    <div class="tab-item">
      <div class="tab-open" data-open-tab="${item.tabId}">
        <div class="tab-title">${escapeHtml(item.title || 'Untitled tab')}${item.tabId === activeTabId ? ' • current' : ''}</div>
        <div class="tab-url">${escapeHtml(shortUrl(item.url))}</div>
        <div class="tab-meta">
          <span class="pill">${item.volume}%</span>
          ${item.audible ? '<span class="pill">Playing</span>' : ''}
        </div>
      </div>
      <div class="mini-actions">
        <button class="mini-btn mini-danger" data-mute-tab="${item.tabId}">Mute</button>
        <button class="mini-btn mini-primary" data-reset-tab="${item.tabId}">Reset</button>
      </div>
    </div>
  `).join('');

  for (const node of list.querySelectorAll('[data-open-tab]')) {
    node.addEventListener('click', async () => {
      await browser.tabs.update(Number(node.dataset.openTab), { active: true });
      window.close();
    });
  }
  for (const node of list.querySelectorAll('[data-mute-tab]')) {
    node.addEventListener('click', async (event) => {
      event.stopPropagation();
      const tabId = Number(node.dataset.muteTab);
      await sendVolume(tabId, 0);
      await refreshChangedTabs(activeTabId);
    });
  }
  for (const node of list.querySelectorAll('[data-reset-tab]')) {
    node.addEventListener('click', async (event) => {
      event.stopPropagation();
      const tabId = Number(node.dataset.resetTab);
      await sendVolume(tabId, 100);
      await refreshChangedTabs(activeTabId);
    });
  }
}
(async function init() {
  const slider = document.getElementById('volume');
  const value = document.getElementById('value');
  const reset = document.getElementById('reset');
  const mute = document.getElementById('mute');
  const presets = [...document.querySelectorAll('.preset')];
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    value.textContent = 'N/A';
    slider.disabled = true;
    reset.disabled = true;
    mute.disabled = true;
    return;
  }
  const state = await browser.runtime.sendMessage({ type: 'GET_TAB_VOLUME', tabId: tab.id });
  const current = state && typeof state.volume === 'number' ? state.volume : 100;
  slider.value = String(current);
  value.textContent = `${current}%`;
  updateStatus(current);
  await refreshChangedTabs(tab.id);

  async function setCurrent(volume) {
    slider.value = String(volume);
    value.textContent = `${volume}%`;
    updateStatus(volume);
    try {
      await sendVolume(tab.id, volume);
      await refreshChangedTabs(tab.id);
    } catch (error) {
      value.textContent = 'Reload tab';
    }
  }

  slider.addEventListener('input', () => {
    const volume = Number(slider.value);
    value.textContent = `${volume}%`;
    updateStatus(volume);
  });
  slider.addEventListener('change', async () => {
    await setCurrent(Number(slider.value));
  });
  reset.addEventListener('click', async () => { await setCurrent(100); });
  mute.addEventListener('click', async () => { await setCurrent(0); });
  for (const button of presets) {
    button.addEventListener('click', async () => { await setCurrent(Number(button.dataset.volume)); });
  }
})();
