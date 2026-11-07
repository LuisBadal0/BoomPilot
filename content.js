(() => {
  // Guard against double-injection (popup used to call executeScript on
  // every slider tick, stacking observers + listeners + AudioContexts).
  if (window.__boomPilotLoaded) return;
  window.__boomPilotLoaded = true;

  // Media routed through Web Audio (needed for boost and effects).
  const graphState = new WeakMap();
  // Media controlled through media.volume because Web Audio would silence it.
  const directState = new WeakMap();
  const volumeListeners = new WeakSet();
  let audioContext = null;
  let limiter = null;
  let latestState = { volume: 100, voiceBoost: 0, bassBoost: 0 };
  let pendingApply = false;
  // Set once the popup sends a state, so the slower startup lookup below
  // can't overwrite it with an older one.
  let receivedState = false;

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

  function needsWebAudio(s) {
    return s.volume > 100 || s.voiceBoost > 0 || s.bassBoost > 0;
  }

  // Web Audio outputs silence for media loaded from another origin without
  // CORS. Returns 'webaudio', 'direct', or null while the source is unknown.
  function routeFor(media) {
    if (media.srcObject) return 'webaudio';
    const src = media.currentSrc || media.src;
    if (!src) return null;
    let url;
    try {
      url = new URL(src, location.href);
    } catch {
      return 'direct';
    }
    if (url.protocol === 'blob:' || url.protocol === 'data:') return 'webaudio';
    if (url.origin === location.origin) return 'webaudio';
    return media.crossOrigin ? 'webaudio' : 'direct';
  }

  function getAudioContext() {
    if (audioContext) return audioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      audioContext = new AudioContextClass();
    } catch {
      return null;
    }
    // Only engaged while boosting, to catch the clipping that high gain causes.
    limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(audioContext.destination);
    return audioContext;
  }

  function createGraph(media) {
    const context = getAudioContext();
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

      const nodes = { gain, voice, bass, output: context.destination };
      graphState.set(media, nodes);
      return nodes;
    } catch {
      // Media already has a source (double-inject race) or context blocked.
      // Don't throw on the observer / message hot path.
      return null;
    }
  }

  function setOutput(nodes, output) {
    if (nodes.output === output) return;
    nodes.gain.disconnect();
    nodes.gain.connect(output);
    nodes.output = output;
  }

  function applyGraph(nodes, settings) {
    const now = audioContext.currentTime;
    nodes.gain.gain.setTargetAtTime(clamp(settings.volume / 100, 0, 5), now, 0.02);
    nodes.voice.gain.setTargetAtTime(clamp((settings.voiceBoost / 100) * 12, 0, 12), now, 0.02);
    nodes.bass.gain.setTargetAtTime(clamp((settings.bassBoost / 100) * 15, 0, 15), now, 0.02);
    setOutput(nodes, settings.volume > 100 ? limiter : audioContext.destination);
  }

  function setDirectVolume(media, entry, value) {
    entry.applied = value;
    media.volume = value;
  }

  function applyDirect(media, settings) {
    let entry = directState.get(media);
    if (isDefaultState(settings)) {
      if (entry) {
        directState.delete(media);
        media.volume = entry.base;
      }
      return;
    }

    if (!entry) {
      entry = { base: media.volume, applied: media.volume, factor: 1 };
      directState.set(media, entry);
    }

    if (!volumeListeners.has(media)) {
      volumeListeners.add(media);
      media.addEventListener('volumechange', () => {
        const current = directState.get(media);
        if (!current || Math.abs(media.volume - current.applied) < 1e-6) return;
        // The page or its player set a new volume: that is its intended
        // level, so keep it as the base and apply our reduction on top.
        current.base = media.volume;
        setDirectVolume(media, current, clamp(current.base * current.factor, 0, 1));
      });
    }

    // media.volume cannot go above 1, so boost and effects are unavailable here.
    entry.factor = clamp(settings.volume / 100, 0, 1);
    setDirectVolume(media, entry, clamp(entry.base * entry.factor, 0, 1));
  }

  // Returns true when the requested boost or effects could not be applied.
  function applyToMedia(media, settings) {
    const nodes = graphState.get(media);
    if (nodes) {
      applyGraph(nodes, settings);
      return false;
    }

    if (directState.has(media)) {
      applyDirect(media, settings);
      return needsWebAudio(settings);
    }

    // Fast path: never touch media until the user actually changes
    // something, so pages play untouched after install.
    if (isDefaultState(settings)) return false;

    const route = routeFor(media);
    // No source yet: the loadstart listener applies the state once it has one.
    if (!route) return false;

    if (route === 'webaudio') {
      const created = createGraph(media);
      if (created) {
        applyGraph(created, settings);
        if (audioContext.state === 'suspended' && !media.paused) audioContext.resume().catch(() => {});
        return false;
      }
    }

    applyDirect(media, settings);
    return needsWebAudio(settings);
  }

  function applyToAll(settings) {
    // querySelectorAll is cheap when called rarely; it was previously
    // called on EVERY DOM mutation which froze SPAs.
    let limited = false;
    for (const node of document.querySelectorAll('audio, video')) {
      if (applyToMedia(node, settings)) limited = true;
    }
    return limited;
  }

  function isLimited() {
    if (!needsWebAudio(latestState)) return false;
    for (const node of document.querySelectorAll('audio, video')) {
      if (directState.has(node)) return true;
    }
    return false;
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

  function isMediaElement(node) {
    return node instanceof HTMLMediaElement;
  }

  // Media events don't bubble, so listen in the capture phase. loadstart
  // catches elements that got a source after we first saw them; play wakes
  // a context that was created before the page was allowed to play audio.
  document.addEventListener('loadstart', (event) => {
    if (isMediaElement(event.target)) applyToMedia(event.target, latestState);
  }, true);

  document.addEventListener('play', (event) => {
    if (!isMediaElement(event.target)) return;
    applyToMedia(event.target, latestState);
    if (audioContext && audioContext.state === 'suspended' && graphState.has(event.target)) {
      audioContext.resume().catch(() => {});
    }
  }, true);

  browser.runtime.onMessage.addListener((message = {}) => {
    if (message.type === 'SET_AUDIO_STATE') {
      receivedState = true;
      latestState = normalizeState(message);
      // Only answer when limited: with several frames, the popup receives the
      // first answer, so frames without a problem stay silent.
      if (applyToAll(latestState)) return Promise.resolve({ limited: true });
      return undefined;
    }
    if (message.type === 'GET_LIMITED') {
      return isLimited() ? Promise.resolve({ limited: true }) : undefined;
    }
    if (message.type === 'PING') {
      return Promise.resolve({ ok: true });
    }
    return undefined;
  });

  startObserver();
  browser.runtime.sendMessage({ type: 'GET_TAB_AUDIO_STATE' }).then((s) => {
    if (receivedState) return;
    latestState = normalizeState(s);
    applyToAll(latestState);
  }).catch(() => {});
})();
