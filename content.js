const mediaState = new WeakMap();
let latestState = { volume: 100, voiceBoost: 0, bassBoost: 0 };
let observerStarted = false;
let sharedContext = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeState(input = {}) {
  return {
    volume: clamp(Number.isFinite(input.volume) ? input.volume : latestState.volume, 0, 500),
    voiceBoost: clamp(Number.isFinite(input.voiceBoost) ? input.voiceBoost : latestState.voiceBoost, 0, 100),
    bassBoost: clamp(Number.isFinite(input.bassBoost) ? input.bassBoost : latestState.bassBoost, 0, 100)
  };
}

function getSharedContext() {
  if (!sharedContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    sharedContext = new AudioContextClass();
  }
  return sharedContext;
}

function createNodes(media) {
  if (mediaState.has(media)) return mediaState.get(media);

  const context = getSharedContext();
  if (!context) return null;

  try {
    const source = context.createMediaElementSource(media);
    const voice = context.createBiquadFilter();
    const bass = context.createBiquadFilter();
    const gain = context.createGain();

    voice.type = 'peaking';
    voice.frequency.value = 2500;
    voice.Q.value = 1.2;
    voice.gain.value = 0;

    bass.type = 'lowshelf';
    bass.frequency.value = 200;
    bass.gain.value = 0;

    gain.gain.value = 1;
    source.connect(voice);
    voice.connect(bass);
    bass.connect(gain);
    gain.connect(context.destination);

    const state = { context, source, voice, bass, gain, media };
    mediaState.set(media, state);
    
    media.addEventListener('play', () => {
      if (context.state === 'suspended') {
        context.resume().catch(() => {});
      }
    });
    
    return state;
  } catch (e) {
    console.warn('Could not connect to media element source (likely CORS):', media, e);
    return null;
  }
}

function applyToMedia(media, settings) {
  const nodes = createNodes(media);
  if (!nodes) return;

  nodes.gain.gain.value = clamp(settings.volume / 100, 0, 5);
  nodes.voice.gain.value = clamp((settings.voiceBoost / 100) * 12, 0, 12);
  nodes.bass.gain.value = clamp((settings.bassBoost / 100) * 15, 0, 15);

  if (nodes.context.state === 'suspended' && !media.paused) {
    nodes.context.resume().catch(() => {});
  }
}

function applySettings(settings) {
  latestState = normalizeState(settings);
  for (const media of document.querySelectorAll('audio, video')) {
    applyToMedia(media, latestState);
  }
}

function startObserver() {
  if (observerStarted) return;
  observerStarted = true;

  const observer = new MutationObserver(() => {
    applySettings(latestState);
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
}

browser.runtime.onMessage.addListener((message = {}) => {
  if (message.type === 'SET_AUDIO_STATE') {
    applySettings(message);
  }
});

startObserver();
browser.runtime.sendMessage({ type: 'GET_TAB_AUDIO_STATE' }).then(applySettings).catch(() => {});
