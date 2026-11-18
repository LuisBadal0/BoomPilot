// Test-only content script for the local bridge page. Relays commands from
// the page (where WebDriver can run scripts) to test-background.js.
window.addEventListener('message', async (event) => {
  const data = event.data;
  if (event.source !== window || !data || data.bpTestRequest === undefined) return;
  let reply;
  try {
    const result = await browser.runtime.sendMessage({ type: 'BP_TEST', command: data.command, args: data.args });
    reply = { bpTestReply: data.bpTestRequest, result };
  } catch (error) {
    reply = { bpTestReply: data.bpTestRequest, error: String(error && error.message || error) };
  }
  window.postMessage(reply, '*');
});
