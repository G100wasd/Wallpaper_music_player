const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { chromium } = require('C:/Users/10041/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const output = path.resolve('output/qa/rotation'); fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<style>body{margin:0;background:#000}canvas{width:800px;height:800px}</style><canvas></canvas>');
    // Advance only the renderer clock, avoiding timing-dependent animation assertions.
    await page.evaluate(() => { window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {}; });
    await page.addScriptTag({ path: path.resolve('engine/turntable.js') });
    await page.evaluate(() => {
      window.r = new TurntableRenderer(document.querySelector('canvas')); r.setFps(60); r.startIntro();
      window.now = 100;
      window.advance = seconds => { for (let i = 0; i < Math.round(seconds * 60); i++) { now += 1000 / 60; r._tick(now); } };
      advance(0.6);
    });
    assert.equal(await page.evaluate(() => r.introActive), true);
    await page.screenshot({ path: path.join(output, 'startup-drawing.png') });
    await page.evaluate(() => advance(2));
    assert.equal(await page.evaluate(() => r.canvas.dataset.intro), 'complete');
    await page.screenshot({ path: path.join(output, 'stopped.png') });
    const stopped = await page.locator('canvas').screenshot();
    await page.evaluate(() => { r.setPlaying(true); advance(0.4); });
    const mid = await page.evaluate(() => r.speed); assert.ok(mid > 0 && mid < 1.6);
    await page.evaluate(() => advance(0.5));
    assert.equal(await page.evaluate(() => r.speed), 1.6);
    assert.ok(Math.abs(await page.evaluate(() => r.armAngle)) < 0.002);
    // Isolate record rotation: the arm is parked identically in these two snapshots.
    await page.evaluate(() => { r.armAngle = -0.48; r._draw(); });
    assert.notDeepEqual(await page.locator('canvas').screenshot(), stopped);
    await page.screenshot({ path: path.join(output, 'rotated.png') });
    const startStop = await page.evaluate(() => { r.setPlaying(false); return r.angle; });
    await page.evaluate(() => advance(0.5));
    assert.ok(await page.evaluate(() => r.speed > 0 && r.speed < 1.6));
    assert.notEqual(await page.evaluate(() => r.angle), startStop);
    await page.evaluate(() => advance(0.7));
    assert.equal(await page.evaluate(() => r.speed), 0);
    const resting = await page.evaluate(() => r.angle);
    await page.evaluate(() => advance(1)); assert.equal(await page.evaluate(() => r.angle), resting);
    // Rapid reversal preserves current speed and angle; host pause freezes motion.
    await page.evaluate(() => { r.setPlaying(true); advance(0.3); });
    assert.equal(await page.evaluate(() => { const s = r.speed; r.setPlaying(false); return r.speed - s; }), 0);
    await page.evaluate(() => { advance(0.2); r.setPlaying(true); advance(0.9); r.setPaused(true); });
    const paused = await page.evaluate(() => r.angle);
    await page.evaluate(() => advance(2)); assert.equal(await page.evaluate(() => r.angle), paused);
    await page.evaluate(() => { r.setPaused(false); advance(0.2); });
    assert.notEqual(await page.evaluate(() => r.angle), paused);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => r.startIntro()); assert.equal(await page.evaluate(() => r.introActive), false);
    assert.deepEqual(errors, []);
    console.log('PASS: startup stroke reveal, visible asymmetric rotation, 0.8s spin-up, 1s coast-down, stable stop, rapid reversal, host pause/resume, reduced-motion intro');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
