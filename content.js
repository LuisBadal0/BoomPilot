const mediaState = new WeakMap();
let currentVolume = 100;

function muteMedia(media, shouldMute) {
  try { media.muted = shouldMute; } catch (error) {}
}

function syncEffectiveGain(media, state) {
  if (!state || !state.gainNode) return;
  const elementVolume = Math.max(0, Math.min(1, Number(media.volume) || 0));
  const extensionGain = Math.max(0, Math.min(5, currentVolume / 100));
  state.gainNode.gain.value = state.userMuted ? 0 : elementVolume * extensionGain;
}

function setupMediaElement(media) {
  if (mediaState.has(media)) return mediaState.get(media);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    const fallback = { fallback: true, userMuted: false };
    mediaState.set(media, fallback);
    return fallback;
  }
  const context = new AudioContextClass();
  const source = context.createMediaElementSource(media);
  const gainNode = context.createGain();
  source.connect(gainNode);
  gainNode.connect(context.destination);

  const state = { context, gainNode, source, userMuted: false };
  mediaState.set(media, state);

  const resume = () => { if (context.state === 'suspended') context.resume().catch(() => {}); };
  const onVolumeChange = () => {
    state.userMuted = !!media.muted;
    syncEffectiveGain(media, state);
  };

  media.addEventListener('play', resume, { passive: true });
  media.addEventListener('volumechange', onVolumeChange, { passive: true });
  window.addEventListener('click', resume, { passive: true, once: true });

  syncEffectiveGain(media, state);
  return state;
}

function getMediaElements() {
  return [...document.querySelectorAll('audio, video')];
}

function applyVolume(volume) {
  currentVolume = Number.isFinite(volume) ? volume : 100;
  const shouldMute = currentVolume <= 0;

  for (const media of getMediaElements()) {
    try {
      const state = setupMediaElement(media);
      if (state && state.fallback) {
        muteMedia(media, shouldMute);
        media.volume = shouldMute ? 0 : Math.max(0, Math.min(1, currentVolume / 100));
      } else if (state && state.gainNode) {
        if (shouldMute) {
          state.userMuted = true;
          muteMedia(media, true);
          state.gainNode.gain.value = 0;
        } else {
          if (media.muted) {
            media.muted = false;
          }
          state.userMuted = false;
          syncEffectiveGain(media, state);
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
