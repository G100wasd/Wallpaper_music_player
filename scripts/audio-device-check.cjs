const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict'), { spawn } = require('child_process');
const dir = path.resolve('output/qa/audio-device-helper'); fs.mkdirSync(dir, { recursive: true });
for (const file of ['Config-Helper.ps1', 'config.default.json', 'engine/bilibili.ps1', 'engine/display-sync.ps1', 'engine/AudioDevice.cs', 'engine/LoopbackWave.cs', 'engine/StreamRelay.cs', 'engine/OggTranscoder.cs']) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.copyFileSync(file, path.join(dir, file));
}
fs.writeFileSync(path.join(dir, 'connection.js'), 'window.BlackVinylConnection=null;');
(async () => {
  const child = spawn(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'Config-Helper.ps1'), '-NoOpen'], { windowsHide: true, stdio: 'ignore' });
  let c;
  try {
    for (let i = 0; i < 60; i++) {
      const scope = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(dir, 'connection.js'), 'utf8'), scope);
      c = scope.window.BlackVinylConnection; if (c) break;
      if (child.exitCode !== null) throw Error('QA helper exited before startup');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(c, 'QA helper connection');
    const url = c.url + 'audio-device', headers = { 'X-BlackVinyl-Token': c.token };
    let response = await fetch(url, { headers }); assert.equal(response.status, 200);
    const device = await response.json(); assert.equal(typeof device.available, 'boolean'); assert.equal(typeof device.isHeadphones, 'boolean');
    let waveform;
    for (let i = 0; i < 25; i++) {
      const waveResponse = await fetch(c.url + 'audio-wave', { headers }); assert.equal(waveResponse.status, 200);
      waveform = await waveResponse.json(); if (waveform.available) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(waveform.available, waveform.error); assert.equal(waveform.left.length, 512); assert.equal(waveform.right.length, 512);
    assert.ok(waveform.sampleRate > 0);
    assert.equal((await fetch(c.url + 'audio-wave')).status, 403);
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
    const configResponse = await fetch(c.url + 'config', { headers });
    const config = await configResponse.json(); config.settings.waveMode = 'stereo'; config.settings.audioDisplay = 'waveform';
    assert.equal((await fetch(c.url + 'config', { method: 'POST', headers, body: JSON.stringify(config) })).status, 200);
    assert.equal((await (await fetch(c.url + 'config', { headers })).json()).settings.waveMode, 'stereo');
    assert.equal((await (await fetch(c.url + 'config', { headers })).json()).settings.audioDisplay, 'waveform');
    console.log(JSON.stringify({ success: true, device: { name: device.name, isHeadphones: device.isHeadphones, detectedBy: device.detectedBy }, checks: ['real helper endpoint', 'token and origin checks', 'wave mode JSON round-trip'] }));
  } finally {
    if (c) await fetch(c.url + 'stop', { method: 'POST', headers: { 'X-BlackVinyl-Token': c.token } }).catch(() => {});
    if (child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
      if (child.exitCode === null) child.kill();
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
