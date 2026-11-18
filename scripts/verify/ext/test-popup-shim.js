// Test-only script loaded before popup.js in the throwaway copy.
// Makes sure the popup controls the page the run opened it for (headless
// windows don't always agree on which one is current), and lets
// test-background.js click its buttons and read what it shows.
(() => {
  const target = browser.runtime.sendMessage({ type: 'BP_TEST', command: 'popupTarget' });
  const originalQuery = browser.tabs.query.bind(browser.tabs);
  browser.tabs.query = async (query = {}) => {
    const tabId = await target;
    if (query.active && query.currentWindow && typeof tabId === 'number') return [await browser.tabs.get(tabId)];
    return originalQuery(query);
  };

  const text = (id) => document.getElementById(id)?.textContent.trim();

  browser.runtime.onMessage.addListener((message = {}) => {
    if (message.type !== 'BP_POPUP') return undefined;
    if (message.action === 'close') {
      setTimeout(() => window.close(), 0);
      return Promise.resolve({ closed: true });
    }
    if (message.action === 'click') {
      const node = document.querySelector(message.selector);
      if (!node) return Promise.reject(new Error(`No element for ${message.selector}`));
      node.click();
    }
    return new Promise((resolve) => setTimeout(() => resolve({
      ready: document.readyState === 'complete' && text('siteName') !== 'Current tab',
      site: text('siteName'),
      value: text('value'),
      status: text('status'),
      slider: Number(document.getElementById('volume').value),
      remembered: document.getElementById('remember').getAttribute('aria-pressed') === 'true',
      changedTabs: Number(text('count'))
    }), message.action === 'click' ? 300 : 0));
  });
})();
