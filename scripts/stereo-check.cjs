const fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), { pathToFileURL } = require('url');
const { chromium } = require('./runtime.cjs').dependency('playwright');
const dir = path.resolve('output/qa/stereo'); fs.mkdirSync(dir, { recursive: true });
for (const file of ['index.html', 'config.html', 'config-page.js', 'background-editor.css', 'styles.css', 'app.js', ...fs.readdirSync('engine').filter(f => f.endsWith('.js')).map(f => 'engine/' + f)]) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.copyFileSync(file, path.join(dir, file));
}
fs.writeFileSync(path.join(dir, 'engine/local-config.js'), `
window.qaDisk=${fs.readFileSync('config.default.json', 'utf8')};
window.qaDevice={available:true,name:'耳机 (P3 PRO)',isHeadphones:true};window.qaOffline=false;
window.LocalConfig={read:async()=>structuredClone(qaDisk),call:async(route,method,body)=>{
 if(route==='audio-device'){if(qaOffline)throw Error('offline');return qaDevice;}
 if(route==='config'&&method==='POST'){qaDisk=JSON.parse(body);window.qaSaved=qaDisk;return {ok:true};}
 if(route==='display')return {settings:qaDisk.settings};return {};
}};`);
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.wallpaperRegisterAudioListener = cb => { window.qaAudio = cb; }; });
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
    await page.waitForFunction(() => document.body.dataset.ready === 'true' && document.getElementById('wave').dataset.mode === 'stereo');
    await page.evaluate(() => {
      window.qaChannels = [0.35, 0];
      setInterval(() => qaAudio(Array.from({ length: 128 }, (_, i) => qaChannels[i < 64 ? 0 : 1])), 30);
    });
    await page.waitForTimeout(500);
    const amplitudes = () => page.locator('#wave').evaluate(c => {
      const { width: w, height: h } = c, data = c.getContext('2d').getImageData(0, 0, w, h).data;
      const totals = [0, 0];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (Math.abs(y - h / 2) > 3 && data[(y * w + x) * 4 + 3] > 50) totals[x < w / 2 ? 0 : 1]++;
      }
      return totals;
    });
    let levels = await amplitudes(); assert.ok(levels[0] > 40 && levels[1] === 0, JSON.stringify(levels));
    await page.locator('.wave-frame').screenshot({ path: path.join(dir, 'left-only.png') });
    await page.evaluate(() => qaChannels = [0, 0.35]); await page.waitForTimeout(1100);
    levels = await amplitudes(); assert.ok(levels[1] > 40 && levels[0] === 0, JSON.stringify(levels));
    await page.locator('.wave-frame').screenshot({ path: path.join(dir, 'right-only.png') });
    await page.evaluate(() => qaChannels = [0.12, 0.12]); await page.waitForTimeout(1000);
    levels = await amplitudes(); assert.ok(Math.abs(levels[0] - levels[1]) < 8, JSON.stringify(levels));
    await page.evaluate(() => qaDevice = { available: true, name: '扬声器', isHeadphones: false });
    await page.waitForFunction(() => document.getElementById('wave').dataset.mode === 'single');
    await page.evaluate(() => qaDisk.settings.waveMode = 'stereo');
    await page.waitForFunction(() => document.getElementById('wave').dataset.mode === 'stereo');
    await page.evaluate(() => { qaDisk.settings.waveMode = 'single'; qaDevice.isHeadphones = true; });
    await page.waitForFunction(() => document.getElementById('wave').dataset.mode === 'single');
    await page.evaluate(() => { qaDisk.settings.waveMode = 'auto'; qaOffline = true; });
    await page.waitForTimeout(2400); assert.equal(await page.locator('#wave').getAttribute('data-mode'), 'single');
    await page.evaluate(() => qaOffline = false);
    await page.waitForFunction(() => document.getElementById('wave').dataset.mode === 'stereo');
    await page.evaluate(() => qaChannels = [0, 0]); await page.waitForTimeout(1500);
    assert.deepEqual(await amplitudes(), [0, 0]);
    await page.goto(pathToFileURL(path.join(dir, 'config.html')).href);
    await page.waitForFunction(() => document.getElementById('audio-device-status').textContent.includes('P3 PRO'));
    await page.locator('#tab-display').click(); await page.locator('#setting-waveMode').selectOption('stereo');
    await page.locator('#save-config').click(); await page.waitForFunction(() => window.qaSaved?.settings.waveMode === 'stereo');
    await page.locator('#cancel-config').click(); assert.equal(await page.locator('#setting-waveMode').inputValue(), 'stereo');
    await page.screenshot({ path: path.join(dir, 'config.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: automatic headphones/speakers, independent L/R pixels, identical mono, silence, manual overrides, helper outage/recovery, config save/read');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
