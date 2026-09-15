(() => {
  // Guard against double-injection (popup used to call executeScript on
  // every slider tick, stacking observers + listeners + AudioContexts).
  if (window.__boomPilotLoaded) return;
  window.__boomPilotLoaded = true;

  const mediaState = new WeakMap();
  let latestState = { volume: 100, voiceBoost: 0, bassBoost: 0 };
  let observerStarted = false;
  let pendingApply = false;

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

  function isDefaultState(s) {
    return s.volume === 100 && s.voiceBoost === 0 && s.bassBoost === 0;
  }

  function createNodes(media) {
    if (mediaState.has(media)) return mediaState.get(media);

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    try {
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

      const state = { context, source, voice, bass, gain, media };
      mediaState.set(media, state);
      media.addEventListener('play', () => {
        if (context.state === 'suspended') context.resume().catch(() => {});
      });
      return state;
    } catch {
      // Media already has a source (double-inject race) or context blocked.
      // Don't throw on the observer / message hot path.
      return null;
    }
  }

  function applyToMedia(media, settings) {
    // Fast path: never route audio through WebAudio until the user
    // actually changes something. This avoids creating an AudioContext
    // (and breaking direct playback) on every page after install.
    let nodes = mediaState.get(media);
    if (!nodes) {
      if (isDefaultState(settings)) return;
      nodes = createNodes(media);
      if (!nodes) return;
    }

    nodes.gain.gain.setTargetAtTime(clamp(settings.volume / 100, 0, 5), nodes.context.currentTime, 0.02);
    nodes.voice.gain.setTargetAtTime(clamp((settings.voiceBoost / 100) * 12, 0, 12), nodes.context.currentTime, 0.02);
    nodes.bass.gain.setTargetAtTime(clamp((settings.bassBoost / 100) * 15, 0, 15), nodes.context.currentTime, 0.02);

    if (nodes.context.state === 'suspended' && !media.paused) {
      nodes.context.resume().catch(() => {});
    }
  }

  function applyToAll(settings) {
    // querySelectorAll is cheap when called rarely; it was previously
    // called on EVERY DOM mutation which froze SPAs.
    const media = document.querySelectorAll('audio, video');
    for (const node of media) {
      applyToMedia(node, settings);
    }
  }

  function scheduleApply() {
    if (pendingApply) return;
    pendingApply = true;
    // Coalesce bursts of mutations into one idle-time pass.
    const run = () => {
      pendingApply = false;
      applyToAll(latestState);
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 300 });
    } else {
      setTimeout(run, 120);
    }
  }

  function hasMedia(nodes) {
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      const tag = node.tagName;
      if (tag === 'AUDIO' || tag === 'VIDEO') return true;
      if (typeof node.querySelector === 'function' && node.querySelector('audio, video')) return true;
    }
    return false;
  }

  function startObserver() {
    if (observerStarted) return;
    observerStarted = true;

    const observer = new MutationObserver((mutations) => {
      // Ignore text/attribute churn (typing, YouTube progress bars, etc).
      // Only re-scan when elements that could contain media were added.
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length && hasMedia(m.addedNodes)) {
          scheduleApply();
          return;
        }
      }
    });

    const root = document.documentElement || document.body;
    if (root) {
      observer.observe(root, { childList: true, subtree: true });
    }
  }

  browser.runtime.onMessage.addListener((message = {}) => {
    if (message.type === 'SET_AUDIO_STATE') {
      latestState = normalizeState(message);
      applyToAll(latestState);
    }
    if (message.type === 'PING') {
      return Promise.resolve({ ok: true });
    }
    return undefined;
  });

  startObserver();
  browser.runtime.sendMessage({ type: 'GET_TAB_AUDIO_STATE' }).then((s) => {
    latestState = normalizeState(s);
    applyToAll(latestState);
  }).catch(() => {});
})();
