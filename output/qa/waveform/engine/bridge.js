(function () {
  'use strict';
  const subscribers = new Set();
  const bridge = window.WallpaperBridge = {
    isWallpaper: typeof window.wallpaperRegisterAudioListener === 'function',
    properties: {}, fps: 60, paused: false, audio: new Float32Array(128), audioAt: -Infinity,
    subscribe(callback) { subscribers.add(callback); callback(this); return () => subscribers.delete(callback); }
  };
  function notify() { subscribers.forEach(callback => callback(bridge)); }
  window.wallpaperPropertyListener = {
    applyUserProperties(properties) { bridge.isWallpaper = true; Object.assign(bridge.properties, properties || {}); notify(); },
    applyGeneralProperties(properties) {
      bridge.isWallpaper = true;
      if (properties && Number.isFinite(Number(properties.fps))) bridge.fps = Math.max(1, Math.min(240, Number(properties.fps)));
      notify();
    },
    setPaused(paused) { bridge.isWallpaper = true; bridge.paused = Boolean(paused); notify(); }
  };
  if (typeof window.wallpaperRegisterAudioListener === 'function') {
    window.wallpaperRegisterAudioListener(function (values) {
      for (let i = 0; i < 128; i++) bridge.audio[i] = Math.max(0, Math.min(1, Number(values[i]) || 0));
      bridge.audioAt = performance.now();
    });
  }
})();
