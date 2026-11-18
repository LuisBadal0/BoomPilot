// Test-only background script, added to the throwaway copy of the extension
// that the verify run installs. Never shipped.
//
// WebDriver can't script extension pages, so the run talks to this script
// through test-bridge.js on a local page. It answers questions about
// extension state, opens the real toolbar popup and forwards actions to it
// (test-popup-shim.js).
// The page the popup should control, set by openPopup.
let popupTargetTabId = null;

browser.runtime.onMessage.addListener((message = {}) => {
  if (message.type !== 'BP_TEST') return undefined;
  return handleTestCommand(message.command, message.args || {});
});

async function handleTestCommand(command, args) {
  switch (command) {
    case 'tabs':
      return (await browser.tabs.query({})).map(({ id, url, audible }) => ({ id, url, audible }));
    case 'badge':
      return browser.browserAction.getBadgeText({ tabId: args.tabId });
    case 'storage':
      return browser.storage.local.get(args.key);
    case 'openPopup': {
      // Opens the real toolbar popup for the given page's tab.
      popupTargetTabId = args.tabId;
      const tab = await browser.tabs.update(args.tabId, { active: true });
      await browser.windows.update(tab.windowId, { focused: true });
      await browser.browserAction.openPopup({ windowId: tab.windowId });
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          const state = await browser.runtime.sendMessage({ type: 'BP_POPUP', action: 'state' });
          if (state && state.ready) return state;
        } catch {}
      }
      throw new Error('Popup did not open');
    }
    case 'popupTarget':
      return popupTargetTabId;
    case 'popup':
      return browser.runtime.sendMessage({ type: 'BP_POPUP', ...args });
    default:
      throw new Error(`Unknown test command: ${command}`);
  }
}
