const mediaState = new WeakMap();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createNodes(media) {
  if (mediaState.has(media)) return mediaState.get(media);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  const context = new AudioContextClass();
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

  const state = { context, source, voice, bass, gain, media, volume: 100, voiceBoost: 0, bassBoost: 0 };
  mediaState.set(media, state);

  media.addEventListener('play', () => {
    if (context.state === 'suspended') context.resume().catch(() => {});
  });

  return state;
}

function applyToMedia(media, settings) {
  const nodes = createNodes(media);
  if (!nodes) return;

  nodes.volume = typeof settings.volume === 'number' ? settings.volume : nodes.volume;
  nodes.voiceBoost = typeof settings.voiceBoost === 'number' ? settings.voiceBoost : nodes.voiceBoost;
  nodes.bassBoost = typeof settings.bassBoost === 'number' ? settings.bassBoost : nodes.bassBoost;

  nodes.gain.gain.value = clamp(nodes.volume / 100, 0, 5);
  nodes.voice.gain.value = clamp((nodes.voiceBoost / 100) * 12, 0, 12);
  nodes.bass.gain.value = clamp((nodes.bassBoost / 100) * 15, 0, 15);

  if (nodes.context.state === 'suspended' && !media.paused) {
    nodes.context.resume().catch(() => {});
  }
}

function applySettings(settings) {
  for (const media of document.querySelectorAll('audio, video')) {
    applyToMedia(media, settings);
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'SET_AUDIO_STATE') {
    applySettings(message);
  }
});

const observer = new MutationObserver(() => {
  browser.runtime.sendMessage({ type: 'GET_TAB_AUDIO_STATE', tabId: browser.devtools ? undefined : null }).catch(() => {});
});
observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
