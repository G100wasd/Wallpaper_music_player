(function () {
  'use strict';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  class MusicPlayer extends EventTarget {
    constructor(library) {
      super();
      if (!library || typeof library.resolveSource !== 'function') throw new Error('MusicPlayer 需要一个 MusicLibrary 实例。');
      this.library = library;
      this.queue = [];
      this.index = -1;
      this.repeat = 'all';
      this.volume = 0.65;
      this._loadToken = 0;
      this._readyToken = -1;
      this._loading = null;
      this._activeSource = null;
      this._pendingSeek = null;
      this._heldTime = 0;
      this._resumeOnline = false;
      this._buffering = false;
      this._lastLoadFailed = false;
      this._wantPlaying = false;
      this._destroyed = false;
      this._context = null;
      this._mediaSource = null;
      this._analyser = null;
      this._frequencyData = null;
      this._listeners = [];
      this._lastError = { message: '', time: 0 };
      this.audio = this._createAudio();
    }

    _createAudio() {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.volume = this.volume;
      const on = (name, handler) => {
        audio.addEventListener(name, handler);
        this._listeners.push([audio, name, handler]);
      };
      const isCurrent = () => !this._destroyed && this.audio === audio && this._readyToken === this._loadToken;
      for (const name of ['timeupdate', 'play', 'pause', 'durationchange', 'waiting', 'playing']) {
        on(name, () => { if (isCurrent()) {
          if (name === 'waiting') this._buffering = this._wantPlaying;
          if (name === 'playing' || name === 'pause') this._buffering = false;
          this._emitState();
        } });
      }
      on('loadedmetadata', () => {
        if (!isCurrent()) return;
        const duration = this._duration();
        if (duration && this.queue[this.index]) this.queue[this.index].duration = duration;
        this._applyPendingSeek();
        this._emitState();
      });
      on('canplay', () => { if (isCurrent()) this._applyPendingSeek(); });
      on('volumechange', () => {
        if (this._destroyed || this.audio !== audio) return;
        this.volume = audio.volume;
        this._emitState();
      });
      on('ended', () => { if (isCurrent()) this._handleEnded(); });
      on('error', () => {
        if (!isCurrent() || !audio.error) return;
        this._wantPlaying = false;
        this._buffering = false;
        const messages = {
          1: '音频加载已中止。',
          2: '无法读取音频，请检查文件路径或网络连接。',
          3: '此音频无法解码，请尝试其他格式的文件。',
          4: '音频地址不可访问，或当前环境不支持此音频格式。'
        };
        this._emitError(this._activeSource && this._activeSource.online ? '在线音频连接或转码失败，请检查网络与本机助手，然后点击播放重试。' : (messages[audio.error.code] || '这首歌曲暂时无法播放。'));
        this._emitState();
      });
      return audio;
    }

    _removeAudioListeners(audio) {
      this._listeners = this._listeners.filter(([element, name, handler]) => {
        if (element !== audio) return true;
        element.removeEventListener(name, handler);
        return false;
      });
    }

    _isOnlineTrack() { return !!(this.queue[this.index] && this.queue[this.index].sourceType === 'bilibili'); }

    _position() {
      if (this._pendingSeek) return this._pendingSeek.time;
      if (!this._activeSource) return this._heldTime;
      const time = (Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0) + (this._activeSource.online ? this._activeSource.startTime || 0 : 0);
      return this._duration() ? Math.min(time, this._duration()) : time;
    }

    _duration() {
      if (this._isOnlineTrack()) return Number(this._activeSource && this._activeSource.duration) || Number(this.queue[this.index].duration) || 0;
      return Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : 0;
    }

    _emitState() {
      if (this._destroyed) return;
      this.dispatchEvent(new CustomEvent('state', {
        detail: {
          track: this.queue[this.index] || null,
          index: this.index,
          playing: !this.audio.paused && !this.audio.ended && this._readyToken === this._loadToken,
          currentTime: this._position(),
          duration: this._duration(),
          volume: this.volume,
          queue: this.queue,
          repeat: this.repeat,
          loading: (this._readyToken !== this._loadToken || this._buffering) && this.index >= 0,
          pendingPlay: this._wantPlaying
        }
      }));
    }

    _emitError(message) {
      if (this._destroyed) return;
      const now = Date.now();
      if (this._lastError.message === message && now - this._lastError.time < 700) return;
      this._lastError = { message, time: now };
      this.dispatchEvent(new CustomEvent('error', { detail: { message } }));
    }

    _releaseSource() {
      if (this._activeSource && this._activeSource.cancel) this._activeSource.cancel();
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      if (this._activeSource && this._activeSource.revoke) URL.revokeObjectURL(this._activeSource.url);
      this._activeSource = null;
    }

    _isAnalysisSafe(url) {
      if (typeof window.wallpaperRegisterAudioListener === 'function') return false;
      try {
        const parsed = new URL(url, document.baseURI);
        const page = new URL(window.location.href);
        if (parsed.protocol === 'blob:') return parsed.origin === page.origin || parsed.origin === 'null';
        // Browsers can play file URLs while still tainting Web Audio capture.
        if (parsed.protocol === 'file:') return false;
        return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === page.origin;
      } catch (_) { return false; }
    }

    _disconnectGraph() {
      if (this._mediaSource) {
        try { this._mediaSource.disconnect(); } catch (_) { /* Already disconnected. */ }
      }
      if (this._analyser) {
        try { this._analyser.disconnect(); } catch (_) { /* Already disconnected. */ }
      }
      this._mediaSource = null;
      this._analyser = null;
      this._frequencyData = null;
    }

    _prepareAnalysisRoute(url) {
      // A media element remains captured after disconnecting its Web Audio node.
      // Replace it before a remote track so CORS cannot silently mute playback.
      if (this._mediaSource && !this._isAnalysisSafe(url)) {
        this._disconnectGraph();
        const oldAudio = this.audio;
        this._removeAudioListeners(oldAudio);
        oldAudio.pause();
        oldAudio.removeAttribute('src');
        oldAudio.load();
        this.audio = this._createAudio();
      }
    }

    _ensureAudioGraph() {
      if (!this._activeSource || !this._isAnalysisSafe(this._activeSource.url)) return;
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      try {
        if (!this._context) this._context = new Context();
        if (!this._mediaSource) {
          const analyser = this._context.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          const source = this._context.createMediaElementSource(this.audio);
          this._mediaSource = source;
          this._analyser = analyser;
          this._frequencyData = new Uint8Array(analyser.frequencyBinCount);
          source.connect(analyser);
          analyser.connect(this._context.destination);
        }
        if (this._context.state === 'suspended') {
          this._context.resume().catch(() => { /* A later user play can resume it. */ });
        }
      } catch (_) {
        // Keep playback connected even if optional visual analysis is unavailable.
        if (this._mediaSource) {
          try {
            this._mediaSource.disconnect();
            this._mediaSource.connect(this._context.destination);
          } catch (_) { /* Playback errors are reported by the audio element. */ }
        }
        this._analyser = null;
        this._frequencyData = null;
      }
    }

    _applyPendingSeek() {
      if (this._activeSource && this._activeSource.online) return;
      if (!this._pendingSeek || this._pendingSeek.token !== this._loadToken || !this.audio.readyState) return;
      const duration = this._duration();
      const seconds = duration ? Math.min(this._pendingSeek.time, duration) : this._pendingSeek.time;
      try {
        this.audio.currentTime = seconds;
        this._pendingSeek = null;
      } catch (_) { /* Some streams become seekable only after canplay. */ }
    }

    setQueue(tracks, index = 0, options = {}) {
      if (this._destroyed) return Promise.resolve(false);
      this.queue = Array.isArray(tracks) ? tracks.filter((track) => track && typeof track === 'object').map((track) => ({ ...track })) : [];
      const normalizedIndex = Number.isFinite(Number(index)) ? Math.trunc(Number(index)) : 0;
      this.index = this.queue.length ? clamp(normalizedIndex, 0, this.queue.length - 1) : -1;
      return this._select({ autoplay: !!options.autoplay, startTime: options.startTime || 0 });
    }

    _select({ autoplay = false, startTime = 0 } = {}) {
      const token = ++this._loadToken;
      this._readyToken = -1;
      this._wantPlaying = autoplay;
      this._resumeOnline = false;
      this._buffering = autoplay;
      this._lastLoadFailed = false;
      this._heldTime = Math.max(0, Number(startTime) || 0);
      this._pendingSeek = { token, time: Math.max(0, Number(startTime) || 0) };
      this._releaseSource();
      this._emitState();
      if (this.index < 0 || !this.queue[this.index]) {
        this._pendingSeek = null;
        this._loading = null;
        this._readyToken = token;
        this._emitState();
        return Promise.resolve(false);
      }
      const track = this.queue[this.index];
      if (track.sourceType === 'bilibili' && !autoplay) {
        this._resumeOnline = true;
        this._pendingSeek = null;
        this._loading = null;
        this._readyToken = token;
        this._buffering = false;
        this._emitState();
        return Promise.resolve(true);
      }
      this._loading = (async () => {
        let source;
        try {
          source = await this.library.resolveSource(track, { startTime: this._heldTime });
          if (this._destroyed || token !== this._loadToken) {
            if (source.cancel) source.cancel();
            if (source.revoke) URL.revokeObjectURL(source.url);
            return false;
          }
          this._prepareAnalysisRoute(source.url);
          source.resolvedAt = Date.now();
          if (source.online && !this.audio.canPlayType('audio/ogg; codecs="vorbis"')) {
            throw new Error('当前壁纸浏览器不支持 OGG/Vorbis 音频，请更新 Wallpaper Engine。');
          }
          this._activeSource = source;
          if (source.online) { this._pendingSeek = null; this._heldTime = source.startTime || 0; }
          this.audio.preload = source.online ? "none" : "metadata";
          this._readyToken = token;
          // Do not request an online stream until playback is requested.
          if (!source.online) { this.audio.src = source.url; this.audio.load(); }
          this._emitState();
          return true;
        } catch (error) {
          if (!this._destroyed && token === this._loadToken) {
            this._wantPlaying = false;
            this._readyToken = token;
            this._buffering = false;
            this._lastLoadFailed = true;
            this._emitError(error && error.message ? error.message : '无法加载这首歌曲。');
            this._emitState();
          }
          if (source && source.cancel) source.cancel();
          if (source && source.revoke && (!this._activeSource || this._activeSource.url !== source.url)) URL.revokeObjectURL(source.url);
          return false;
        }
      })();
      return autoplay ? this.play() : this._loading;
    }

    async play() {
      if (this._destroyed) return false;
      if (this.index < 0 || !this.queue.length) {
        this._emitError('请先在配置界面导入歌曲，或选择一个保存的歌单。');
        return false;
      }
      this._wantPlaying = true;
      if (this._resumeOnline || this._lastLoadFailed || (this._activeSource && this._activeSource.online &&
          (this.audio.error || Date.now() - this._activeSource.resolvedAt > 90 * 60 * 1000))) {
        return this._select({ autoplay: true, startTime: this._position() });
      }
      const token = this._loadToken;
      if (this._context && this._context.state === 'suspended') this._context.resume().catch(() => {});
      if (this._loading) await this._loading;
      if (this._destroyed || token !== this._loadToken || !this._wantPlaying || !this._activeSource) return false;
      const audio = this.audio;
      if (this._activeSource.online && audio.getAttribute('src') !== this._activeSource.url) {
        audio.src = this._activeSource.url;
        audio.load();
      }
      this._buffering = true;
      this._emitState();
      this._ensureAudioGraph();
      try {
        await audio.play();
        if (this._destroyed || token !== this._loadToken || this.audio !== audio) return false;
        if (!this._wantPlaying) audio.pause();
        this._emitState();
        return this._wantPlaying;
      } catch (error) {
        if (this._destroyed || token !== this._loadToken || !this._wantPlaying || this.audio !== audio) return false;
        this._wantPlaying = false;
        this._buffering = false;
        if (!error || error.name !== 'AbortError') {
          this._emitError(error && error.name === 'NotAllowedError'
            ? '浏览器暂时阻止了自动播放，请点击中央播放按钮。'
            : '无法播放这首歌曲，请检查音频文件或地址是否有效。');
        }
        this._emitState();
        return false;
      }
    }

    pause() {
      if (this._destroyed) return;
      this._heldTime = this._position();
      this._wantPlaying = false;
      this._buffering = false;
      if (this._isOnlineTrack()) {
        ++this._loadToken;
        this._readyToken = this._loadToken;
        this._resumeOnline = true;
        this._pendingSeek = null;
        this._loading = null;
        this._releaseSource();
      } else this.audio.pause();
      this._emitState();
    }

    toggle() {
      if (this._wantPlaying || !this.audio.paused) {
        this.pause();
        return Promise.resolve(false);
      }
      return this.play();
    }

    next() {
      if (this._destroyed || !this.queue.length) return Promise.resolve(false);
      if (this.index + 1 >= this.queue.length && this.repeat === 'off') {
        this.pause();
        return Promise.resolve(false);
      }
      this.index = (this.index + 1) % this.queue.length;
      return this._select({ autoplay: true });
    }

    previous() {
      if (this._destroyed || !this.queue.length) return Promise.resolve(false);
      if (this._position() > 3 || (this.index === 0 && this.repeat === 'off')) {
        if (this._isOnlineTrack()) return this._select({ autoplay: true });
        this.seek(0);
        return this.play();
      }
      this.index = (this.index - 1 + this.queue.length) % this.queue.length;
      return this._select({ autoplay: true });
    }

    _handleEnded() {
      this._wantPlaying = false;
      if (this.repeat === 'one') {
        this._select({ autoplay: true });
      } else if (this.index + 1 < this.queue.length) {
        this.index += 1;
        this._select({ autoplay: true });
      } else if (this.repeat === 'all' && this.queue.length) {
        this.index = 0;
        this._select({ autoplay: true });
      } else {
        this._emitState();
      }
    }

    seek(seconds) {
      if (this._destroyed || this.index < 0) return;
      const requested = Number(seconds);
      if (!Number.isFinite(requested)) return;
      if (this._isOnlineTrack()) {
        const duration = this._duration();
        const time = duration ? clamp(requested, 0, Math.max(0, duration - 0.1)) : Math.max(0, requested);
        return this._select({ autoplay: this._wantPlaying || !this.audio.paused, startTime: time });
      }
      this._pendingSeek = { token: this._loadToken, time: Math.max(0, requested) };
      this._applyPendingSeek();
      this._emitState();
    }

    setVolume(value) {
      const volume = Number(value);
      if (this._destroyed || !Number.isFinite(volume)) return;
      this.volume = clamp(volume, 0, 1);
      this.audio.volume = this.volume;
      this._emitState();
    }

    setRepeat(value) {
      if (!['all', 'one', 'off'].includes(value)) return;
      this.repeat = value;
      this._emitState();
    }

    getFrequencyData() {
      if (!this._analyser || !this._frequencyData || this.audio.paused || this.audio.ended) return null;
      this._analyser.getByteFrequencyData(this._frequencyData);
      return this._frequencyData;
    }

    getAudioEnergy() {
      const data = this.getFrequencyData();
      if (!data || !data.length) return 0;
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      return Math.sqrt(sum / data.length) / 255;
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      this._loadToken += 1;
      this._wantPlaying = false;
      this._removeAudioListeners(this.audio);
      this._releaseSource();
      this._disconnectGraph();
      if (this._context && this._context.state !== 'closed') this._context.close().catch(() => {});
      this._context = null;
      this.queue = [];
      this.index = -1;
    }
  }

  window.MusicPlayer = MusicPlayer;
})();
