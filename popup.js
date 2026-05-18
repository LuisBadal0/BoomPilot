async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function shortUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

let liveUpdateTimer = null;
let currentActiveTabId = null;

function scheduleLiveUpdate(callback) {
  clearTimeout(liveUpdateTimer);
  liveUpdateTimer = setTimeout(callback, 16);
}

async function sendAudioState(tabId, state) {
  await browser.tabs.sendMessage(tabId, { type: 'SET_AUDIO_STATE', ...state });
  await browser.runtime.sendMessage({ type: 'SAVE_TAB_AUDIO_STATE', tabId, ...state });
}

function updateStatus(volume) {
  const status = document.getElementById('status');
  if (volume === 0) status.textContent = 'Muted';
  else if (volume < 100) status.textContent = 'Lowered';
  else if (volume === 100) status.textContent = 'Normal';
  else status.textContent = 'Boosted';
}

function createIconBase() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

function createResetIcon() {
  const svg = createIconBase();
  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute('d', 'M3 12a9 9 0 1 0 3-6.7');
  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path2.setAttribute('d', 'M3 3v6h6');
  svg.appendChild(path1);
  svg.appendChild(path2);
  return svg;
}

function createMuteIcon() {
  const svg = createIconBase();
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  polygon.setAttribute('points', '11 5 6 9 2 9 2 15 6 15 11 19 11 5');
  const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line1.setAttribute('x1', '23');
  line1.setAttribute('y1', '9');
  line1.setAttribute('x2', '17');
  line1.setAttribute('y2', '15');
  const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line2.setAttribute('x1', '17');
  line2.setAttribute('y1', '9');
  line2.setAttribute('x2', '23');
  line2.setAttribute('y2', '15');
  svg.appendChild(polygon);
  svg.appendChild(line1);
  svg.appendChild(line2);
  return svg;
}

function getCurrentTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.checked = theme === 'dark';
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
}

function enableThemeAnimation() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add('theme-animate');
    });
  });
}

async function initTheme() {
  let theme = getCurrentTheme();
  try {
    const stored = await browser.storage.local.get('theme');
    if (stored.theme === 'dark' || stored.theme === 'light') theme = stored.theme;
  } catch (error) {}
  await applyTheme(theme);
}

function effectLabel(value) {
  if (value >= 100) return 'High';
  if (value >= 65) return 'Medium';
  if (value >= 35) return 'Low';
  return 'Off';
}

function updateEffectButtons(state) {
  for (const button of document.querySelectorAll('.effect-preset')) {
    const effect = button.dataset.effect;
    const value = Number(button.dataset.value);
    const current = effect === 'voice' ? state.voiceBoost : state.bassBoost;
    button.classList.toggle('is-active', value === current);
    button.setAttribute('aria-pressed', String(value === current));
  }
}

function updateEffectsView(state) {
  document.getElementById('value').textContent = `${state.volume}%`;
  document.getElementById('volume').value = String(state.volume);
  document.getElementById('voiceValue').textContent = effectLabel(state.voiceBoost);
  document.getElementById('bassValue').textContent = effectLabel(state.bassBoost);
  updateEffectButtons(state);
  updateStatus(state.volume);
}

async function refreshChangedTabs(activeTabId) {
  const list = document.getElementById('changedTabs');
  const count = document.getElementById('count');
  const { items = [] } = await browser.runtime.sendMessage({ type: 'LIST_CHANGED_TABS' });
  count.textContent = `${items.length} tab${items.length === 1 ? '' : 's'}`;
  list.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No tabs changed yet.';
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'tab-item';

    const open = document.createElement('div');
    open.className = 'tab-open';
    open.dataset.openTab = String(item.tabId);

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.alt = '';
    favicon.src = item.favIconUrl || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 18 18%22%3E%3Crect width=%2218%22 height=%2218%22 rx=%224%22 fill=%22%23d9d5ce%22/%3E%3Cpath d=%22M5 9h8M9 5v8%22 stroke=%22%23706c63%22 stroke-width=%221.5%22 stroke-linecap=%22round%22/%3E%3C/svg%3E';

    const main = document.createElement('div');
    main.className = 'tab-main';

    const title = document.createElement('div');
    title.className = 'tab-title';
    title.textContent = `${item.title || 'Untitled tab'}${item.tabId === activeTabId ? ' • current' : ''}`;

    const url = document.createElement('div');
    url.className = 'tab-url';
    url.textContent = shortUrl(item.url);

    const meta = document.createElement('div');
    meta.className = 'tab-meta';

    for (const token of [
      `${item.volume}%`,
      item.voiceBoost ? `Voice ${item.voiceBoost}%` : null,
      item.bassBoost ? `Bass ${item.bassBoost}%` : null,
      item.audible ? 'Playing' : null
    ]) {
      if (!token) continue;
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = token;
      meta.appendChild(pill);
    }

    main.appendChild(title);
    main.appendChild(url);
    main.appendChild(meta);
    open.appendChild(favicon);
    open.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'mini-actions';

    const muteButton = document.createElement('button');
    muteButton.className = 'mini-btn mini-danger';
    muteButton.type = 'button';
    muteButton.dataset.muteTab = String(item.tabId);
    muteButton.setAttribute('aria-label', 'Mute this tab');
    muteButton.title = 'Mute';
    muteButton.appendChild(createMuteIcon());

    const resetButton = document.createElement('button');
    resetButton.className = 'mini-btn mini-primary';
    resetButton.type = 'button';
    resetButton.dataset.resetTab = String(item.tabId);
    resetButton.setAttribute('aria-label', 'Reset this tab audio');
    resetButton.title = 'Reset';
    resetButton.appendChild(createResetIcon());

    actions.appendChild(muteButton);
    actions.appendChild(resetButton);
    row.appendChild(open);
    row.appendChild(actions);
    list.appendChild(row);
  }

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
      const next = { volume: 0 };
      await sendAudioState(tabId, next);
      if (tabId === currentActiveTabId) {
        const state = await browser.runtime.sendMessage({ type: 'GET_TAB_AUDIO_STATE', tabId });
        updateEffectsView(state);
      }
      await refreshChangedTabs(activeTabId);
    });
  }

  for (const node of list.querySelectorAll('[data-reset-tab]')) {
    node.addEventListener('click', async (event) => {
      event.stopPropagation();
      const tabId = Number(node.dataset.resetTab);
      const next = { volume: 100, voiceBoost: 0, bassBoost: 0 };
      await sendAudioState(tabId, next);
      if (tabId === currentActiveTabId) updateEffectsView(next);
      await refreshChangedTabs(activeTabId);
    });
  }
}

(async function init() {
  await initTheme();
  enableThemeAnimation();

  const slider = document.getElementById('volume');
  const effectButtons = [...document.querySelectorAll('.effect-preset')];
  const reset = document.getElementById('reset');
  const mute = document.getElementById('mute');
  const presets = [...document.querySelectorAll('.preset')];
  const themeToggle = document.getElementById('themeToggle');

  if (themeToggle) {
    themeToggle.addEventListener('change', async () => {
      const nextTheme = themeToggle.checked ? 'dark' : 'light';
      await applyTheme(nextTheme);
      try { await browser.storage.local.set({ theme: nextTheme }); } catch (error) {}
    });
  }

  const tab = await getActiveTab();
  if (!tab || !tab.id) return;
  currentActiveTabId = tab.id;

  let currentState = await browser.runtime.sendMessage({ type: 'GET_TAB_AUDIO_STATE', tabId: tab.id });
  updateEffectsView(currentState);
  await refreshChangedTabs(tab.id);

  async function updateState(patch) {
    const next = {
      volume: Number(slider.value),
      voiceBoost: currentState.voiceBoost,
      bassBoost: currentState.bassBoost,
      ...patch
    };
    currentState = next;
    updateEffectsView(next);
    try {
      await sendAudioState(tab.id, next);
      await refreshChangedTabs(tab.id);
    } catch (error) {
      document.getElementById('value').textContent = 'Reload tab';
    }
  }

  slider.addEventListener('input', () => {
    const volume = Number(slider.value);
    document.getElementById('value').textContent = `${volume}%`;
    updateStatus(volume);
    scheduleLiveUpdate(() => updateState({ volume }));
  });
  slider.addEventListener('change', () => updateState({ volume: Number(slider.value) }));

  for (const button of effectButtons) {
    button.addEventListener('click', () => {
      const value = Number(button.dataset.value);
      if (button.dataset.effect === 'voice') {
        updateState({ voiceBoost: value });
      } else {
        updateState({ bassBoost: value });
      }
    });
  }

  reset.addEventListener('click', () => updateState({ volume: 100, voiceBoost: 0, bassBoost: 0 }));
  mute.addEventListener('click', () => updateState({ volume: 0 }));

  for (const button of presets) {
    button.addEventListener('click', () => updateState({ volume: Number(button.dataset.volume) }));
  }
})();
