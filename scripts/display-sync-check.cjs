const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('./runtime.cjs').dependency('playwright');
const root = path.resolve(__dirname, '..');
const mockHelper = process.argv.includes('--mock-helper');
const keys = ['infoScale', 'playerScale', 'listScale', 'waveGain'];
const display = settings => Object.fromEntries(keys.map(key => [key, settings[key]]));
const until = async (condition, label) => {
  const limit = Date.now() + 15000;
  while (!await condition()) { if (Date.now() > limit) throw Error('Timeout: ' + label); await delay(100); }
};

(async () => {
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
  for (const key of ['infoscale', 'playerscale', 'listscale', 'wavegain']) assert.ok(!Object.hasOwn(project.general.properties, key));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'black-vinyl-display-priority-'));
  for (const file of ['index.html', 'config.html', 'config-page.js', 'styles.css', 'background-editor.css', 'app.js', 'Config-Helper.ps1', 'config.default.json']) {
    fs.copyFileSync(path.join(root, file), path.join(dir, file));
  }
  fs.cpSync(path.join(root, 'engine'), path.join(dir, 'engine'), { recursive: true });
  fs.appendFileSync(path.join(dir, 'engine/music-player.js'), '\n{const Original=MusicPlayer;window.MusicPlayer=class extends Original{constructor(...args){super(...args);window.qaPlayer=this;this.addEventListener("state",e=>window.qaState=e.detail);}};}');
  const disk = JSON.parse(fs.readFileSync(path.join(root, 'config.default.json'), 'utf8'));
  Object.assign(disk.settings, { infoScale: 1.15, playerScale: .85, listScale: .75, waveGain: 2.2 });
  disk.playlists = [{ id: 'list', name: 'Saved playlist', tracks: [0, 1].map(i => ({ id: 'song' + i, title: 'Song ' + i, sourceType: 'url', src: 'tone.wav', duration: 120 })) }];
  disk.activePlaylistId = 'list'; disk.trackId = 'song0';
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(disk));
  fs.writeFileSync(path.join(dir, 'connection.js'), 'window.BlackVinylConnection=null;');
  const wav = Buffer.alloc(44 + 8000 * 120 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  fs.writeFileSync(path.join(dir, 'tone.wav'), wav);
  const helper = mockHelper ? null : spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'Config-Helper.ps1'), '-NoOpen'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let connection, browser, stopped = false, helperError, helperOutput = '';
  if (helper) {
    helper.stderr.on('data', chunk => { helperOutput += chunk; });
    helper.on('error', error => { helperError = error; });
  }
  // This mode tests the real pages without starting a service or opening a port.
  let mockConfig = structuredClone(disk);
  function snapshot() {
    fs.writeFileSync(path.join(dir, 'config-data.js'), 'window.BlackVinylDiskConfig=' + JSON.stringify(mockConfig) + ';');
  }
  function mockRequest(route, body) {
    let value, status = 200;
    if (route === 'config') {
      if (body !== undefined) { const savedDisplay = display(mockConfig.settings); mockConfig = structuredClone(body); Object.assign(mockConfig.settings, savedDisplay); snapshot(); }
      value = mockConfig;
    } else if (route === 'display') {
      if (body !== undefined) { Object.assign(mockConfig.settings, body); snapshot(); }
      value = { settings: display(mockConfig.settings) };
    } else if (route === 'audio-device') value = { available: false };
    else if (route === 'stop') { stopped = true; value = { ok: true }; }
    else { value = { error: 'Not found' }; status = 404; }
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  }
  const request = (route, body) => mockHelper ? Promise.resolve(mockRequest(route, body)) : fetch(connection.url + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-BlackVinyl-Token': connection.token }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const api = async (route, body) => { const response = await request(route, body); assert.equal(response.status, 200); return response.json(); };
  try {
    if (mockHelper) {
      connection = { url: 'http://black-vinyl-test.invalid/', token: 'test-only' };
      fs.writeFileSync(path.join(dir, 'connection.js'), 'window.BlackVinylConnection=' + JSON.stringify(connection) + ';');
      snapshot();
      console.log('MODE mock helper: browser integration only; no local service is started');
    } else await until(() => {
      if (helperError) throw helperError;
      if (helper.exitCode !== null) {
        const log = path.join(dir, 'helper-error.txt');
        throw Error('Test helper exited before startup: ' + helperOutput + (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''));
      }
      const scope = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(dir, 'connection.js'), 'utf8'), scope);
      connection = scope.window.BlackVinylConnection; return !!connection;
    }, 'helper startup');
    const initial = await api('config'), errors = [], hostWrites = [];
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--mute-audio'] });
    async function configureContext(context) {
      if (!mockHelper) return;
      await context.route(connection.url + '**', async route => {
        if (stopped) { await route.abort('connectionrefused'); return; }
        const req = route.request(), name = new URL(req.url()).pathname.slice(1);
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Private-Network': 'true' };
        if (req.method() === 'OPTIONS') { await route.fulfill({ status: 200, headers }); return; }
        const result = mockRequest(name, req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : undefined);
        await route.fulfill({ status: result.status, headers, contentType: 'application/json', body: await result.text() });
      });
    }
    async function wallpaper(seed) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      await configureContext(context);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', r => { if (r.url().endsWith('/host-display')) hostWrites.push(r.url()); });
      await page.addInitScript(saved => {
        const cached = structuredClone(saved);
        Object.assign(cached.settings, { infoScale: 1.5, playerScale: 1.5, listScale: 1.5, waveGain: 3, volume: .35 });
        cached.trackId = 'song1'; cached.position = 22; cached.collapsed.current = true;
        localStorage.setItem('black-vinyl.config.v1', JSON.stringify(cached));
        localStorage.setItem('black-vinyl.disk-signature', JSON.stringify(saved));
        window.wallpaperRegisterAudioListener = () => {};
        let listener;
        Object.defineProperty(window, 'wallpaperPropertyListener', { get: () => listener, set: value => {
          listener = value;
          value.applyUserProperties({ infoscale: { value: 50 }, playerscale: { value: 50 }, listscale: { value: 50 }, wavegain: { value: 50 } });
        } });
      }, seed);
      await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
      await page.waitForFunction(() => document.body.dataset.ready === 'true');
      return page;
    }
    const wall = await wallpaper(initial);
    const currentSettings = () => wall.evaluate(() => JSON.parse(localStorage.getItem('black-vinyl.config.v1')).settings);
    assert.deepEqual(display(await currentSettings()), display(initial.settings));
    assert.equal(await wall.evaluate(() => qaState.track.id), 'song1');
    assert.equal(await wall.evaluate(() => qaState.currentTime), 22);
    assert.equal(await wall.evaluate(() => qaState.volume), .35);
    assert.equal(await wall.locator('#current-pages').isHidden(), true);
    console.log('PASS saved display overrides startup host values and stale cache, preserving playback state');

    await wall.evaluate(() => {
      wallpaperPropertyListener.applyUserProperties({ infoscale: { value: 150 }, playerscale: { value: 150 }, listscale: { value: 150 }, wavegain: { value: 300 } });
      wallpaperPropertyListener.applyGeneralProperties({ fps: 30 });
      wallpaperPropertyListener.setPaused(true);
    });
    assert.equal(await wall.locator('#fps-value').textContent(), '0');
    assert.equal(await wall.evaluate(() => WallpaperBridge.fps), 30);
    await wall.evaluate(() => wallpaperPropertyListener.setPaused(false));
    await delay(350);
    assert.deepEqual(display(await currentSettings()), display(initial.settings));
    assert.deepEqual((await api('display')).settings, display(initial.settings));
    assert.equal((await request('host-display', { infoScale: .5 })).status, 404);
    assert.deepEqual((await api('display')).settings, display(initial.settings));
    assert.deepEqual(hostWrites, []);
    console.log('PASS legacy host writes are rejected; FPS and host pause/resume still work');

    const editorContext = await browser.newContext();
    await configureContext(editorContext);
    const editor = await editorContext.newPage();
    editor.on('pageerror', error => errors.push(error.message));
    await editor.goto(pathToFileURL(path.join(dir, 'config.html')).href);
    await editor.waitForFunction(() => document.getElementById('config-message').textContent.includes('已连接'));
    await editor.locator('#new-playlist').click();
    await editor.locator('#playlist-name').fill('Unsaved playlist');
    await editor.locator('#tab-display').click();
    for (const [key, values] of Object.entries({ infoScale: [125], playerScale: [110], listScale: [85, 90, 95], waveGain: [150] })) {
      await editor.locator('#setting-' + key).evaluate((input, sequence) => {
        for (const value of sequence) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
      }, values);
    }
    const expected = { infoScale: 1.25, playerScale: 1.1, listScale: .95, waveGain: 1.5 };
    await until(async () => JSON.stringify(display((await api('display')).settings)) === JSON.stringify(expected), 'editor display save');
    await until(async () => JSON.stringify(display(await currentSettings())) === JSON.stringify(expected), 'wallpaper display update');
    assert.match(await editor.locator('#display-sync-status').textContent(), /已保存/);
    await editor.locator('#tab-music').click();
    assert.equal(await editor.locator('#playlist-name').inputValue(), 'Unsaved playlist');
    assert.equal(await wall.evaluate(() => qaState.track.id), 'song1');
    assert.equal(await wall.evaluate(() => qaState.currentTime), 22);
    console.log('PASS all four editor sliders auto-save and apply without losing drafts or playback position');

    const stale = await api('config');
    await api('display', { infoScale: 1.3 });
    stale.settings.infoScale = .5;
    await api('config', stale);
    assert.equal((await api('display')).settings.infoScale, 1.3);
    await editor.locator('#save-config').click();
    await until(async () => (await api('config')).playlists.some(p => p.name === 'Unsaved playlist'), 'playlist save');
    await editor.waitForFunction(() => !document.getElementById('save-config').disabled && document.getElementById('config-message').textContent.includes('已保存'));
    assert.equal((await api('display')).settings.infoScale, 1.3);
    console.log('PASS stale playlist saves cannot overwrite newer display settings');

    const imported = await api('config');
    Object.assign(imported.settings, { infoScale: 1.05, playerScale: .65, listScale: 1.1, waveGain: 2.7 });
    await editor.locator('#import-json').setInputFiles({ name: 'configuration.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await editor.waitForFunction(() => document.getElementById('config-message').textContent.includes('配置已读取'));
    assert.equal((await api('display')).settings.playerScale, 1.1, 'import stays staged until Save');
    await editor.locator('#save-config').click();
    await until(async () => JSON.stringify(display((await api('display')).settings)) === JSON.stringify(display(imported.settings)), 'import save');
    await until(async () => JSON.stringify(display(await currentSettings())) === JSON.stringify(display(imported.settings)), 'import reaches wallpaper');
    const saved = await api('config');
    await editorContext.close(); await wall.context().close();
    const restarted = await wallpaper(saved);
    assert.deepEqual(display(await restarted.evaluate(() => JSON.parse(localStorage.getItem('black-vinyl.config.v1')).settings)), display(saved.settings));
    await restarted.context().close();
    console.log('PASS imported display settings persist across a fresh wallpaper startup');

    await api('stop', {}); stopped = true;
    if (helper) await until(() => helper.exitCode !== null, 'helper shutdown');
    const offline = await wallpaper(saved);
    assert.deepEqual(display(await offline.evaluate(() => JSON.parse(localStorage.getItem('black-vinyl.config.v1')).settings)), display(saved.settings));
    assert.equal(await offline.evaluate(() => qaState.currentTime), 22);
    assert.deepEqual(errors, []);
    assert.deepEqual(hostWrites, []);
    console.log('PASS offline snapshot overrides stale display cache without host callbacks or page errors');
  } finally {
    if (browser) await browser.close();
    if (connection && !stopped) await request('stop', {}).catch(() => {});
    if (helper && helper.exitCode === null) {
      await Promise.race([new Promise(resolve => helper.once('exit', resolve)), delay(2000)]);
      if (helper.exitCode === null) helper.kill();
    }
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('black-vinyl-display-priority-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
