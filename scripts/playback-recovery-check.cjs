const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: settle } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'engine/music-player.js'), 'utf8');

class TestAudio extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { src: '', currentTime: 0, duration: NaN, readyState: 0, paused: true, ended: false, error: null });
  }
  canPlayType() { return 'probably'; }
  getAttribute(name) { return this[name] || null; }
  removeAttribute(name) { this[name] = ''; }
  load() { Object.assign(this, { currentTime: 0, duration: NaN, ended: false, error: null, readyState: this.src ? 2 : 0 }); }
  async play() { this.paused = false; this.ended = false; this.dispatchEvent(new Event('playing')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  end(time) { this.currentTime = time; this.paused = true; this.ended = true; this.dispatchEvent(new Event('ended')); }
  fail(time, code = 2) { this.currentTime = time; this.error = { code }; this.dispatchEvent(new Event('error')); }
}

const scope = { window: { wallpaperRegisterAudioListener() {} }, Audio: TestAudio, EventTarget, CustomEvent, URL };
vm.runInNewContext(source, scope);
const MusicPlayer = scope.window.MusicPlayer;
const tracks = [0, 1].map(i => ({ id: 'song-' + i, sourceType: 'bilibili', bvid: 'BV0000000001', cid: String(i + 1), duration: 120 }));

function createPlayer(options = {}) {
  const calls = [], cancelled = [], errors = [];
  let state;
  const player = new MusicPlayer({ resolveSource: async (track, { startTime }) => {
    const call = { id: track.id, startTime };
    calls.push(call);
    if (options.wait) await options.wait(calls.length);
    return { url: 'http://localhost/segment-' + calls.indexOf(call) + '.ogg', online: track.sourceType === 'bilibili',
      duration: track.duration, startTime, cancel: () => cancelled.push(call) };
  } });
  player.addEventListener('state', event => { state = event.detail; });
  player.addEventListener('error', event => errors.push(event.detail.message));
  return { player, calls, cancelled, errors, get state() { return state; } };
}

async function check(name, run) {
  await run();
  console.log('PASS ' + name);
}

async function unitChecks() {
  for (const repeat of ['all', 'one', 'off']) {
    await check('early stream end resumes the same song (' + repeat + ')', async () => {
      const h = createPlayer();
      try {
        h.player.setRepeat(repeat);
        await h.player.setQueue(tracks, 0, { autoplay: true });
        h.player.audio.end(35);
        await settle();
        assert.equal(h.player.index, 0, 'an incomplete stream must not advance the playlist');
        assert.deepEqual(h.calls[1], { id: 'song-0', startTime: 35 }, 'resume the interrupted position, not the start');
        assert.equal(h.state.currentTime, 35);
        assert.equal(h.state.duration, 120);
        assert.equal(h.state.playing, true);
        assert.equal(h.cancelled.length, 1);
        assert.deepEqual(h.errors, []);
      } finally { h.player.destroy(); }
    });
  }

  await check('seek offsets are retained on premature EOF and network/decode failures', async () => {
    for (const kind of ['end', 'network', 'decode']) {
      const h = createPlayer();
      try {
        await h.player.setQueue(tracks, 0, { autoplay: true, startTime: 60 });
        if (kind === 'end') h.player.audio.end(7);
        else h.player.audio.fail(7, kind === 'network' ? 2 : 3);
        await settle();
        assert.equal(h.state.track.id, 'song-0');
        assert.deepEqual(h.calls[1], { id: 'song-0', startTime: 67 });
        assert.equal(h.state.currentTime, 67);
        assert.equal(h.state.playing, true);
      } finally { h.player.destroy(); }
    }
  });

  await check('repeated interruptions stop at the saved position; manual play can retry', async () => {
    const h = createPlayer();
    try {
      await h.player.setQueue(tracks, 0, { autoplay: true });
      for (const time of [30, 0, 0]) { h.player.audio.end(time); await settle(); }
      assert.equal(h.calls.length, 3, 'only two automatic reconnections');
      assert.equal(h.state.track.id, 'song-0');
      assert.equal(h.state.currentTime, 30);
      assert.equal(h.state.playing, false);
      assert.equal(h.state.pendingPlay, false);
      assert.equal(h.errors.length, 1);
      assert.match(h.errors[0], /中断/);
      await h.player.play();
      assert.deepEqual(h.calls[3], { id: 'song-0', startTime: 30 });
      assert.equal(h.state.playing, true);
    } finally { h.player.destroy(); }
  });

  await check('successful playback renews the recovery budget', async () => {
    const h = createPlayer();
    try {
      await h.player.setQueue(tracks, 0, { autoplay: true });
      for (const time of [30, 0, 20]) { h.player.audio.end(time); await settle(); }
      assert.equal(h.calls.length, 4);
      assert.deepEqual(h.calls[3], { id: 'song-0', startTime: 50 });
      assert.equal(h.state.playing, true);
      assert.deepEqual(h.errors, []);
    } finally { h.player.destroy(); }
  });

  for (const action of ['pause', 'next', 'destroy']) {
    await check(action + ' during recovery cancels the old request without restarting it', async () => {
      let complete;
      const h = createPlayer({ wait: count => count === 2 ? new Promise(resolve => { complete = resolve; }) : undefined });
      try {
        await h.player.setQueue(tracks, 0, { autoplay: true });
        h.player.audio.end(30);
        await settle();
        assert.equal(h.calls[1].id, 'song-0');
        await h.player[action]();
        complete();
        await settle();
        assert.ok(h.cancelled.includes(h.calls[1]));
        if (action === 'next') { assert.equal(h.state.track.id, 'song-1'); assert.equal(h.state.playing, true); }
        else if (action === 'pause') { assert.equal(h.state.currentTime, 30); assert.equal(h.state.pendingPlay, false); }
        assert.equal(h.calls.length, action === 'next' ? 3 : 2);
      } finally { h.player.destroy(); }
    });
  }

  await check('natural endings, single repeat and final stop still work', async () => {
    for (const repeat of ['all', 'one', 'off']) {
      const h = createPlayer();
      try {
        h.player.setRepeat(repeat);
        await h.player.setQueue(tracks, 1, { autoplay: true, startTime: 110 });
        h.player.audio.end(9.9);
        await settle();
        if (repeat === 'off') { assert.equal(h.calls.length, 1); assert.equal(h.state.pendingPlay, false); }
        else assert.deepEqual(h.calls[1], { id: repeat === 'one' ? 'song-1' : 'song-0', startTime: 0 });
        assert.deepEqual(h.errors, []);
      } finally { h.player.destroy(); }
    }
  });

  await check('local audio finishes normally and paused/stale ended events cannot skip songs', async () => {
    const h = createPlayer();
    try {
      await h.player.setQueue(tracks.map(t => ({ ...t, sourceType: 'url', src: 'local.wav' })), 0, { autoplay: true });
      h.player.audio.duration = 10;
      h.player.audio.dispatchEvent(new Event('loadedmetadata'));
      h.player.audio.end(10);
      await settle();
      assert.equal(h.state.track.id, 'song-1');
      h.player.pause();
      h.player.audio.end(10);
      await settle();
      assert.equal(h.calls.length, 2);
      assert.equal(h.state.pendingPlay, false);
    } finally { h.player.destroy(); }
  });
}

async function browserCheck() {
  const http = require('node:http');
  const { execFileSync } = require('node:child_process');
  const { chromium } = require('./runtime.cjs').dependency('playwright');
  const segments = new Map();
  for (const seconds of [1, 5]) {
    segments.set('/' + seconds + '.ogg', execFileSync(path.join(root, 'tools/ffmpeg/ffmpeg.exe'),
      ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', String(seconds), '-c:a', 'libvorbis', '-f', 'ogg', 'pipe:1'],
      { windowsHide: true }));
  }
  const server = http.createServer((req, res) => {
    if (segments.has(req.url)) { res.writeHead(200, { 'Content-Type': 'audio/ogg' }); res.end(segments.get(req.url)); }
    else if (req.url === '/player.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(source); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><script>window.wallpaperRegisterAudioListener=()=>{};</script><script src="/player.js"></script>'); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
      args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.evaluate(async () => {
      window.calls = []; window.errors = [];
      window.player = new MusicPlayer({ resolveSource: async (track, { startTime }) => {
        calls.push({ id: track.id, startTime });
        return { url: location.origin + (calls.length === 1 ? '/1.ogg' : '/5.ogg'), online: true, duration: 6, startTime, cancel() {} };
      } });
      player.addEventListener('state', e => { window.state = e.detail; });
      player.addEventListener('error', e => errors.push(e.detail.message));
      await player.setQueue([{ id: 'first', sourceType: 'bilibili', duration: 6 }, { id: 'second', sourceType: 'bilibili', duration: 6 }], 0, { autoplay: true });
    });
    await page.waitForFunction(() => calls.length >= 2);
    const recovery = await page.evaluate(() => calls[1]);
    assert.equal(recovery.id, 'first', 'a real short OGG stream must not skip the first song');
    assert.ok(recovery.startTime > 0.9 && recovery.startTime < 1.1);
    await page.waitForFunction(() => state.index === 0 && state.playing && state.currentTime > 2);
    await page.waitForFunction(() => state.index === 1 && state.playing);
    assert.deepEqual(await page.evaluate(() => errors), []);
    await page.evaluate(() => player.destroy());
    console.log('PASS real OGG decoding: premature EOF resumes, complete remainder advances normally');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  await unitChecks();
  if (process.argv.includes('--browser')) await browserCheck();
})().catch(error => { console.error(error); process.exitCode = 1; });
