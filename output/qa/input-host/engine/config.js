(function () {
  'use strict';
  const defaults = {
    version: 1,
    settings: { infoScale: 1, playerScale: 1, listScale: 1, playerStyle: 'line', volume: 0.65, waveGain: 1, repeat: 'all' },
    playlists: [], activePlaylistId: null, trackId: null,
    collapsed: { all: false, current: false, saved: false }
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  function safeSource(source) {
    if (typeof source !== 'string' || !source.trim()) return false;
    const value = source.trim();
    if (/^[a-z]:[\\/]/i.test(value)) return true;
    if (/^(?:https?:|file:)/i.test(value)) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(value) && !/[\x00-\x1f]/.test(value);
  }
  function normalize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置文件应为 JSON 对象。');
    if (input.version != null && input.version !== 1) throw new Error('此配置文件版本暂不支持。');
    const output = clone(defaults), settings = input.settings || {};
    ['infoScale', 'playerScale', 'listScale'].forEach(key => output.settings[key] = clamp(settings[key], 0.5, 1.5, 1));
    output.settings.waveGain = clamp(settings.waveGain, 0.5, 2, 1);
    output.settings.volume = clamp(settings.volume, 0, 1, 0.65);
    output.settings.playerStyle = 'line';
    output.settings.repeat = ['all', 'one', 'off'].includes(settings.repeat) ? settings.repeat : 'all';
    const playlistIds = new Set();
    (Array.isArray(input.playlists) ? input.playlists : []).slice(0, 100).forEach((playlist, pi) => {
      if (!playlist || typeof playlist !== 'object') return;
      let id = String(playlist.id || 'playlist-' + pi).slice(0, 180);
      if (playlistIds.has(id)) id += '-' + pi;
      playlistIds.add(id);
      const trackIds = new Set();
      const tracks = (Array.isArray(playlist.tracks) ? playlist.tracks : []).slice(0, 5000).flatMap((track, ti) => {
        if (!track || typeof track !== 'object') return [];
        const sourceType = ['stored', 'session', 'bilibili'].includes(track.sourceType) ? track.sourceType : 'url';
        if (sourceType === 'url' && !safeSource(track.src)) return [];
        if (['stored','session'].includes(sourceType) && typeof track.assetId !== 'string') return [];
        if (sourceType === 'bilibili' && (!/^BV[0-9a-zA-Z]{10}$/.test(track.bvid) || !/^\d+$/.test(String(track.cid)))) return [];
        let trackId = String(track.id || id + '-track-' + ti).slice(0, 180);
        if (trackIds.has(trackId)) trackId += '-' + ti;
        trackIds.add(trackId);
        return [{ id: trackId, title: String(track.title || track.filename || '未命名音乐').slice(0, 180),
          artist: String(track.artist || '').slice(0, 180), filename: String(track.filename || '').slice(0, 255),
          duration: clamp(track.duration, 0, 864000, 0), sourceType,
          ...(sourceType === 'url' ? { src: track.src.trim() } : sourceType === 'bilibili' ? {bvid:track.bvid,cid:String(track.cid),originalTitle:String(track.originalTitle||track.title||'').slice(0,180),songTitle:String(track.songTitle||track.title||'').slice(0,180),titleMode:track.titleMode==='song'?'song':'video',description:String(track.description||'').slice(0,6000),cover:/^https:\/\/i\d+\.hdslb\.com\//.test(track.cover||'')?track.cover:''} : { assetId: track.assetId.slice(0, 200) }) }];
      });
      output.playlists.push({ id, name: String(playlist.name || '未命名歌单').slice(0, 80), tracks });
    });
    const active = output.playlists.find(list => list.id === input.activePlaylistId) || output.playlists[0];
    output.activePlaylistId = active ? active.id : null;
    output.trackId = active ? (active.tracks.find(track => track.id === input.trackId) || active.tracks[0] || {}).id || null : null;
    output.position = clamp(input.position, 0, 864000, 0);
    Object.keys(output.collapsed).forEach(key => output.collapsed[key] = Boolean(input.collapsed && input.collapsed[key]));
    return output;
  }
  window.BlackVinylConfig = { defaults, clone, clamp, safeSource, normalize };
})();
