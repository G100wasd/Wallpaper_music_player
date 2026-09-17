const fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), { pathToFileURL } = require('url');
const { chromium } = require('C:/Users/10041/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir = path.resolve('output/qa/waveform'); fs.mkdirSync(dir, { recursive: true });
for (const file of ['index.html', 'config.html', 'config-page.js', 'background-editor.css', 'styles.css', 'app.js', ...fs.readdirSync('engine').filter(f => f.endsWith('.js')).map(f => 'engine/' + f)]) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.copyFileSync(file, path.join(dir, file));
}
const defaults = JSON.parse(fs.readFileSync('config.default.json')); defaults.settings.audioDisplay = 'waveform'; defaults.settings.waveMode = 'stereo';
fs.writeFileSync(path.join(dir, 'engine/local-config.js'), `
window.qaDisk=${JSON.stringify(defaults)};window.qaCalls=0;window.qaOffline=false;
window.qaPCM={available:true,left:Array(512).fill(.25),right:Array(512).fill(0)};
window.LocalConfig={read:async()=>structuredClone(qaDisk),call:async(route,method,body)=>{
 if(route==='audio-device')return {available:true,name:'耳机',isHeadphones:true};
 if(route==='audio-wave'){qaCalls++;if(qaOffline)throw Error('offline');return qaPCM;}
 if(route==='config'&&method==='POST'){qaDisk=JSON.parse(body);window.qaSaved=qaDisk;return {ok:true};}
 if(route==='display')return {settings:qaDisk.settings};return {};
}};`);
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.wallpaperRegisterAudioListener = cb => setInterval(() => cb(Array(128).fill(.8)), 30); });
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
    await page.waitForFunction(() => document.body.dataset.ready === 'true' && document.getElementById('wave').dataset.display === 'waveform' && document.getElementById('wave-status').hidden);
    const frame = await page.locator('#wave').screenshot(); await page.waitForTimeout(250);
    assert.deepEqual(await page.locator('#wave').screenshot(), frame, 'Static PCM must not become an animated sine wave');
    await page.evaluate(() => { qaPCM.left = Array.from({length:512}, (_, i) => (i % 48) / 48 * .7 - .35); });
    await page.waitForTimeout(150);
    await page.locator('.wave-frame').screenshot({ path: path.join(dir, 'pcm-left.png') });
    const span = () => page.locator('#wave').evaluate(c => {
      const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, totals = [0, 0];
      for (let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) if(Math.abs(y-c.height/2)>3 && a[(y*c.width+x)*4+3]>80)totals[x<c.width/2?0:1]++;
      return totals;
    });
    let p = await span(); assert.ok(p[0] > 40 && p[1] === 0);
    await page.evaluate(() => { qaPCM.right = qaPCM.left; qaPCM.left = Array(512).fill(0); }); await page.waitForTimeout(150);
    p = await span(); assert.ok(p[1] > 40 && p[0] === 0);
    await page.evaluate(() => qaOffline = true);
    await page.waitForFunction(() => !document.getElementById('wave-status').hidden);
    assert.deepEqual(await span(), [0, 0], 'No fake frequency fallback while PCM is disconnected');
    await page.evaluate(() => qaOffline = false);
    await page.waitForFunction(() => document.getElementById('wave-status').hidden);
    await page.evaluate(() => wallpaperPropertyListener.setPaused(true)); await page.waitForTimeout(200);
    const pausedCalls = await page.evaluate(() => qaCalls); await page.waitForTimeout(400); assert.equal(await page.evaluate(() => qaCalls), pausedCalls);
    await page.evaluate(() => wallpaperPropertyListener.setPaused(false)); await page.waitForFunction(n => qaCalls > n, pausedCalls);
    await page.evaluate(() => qaDisk.settings.audioDisplay = 'volume');
    await page.waitForFunction(() => document.getElementById('wave').dataset.display === 'volume'); await page.waitForTimeout(200);
    const stoppedCalls = await page.evaluate(() => qaCalls); await page.waitForTimeout(400); assert.equal(await page.evaluate(() => qaCalls), stoppedCalls);
    await page.goto(pathToFileURL(path.join(dir, 'config.html')).href);
    await page.waitForFunction(() => document.getElementById('config-message').textContent.includes('已连接'));
    await page.locator('#tab-display').click();
    assert.equal(await page.locator('#setting-audioDisplay').getAttribute('aria-checked'), 'true');
    await page.locator('#setting-audioDisplay').click(); await page.locator('#save-config').click();
    await page.waitForFunction(() => window.qaSaved?.settings.audioDisplay === 'volume');
    await page.locator('#setting-audioDisplay').click(); await page.locator('#save-config').click();
    await page.waitForFunction(() => window.qaSaved?.settings.audioDisplay === 'waveform');
    await page.locator('#cancel-config').click(); assert.equal(await page.locator('#setting-audioDisplay').textContent(), '波形');
    await page.screenshot({ path: path.join(dir, 'config.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS actual sample geometry, static PCM stays static, independent channels, no fake fallback, pause/volume stop polling, reconnect, config switch persistence');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
