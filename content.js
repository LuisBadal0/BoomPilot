const mediaState = new WeakMap();
let currentVolume = 100;

function muteMedia(media, shouldMute) {
  try { media.muted = shouldMute; } catch (error) {}
}

function setupMediaElement(media) {
  if (mediaState.has(media)) return mediaState.get(media);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    const fallback = { fallback: true };
    mediaState.set(media, fallback);
    return fallback;
  }
  const context = new AudioContextClass();
  const source = context.createMediaElementSource(media);
  const gainNode = context.createGain();
  source.connect(gainNode);
  gainNode.connect(context.destination);
  const state = { context, gainNode, source };
  mediaState.set(media, state);
  const resume = () => { if (context.state === 'suspended') context.resume().catch(() => {}); };
  media.addEventListener('play', resume, { passive: true });
  window.addEventListener('click', resume, { passive: true, once: true });
  return state;
}

function getMediaElements() {
  return [...document.querySelectorAll('audio, video')];
}

function applyVolume(volume) {
  currentVolume = Number.isFinite(volume) ? volume : 100;
  const gainValue = Math.max(0, Math.min(5, currentVolume / 100));
  const shouldMute = currentVolume <= 0;

  for (const media of getMediaElements()) {
    try {
      const state = setupMediaElement(media);
      muteMedia(media, shouldMute);
      if (state && state.fallback) {
        media.volume = shouldMute ? 0 : Math.max(0, Math.min(1, currentVolume / 100));
      } else if (state && state.gainNode) {
        state.gainNode.gain.value = shouldMute ? 0 : gainValue;
        if (!shouldMute) {
          media.volume = 1;
        }
      }
    } catch (error) {
      muteMedia(media, shouldMute);
      media.volume = shouldMute ? 0 : Math.max(0, Math.min(1, currentVolume / 100));
    }
  }
}

new MutationObserver(() => applyVolume(currentVolume)).observe(document.documentElement || document, { childList: true, subtree: true });
applyVolume(currentVolume);

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'SET_VOLUME') {
    applyVolume(Number(message.volume));
    return Promise.resolve({ ok: true });
  }
  return false;
});
