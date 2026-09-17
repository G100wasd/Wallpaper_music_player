(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.BlackVinylConfig;
  const preview = new URLSearchParams(location.search).get('preview') === 'background' && parent !== window;
  const background = new WallpaperBackground.Background($('wallpaper'));
  const STORAGE_KEY = 'black-vinyl.config.v1';
  const svg = name => { const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS(element.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); element.append(use); return element; };
  const formatTime = seconds => { const safe = Math.max(0, Math.floor(Number(seconds) || 0)); return String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0'); };
  function fillRange(input) { input.style.setProperty('--fill', ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min) || 1) * 100) + '%'); }
  let config, loadWarning = '';
  try { const saved = localStorage.getItem(STORAGE_KEY); config = C.normalize(saved ? JSON.parse(saved) : C.defaults); }
  catch (_) { config = C.normalize(C.defaults); loadWarning = '未能读取之前的设置，已使用默认布局。'; }
  if(preview)config=C.normalize(C.defaults);
  let player, library, renderer, frame = 0, visualPaused = null;
  let toastTimer, clockTimer, layoutFrame, lastSnapshot, lastPersist = 0, seekDragging = false, hostWasPlaying = false;
  let lastVolume = config.settings.volume || .65, suppressConfigSync = false;
  let reservedListHeight = 396;
  const foldStates = new Map(), foldAnimations = new Set();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) for (const animation of [...foldAnimations]) animation.finish(); });
  const appliedProperties = new Map();
  let currentPages, savedPages;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
  function persist(report = false) {
    if(preview)return true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); return true; }
    catch (_) { if (report) toast('设置暂未保存：本地存储不可用。可在配置中导出 JSON 备份。'); return false; }
  }
  function activeList(source = config) { return source.playlists.find(list => list.id === source.activePlaylistId) || null; }
  function updateClock() {
    const date = new Date();
    $('clock').textContent = [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
    $('clock').dateTime = date.toISOString();
    $('date').textContent = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}  星期${'日一二三四五六'[date.getDay()]}`;
  }
  function scheduleLayout() { cancelAnimationFrame(layoutFrame); layoutFrame = requestAnimationFrame(layout); }
  function layout() {
    const w = innerWidth, h = innerHeight, portrait = h > w * 1.08;
    const settings = config.settings;
    const margin = Math.max(18, Math.min(64, Math.min(w, h) * .052));
    const info = $('information'), list = $('playlist-region'), center = $('player-region'), utility = $('utility');
    if (!config.collapsed.all && !config.collapsed.current && !config.collapsed.saved && !foldAnimations.size) reservedListHeight = list.offsetHeight;
    const base = portrait ? Math.min(w / 960, h / 1600) : Math.min(w / 1700, h / 980);
    let infoScale = base * settings.infoScale;
    infoScale = Math.min(infoScale, (portrait ? w * .51 : w * .29) / info.offsetWidth, h * .26 / info.offsetHeight);
    const listScale = Math.min(base * settings.listScale, (portrait ? w * .47 : w * .29) / 360, h * (portrait ? .32 : .48) / reservedListHeight);
    info.style.right = margin + 'px'; info.style.top = margin + 'px'; info.style.transform = `scale(${infoScale})`;
    list.style.right = margin + 'px'; list.style.bottom = margin + 'px'; list.style.transform = `scale(${listScale})`;
    let playerScale, centerX, top;
    if (portrait) {
      const availableTop = margin + info.offsetHeight * infoScale + h * .025;
      const availableBottom = h - margin - reservedListHeight * listScale - h * .026;
      const desired = Math.min(w * .59 / center.offsetWidth, h * .44 / center.offsetHeight) * settings.playerScale;
      playerScale = Math.max(.15, Math.min(desired, w * .81 / center.offsetWidth, (availableBottom - availableTop) / center.offsetHeight));
      centerX = w / 2;
      top = availableTop + Math.max(0, (availableBottom - availableTop - center.offsetHeight * playerScale) * .5);
    } else {
      centerX = w * .49;
      const rightColumnLeft = w - margin - Math.max(info.offsetWidth * infoScale, 360 * listScale);
      const safePlayerWidth = Math.max(80, (rightColumnLeft - margin * .4 - centerX) * 2);
      playerScale = Math.min(base * settings.playerScale, w * .40 / center.offsetWidth, safePlayerWidth / center.offsetWidth, (h - margin * 2) * .9 / center.offsetHeight);
      top = Math.max(margin, h * .49 - center.offsetHeight * playerScale / 2);
    }
    center.style.left = centerX - center.offsetWidth * playerScale / 2 + 'px';
    center.style.top = top + 'px'; center.style.transform = `scale(${playerScale})`;
    const utilityScale = Math.min(base, (portrait ? w * .44 : w * .31) / utility.offsetWidth, 1.4);
    utility.style.left = margin + 'px'; utility.style.bottom = margin + 'px'; utility.style.transform = `scale(${utilityScale})`;
    document.body.dataset.orientation = portrait ? 'portrait' : 'landscape';
    renderer.resize();
    background.render();
  }
  function applyAppearance(settings = config.settings) {
    background.set(config.background);
    scheduleLayout();
  }
  function setFold(key, button, target, animate) {
    const folded = config.collapsed[key];
    $(button).setAttribute('aria-expanded', String(!folded));
    const element = $(target), previous = foldStates.get(key);
    element.setAttribute('aria-hidden', String(folded));
    element.toggleAttribute('inert', folded);
    if (previous && previous.folded === folded) return;
    const computed = getComputedStyle(element);
    const from = element.hidden ? 0 : parseFloat(computed.height) || element.offsetHeight;
    const opacity = element.hidden ? 0 : Number(computed.opacity);
    if (previous && previous.animation) { previous.animation.onfinish = null; previous.animation.cancel(); foldAnimations.delete(previous.animation); }
    const state = { folded, animation: null }; foldStates.set(key, state);
    element.hidden = false; element.style.height = ''; element.style.opacity = ''; element.style.overflow = '';
    const natural = element.offsetHeight;
    if (!animate || visualPaused || reducedMotion.matches || typeof element.animate !== 'function') { element.hidden = folded; return; }
    element.style.overflow = 'hidden';
    const animation = element.animate([{height: from + 'px', opacity}, {height: (folded ? 0 : natural) + 'px', opacity: folded ? 0 : 1}], {duration: folded ? 340 : 400, easing:'cubic-bezier(.22,1,.36,1)', fill:'both'});
    state.animation = animation; foldAnimations.add(animation);
    animation.onfinish = () => {
      if (foldStates.get(key) !== state) return;
      element.hidden = folded; element.style.overflow = ''; state.animation = null;
      foldAnimations.delete(animation); animation.onfinish = null; animation.cancel(); scheduleLayout();
    };
  }
  function renderFolds(animate = false) {
    if (animate) $('playlist-region').classList.add('motion-enabled');
    setFold('all', 'collapse-all', 'all-lists', animate); setFold('current', 'collapse-current', 'current-pages', animate); setFold('saved', 'collapse-saved', 'saved-pages', animate);
    $('playlist-region').classList.toggle('is-collapsed', config.collapsed.all); scheduleLayout();
  }
  function makeTrackRow(track, index) {
    const row = document.createElement('button'); row.className = 'list-row'; row.dataset.trackId = track.id;
    row.setAttribute('role', 'listitem'); row.title = track.title;
    const icon = svg('bars'); icon.classList.add('row-icon'); icon.style.visibility = track.id === config.trackId ? 'visible' : 'hidden';
    const title = document.createElement('span'); title.className = 'row-title'; title.textContent = track.title;
    const meta = document.createElement('span'); meta.className = 'row-meta'; meta.textContent = track.duration ? formatTime(track.duration) : '--:--';
    row.append(icon, title, meta); row.classList.toggle('selected', track.id === config.trackId);
    row.setAttribute('aria-current', track.id === config.trackId ? 'true' : 'false');
    const playlistId = config.activePlaylistId;
    row.addEventListener('click', () => loadPlaylist(playlistId, index, true)); return row;
  }
  function makeSavedRow(list) {
    const row = document.createElement('button'); row.className = 'list-row'; row.dataset.playlistId = list.id; row.setAttribute('role', 'listitem'); row.title = list.name;
    row.classList.toggle('selected', list.id === config.activePlaylistId);
    const title = document.createElement('span'); title.className = 'row-title'; title.textContent = list.name;
    const count = document.createElement('span'); count.className = 'row-meta'; count.textContent = list.tracks.length + ' 首';
    row.append(title, count); row.addEventListener('click', () => loadPlaylist(list.id, 0, true)); return row;
  }
  function renderLists() {
    const current = activeList(), tracks = current ? current.tracks : [];
    $('current-count').textContent = String(tracks.length).padStart(2, '0');
    $('saved-count').textContent = String(config.playlists.length).padStart(2, '0');
    currentPages.update(tracks, JSON.stringify([tracks, config.trackId]), config.activePlaylistId);
    savedPages.update(config.playlists, JSON.stringify([config.playlists.map(list => [list.id, list.name, list.tracks.length]), config.activePlaylistId]), 'saved');
    renderFolds();
  }
  async function loadPlaylist(id, index = 0, autoplay = false, startTime = 0) {
    const list = config.playlists.find(item => item.id === id);
    config.activePlaylistId = list ? list.id : null; config.trackId = list && list.tracks[index] ? list.tracks[index].id : null; config.position = startTime;
    renderLists(); persist();
    await player.setQueue(list ? list.tracks : [], index, { autoplay, startTime });
  }
  function onPlayerState(event) {
    const state = event.detail, previous = lastSnapshot; lastSnapshot = state;
    if (state.loading && !state.track) return;
    $('track-title').textContent = state.track ? state.track.title : '尚未选择音乐';
    $('track-artist').textContent = state.track ? (state.loading ? '正在缓冲…' : (state.track.artist || '')) : '在配置中导入音乐';
    $('play-icon').setAttribute('href', state.playing || state.pendingPlay ? '#i-pause' : '#i-play');
    $('play-pause').setAttribute('aria-label', state.playing || state.pendingPlay ? '暂停' : '播放'); $('play-pause').title = state.playing || state.pendingPlay ? '暂停' : '播放';
    ['play-pause', 'previous', 'next'].forEach(id => $(id).disabled = !state.track);
    $('current-time').textContent = formatTime(state.currentTime); $('total-time').textContent = formatTime(state.duration);
    $('seek').disabled = !state.duration; $('seek').max = state.duration || 100;
    if (!seekDragging) { $('seek').value = state.currentTime; fillRange($('seek')); }
    $('volume').value = Math.round(state.volume * 100); $('volume-value').textContent = Math.round(state.volume * 100) + '%'; fillRange($('volume'));
    $('volume-icon').setAttribute('href', state.volume === 0 ? '#i-mute' : '#i-volume'); $('mute').setAttribute('aria-label', state.volume === 0 ? '取消静音' : '静音');
    renderer.setPlaying(state.playing);
    if (suppressConfigSync) return;
    config.settings.volume = state.volume; config.trackId = state.track ? state.track.id : null; config.position = state.currentTime;
    if (state.track && state.duration > 0 && !state.loading) {
      const list = activeList(), saved = list && list.tracks.find(track => track.id === state.track.id);
      if (saved) saved.duration = state.duration;
    }
    if (!previous || (previous.track && previous.track.id) !== (state.track && state.track.id) || previous.duration !== state.duration) renderLists();
    if (performance.now() - lastPersist > 2000 || !state.playing) { persist(); lastPersist = performance.now(); }
  }
  function wireUI() {
    $('open-config').addEventListener('click', async () => {try {await LocalConfig.call('open','POST','');} catch (_) {toast('首次使用请运行此壁纸文件夹中的“启用自动启动.cmd”。已启用时可运行 Start-Config.cmd 重试。');}});
    [['all', 'collapse-all'], ['current', 'collapse-current'], ['saved', 'collapse-saved']].forEach(([key, id]) => $(id).addEventListener('click', () => { currentPages.finish(); savedPages.finish(); config.collapsed[key] = !config.collapsed[key]; renderFolds(true); persist(true); }));
    $('play-pause').addEventListener('click', () => player.toggle()); $('previous').addEventListener('click', () => player.previous()); $('next').addEventListener('click', () => player.next());
    $('seek').addEventListener('pointerdown', () => seekDragging = true);
    $('seek').addEventListener('input', () => { fillRange($('seek')); $('current-time').textContent = formatTime($('seek').value); });
    $('seek').addEventListener('change', () => { player.seek(Number($('seek').value)); seekDragging = false; });
    window.addEventListener('pointerup', () => seekDragging = false);
    $('volume').addEventListener('input', () => { player.setVolume(Number($('volume').value) / 100); if (player.volume > 0) lastVolume = player.volume; persist(); });
    $('mute').addEventListener('click', () => { if (player.volume > 0) { lastVolume = player.volume; player.setVolume(0); } else player.setVolume(lastVolume || .65); persist(); });
    window.addEventListener('resize', scheduleLayout); window.addEventListener('pagehide', () => { persist(); player.pause(); });
  }
  const waveCanvas = $('wave'), waveContext = waveCanvas.getContext('2d'), audioWave = new AudioWave();
  let outputDevice = null, devicePolling = false;
  let pcmSnapshot = null, pcmAt = -Infinity, pcmError = '等待波形采样…';
  async function pollPCM() {
    let delay = 50;
    if (config.settings.audioDisplay !== 'waveform' || visualPaused) {
      pcmSnapshot = null; pcmAt = -Infinity; delay = 250;
    } else {
      try {
        const result = await LocalConfig.call('audio-wave');
        const valid = result.available && Array.isArray(result.left) && Array.isArray(result.right) && result.left.length >= 2 && result.left.length === result.right.length;
        pcmSnapshot = valid ? result : null; pcmAt = performance.now();
        pcmError = valid ? '' : (result.error || '等待波形采样…');
        if (!valid) delay = 500;
      } catch (_) {
        pcmSnapshot = null; pcmAt = -Infinity; delay = 1000;
        pcmError = '波形采集未连接，请重启新版助手';
      }
    }
    setTimeout(pollPCM, delay);
  }
  async function pollAudioDevice() {
    if (devicePolling) return; devicePolling = true;
    try { const result = await LocalConfig.call('audio-device'); outputDevice = result.available ? result : null; }
    catch (_) { outputDevice = null; }
    finally { devicePolling = false; }
  }
  let waveW = 358, waveH = 60, lastDraw = 0, frameCount = 0, fpsAt = 0;
  function resizeWave() { const dpr = Math.min(devicePixelRatio || 1, 2); waveCanvas.width = Math.round(waveW * dpr); waveCanvas.height = Math.round(waveH * dpr); waveContext.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function drawWave(now) {
    const native = now - WallpaperBridge.audioAt < 400;
    const data = native ? WallpaperBridge.audio : player.getFrequencyData();
    const gain = config.settings.waveGain;
    const energy = audioWave.update(native ? data : null, native, native ? null : data);
    renderer.setEnergy(Math.min(1, energy * gain * 2.6));
    const stereo = config.settings.waveMode === 'stereo' || (config.settings.waveMode === 'auto' && outputDevice && outputDevice.isHeadphones);
    waveCanvas.dataset.mode = stereo ? 'stereo' : 'single';
    const waveform = config.settings.audioDisplay === 'waveform';
    waveCanvas.dataset.display = waveform ? 'waveform' : 'volume';
    waveCanvas.setAttribute('aria-label', (stereo ? '左右声道' : '') + (waveform ? '真实声音波形' : '音量波动'));
    const snapshot = now - pcmAt < 500 ? pcmSnapshot : null;
    const status = $('wave-status'), showStatus = waveform && !snapshot;
    if (status.hidden === showStatus) { status.hidden = !showStatus; scheduleLayout(); }
    if (showStatus) status.textContent = pcmError || '等待波形采样…';
    if (waveform) audioWave.drawPCM(waveContext, waveW, waveH, snapshot, gain, stereo);
    else audioWave.draw(waveContext, waveW, waveH, now, gain, stereo);
  }
  function animate(now) {
    frame = 0; if (visualPaused) return;
    const interval = 1000 / WallpaperBridge.fps;
    if (now - lastDraw >= interval - .6) {
      lastDraw = now - ((now - lastDraw) % interval); drawWave(now); frameCount++;
      if (now - fpsAt >= 1000) { $('fps-value').textContent = String(Math.round(frameCount * 1000 / (now - fpsAt))); frameCount = 0; fpsAt = now; }
    }
    frame = requestAnimationFrame(animate);
  }
  function updatePaused() {
    // CEF visibility does not reliably represent whether a desktop wallpaper is active.
    const paused = WallpaperBridge.isWallpaper ? WallpaperBridge.paused : document.hidden;
    if (visualPaused === paused) return;
    visualPaused = paused; renderer.setPaused(visualPaused);
    currentPages.setPaused(visualPaused); savedPages.setPaused(visualPaused);
    // Finish UI transitions when rendering pauses so invisible/inert panels cannot get stuck.
    if (visualPaused) for (const animation of [...foldAnimations]) animation.finish();
    cancelAnimationFrame(frame); frame = 0; clearInterval(clockTimer);
    if (!visualPaused) { updateClock(); clockTimer = setInterval(updateClock, 250); fpsAt = performance.now(); frameCount = 0; frame = requestAnimationFrame(animate); }
    else $('fps-value').textContent = '0';
  }
  let hostDisplayTimer, hostDisplayPatch = {}, publishingDisplay = false;
  async function publishHostDisplay() {
    if (publishingDisplay || !Object.keys(hostDisplayPatch).length) return;
    const patch = hostDisplayPatch; hostDisplayPatch = {}; publishingDisplay = true;
    try { await LocalConfig.call('host-display','POST',JSON.stringify(patch)); }
    catch (_) { hostDisplayPatch = { ...patch, ...hostDisplayPatch }; }
    finally { publishingDisplay = false; if (Object.keys(hostDisplayPatch).length) hostDisplayTimer = setTimeout(publishHostDisplay, 2000); }
  }
  function onHostUpdate(bridge) {
    let changed = false;
    const map = { infoscale: 'infoScale', playerscale: 'playerScale', listscale: 'listScale', wavegain: 'waveGain' };
    Object.entries(bridge.properties).forEach(([key, property]) => {
      if (!property || appliedProperties.get(key) === property.value) return;
      appliedProperties.set(key, property.value);
      if (map[key]) { const value = C.clamp(Number(property.value) / 100, .5, key === 'wavegain' ? 3 : 1.5, 1); config.settings[map[key]] = value; hostDisplayPatch[map[key]] = value; changed = true; }
    });
    if (changed) { applyAppearance(); persist(); clearTimeout(hostDisplayTimer); hostDisplayTimer = setTimeout(publishHostDisplay, 200); }
    renderer.setFps(bridge.fps);
    if (bridge.paused) { if (lastSnapshot && (lastSnapshot.playing || lastSnapshot.pendingPlay)) { hostWasPlaying = true; player.pause(); } }
    else if (hostWasPlaying) { hostWasPlaying = false; player.play(); }
    updatePaused();
  }
  let diskSignature='', syncing=false;
  async function syncDiskConfig(){
    if(syncing)return;syncing=true;
    try { const disk=await LocalConfig.read(),signature=JSON.stringify(disk);if(signature===diskSignature)return;
      const next=C.normalize(disk),before=JSON.stringify(config.playlists),beforeActive=config.activePlaylistId,playing=lastSnapshot&&lastSnapshot.playing;
      if (publishingDisplay || Object.keys(hostDisplayPatch).length) return;
      config=next;diskSignature=signature;try{localStorage.setItem('black-vinyl.disk-signature',signature);}catch(_){}persist();applyAppearance();renderLists();
      player.setVolume(config.settings.volume);player.setRepeat(config.settings.repeat);
      if(before!==JSON.stringify(config.playlists)||beforeActive!==config.activePlaylistId)await loadPlaylist(config.activePlaylistId,0,Boolean(playing),0);
    }catch(_){}finally{syncing=false;}
  }
  async function start() {
    if(preview){startPreview();return;}
    try { const disk = await LocalConfig.read(); diskSignature = JSON.stringify(disk);
      let sameDisk=false;try{sameDisk=localStorage.getItem('black-vinyl.disk-signature')===diskSignature;localStorage.setItem('black-vinyl.disk-signature',diskSignature);}catch(_){}
      if(!sameDisk)config = C.normalize(disk);
    } catch (_) {}
    updateClock(); library = new MusicLibrary(); renderer = new TurntableRenderer($('turntable')); player = new MusicPlayer(library);
    player.addEventListener('state', onPlayerState); player.addEventListener('error', event => toast(event.detail.message));
    currentPages = new PagedList('current', makeTrackRow, '暂无歌曲', scheduleLayout);
    savedPages = new PagedList('saved', makeSavedRow, '在配置中创建歌单', scheduleLayout);
    wireUI(); applyAppearance(); renderLists(); resizeWave(); drawWave(performance.now());
    suppressConfigSync = true;
    player.setVolume(config.settings.volume); player.setRepeat(config.settings.repeat);
    WallpaperBridge.subscribe(onHostUpdate); document.addEventListener('visibilitychange', updatePaused);
    await library.init();
    const list = activeList(); const index = list ? Math.max(0, list.tracks.findIndex(track => track.id === config.trackId)) : 0;
    await loadPlaylist(config.activePlaylistId, index, false, config.position);
    suppressConfigSync = false;
    layout(); renderer.startIntro(); setInterval(syncDiskConfig, 2000);
    pollAudioDevice(); setInterval(pollAudioDevice, 2000);
    pollPCM();
    document.body.dataset.ready = 'true'; if (loadWarning) toast(loadWarning);
  }
  function startPreview(){
    renderer=new TurntableRenderer($('turntable'));
    currentPages=new PagedList('current',makeTrackRow,'暂无歌曲',scheduleLayout);
    savedPages=new PagedList('saved',makeSavedRow,'在配置中创建歌单',scheduleLayout);
    document.body.classList.add('background-preview');
    updateClock();resizeWave();audioWave.draw(waveContext,waveW,waveH,0,1,false);
    $('fps-value').textContent='60';renderLists();layout();renderer.startIntro();
    window.addEventListener('resize',scheduleLayout);
    window.addEventListener('message',event=>{
      if(event.source!==parent||!event.data||event.data.type!=='black-vinyl-background-preview')return;
      try{
        config=C.normalize(event.data.config);
        const source=event.data.imageData;
        background.set(config.background,typeof source==='string'&&source.length<24*1024*1024&&/^data:image\/png;base64,/.test(source)?source:undefined);
        const list=activeList(),track=list&&(list.tracks.find(t=>t.id===config.trackId)||list.tracks[0]);
        $('track-title').textContent=track?track.title:'歌曲名称';$('track-artist').textContent=track?(track.artist||''):'播放器预览';
        ['play-pause','previous','next','seek'].forEach(id=>$(id).disabled=!track);
        $('total-time').textContent=formatTime(track?track.duration:0);$('volume').value=config.settings.volume*100;$('volume-value').textContent=Math.round(config.settings.volume*100)+'%';fillRange($('volume'));
        renderLists();layout();
      }catch(e){console.error(e);}
    });
    document.body.dataset.ready='true';parent.postMessage({type:'black-vinyl-background-ready'},'*');
  }
  start().catch(error => { console.error(error); toast('壁纸未能完整启动：' + error.message); document.body.dataset.ready = 'error'; });
})();
