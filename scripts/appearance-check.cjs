const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{pathToFileURL}=require('url');
const {chromium}=require('C:/Users/10041/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const defaults=JSON.parse(fs.readFileSync('config.default.json','utf8'));
  await page.route('**/engine/local-config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.qaDisk='+JSON.stringify(defaults)+';window.LocalConfig={read:async()=>structuredClone(qaDisk),call:async()=>({})};'}));
  await page.goto(pathToFileURL(path.resolve('index.html')).href);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  await page.evaluate(()=>wallpaperPropertyListener.applyUserProperties({infoscale:{value:125},playerscale:{value:130},listscale:{value:115},wavegain:{value:170}}));await page.waitForTimeout(100);
  const before=await page.locator('#turntable').boundingBox();
  await page.evaluate(()=>{qaDisk.settings.playerScale=.5;qaDisk.settings.infoScale=.5;qaDisk.settings.listScale=.5;qaDisk.settings.waveGain=.5;qaDisk.settings.repeat='off';});await page.waitForTimeout(2300);
  const after=await page.locator('#turntable').boundingBox();const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('black-vinyl.config.v1')));assert.deepEqual([stored.settings.infoScale,stored.settings.playerScale,stored.settings.listScale,stored.settings.waveGain,stored.settings.repeat],[1.25,1.3,1.15,1.7,'off']);
  await page.evaluate(()=>wallpaperPropertyListener.applyUserProperties({playerscale:{value:90}}));await page.waitForTimeout(100);assert.ok((await page.locator('#turntable').boundingBox()).width<after.width);
  console.log('PASS disk save retains host scale; later host slider still applies');
  assert.deepEqual(errors,[]);await page.goto('about:blank');
  await page.setContent('<style>body{margin:0;background:#000}canvas{width:800px;height:800px}</style><canvas id="record"></canvas>');
  await page.addScriptTag({path:path.resolve('engine/turntable.js')});
  await page.evaluate(()=>{window.qaRenderer=new TurntableRenderer(document.querySelector('canvas'));qaRenderer.startIntro();});await page.waitForTimeout(2800);
  assert.equal(await page.evaluate(()=>qaRenderer.armAngle),-.48);
  await page.locator('canvas').screenshot({path:'output/qa/appearance/paused.png'});
  const framePixel=await page.evaluate(()=>Array.from(qaRenderer.context.getImageData(44,400,1,1).data));
  await page.evaluate(()=>qaRenderer.setPlaying(true));await page.waitForTimeout(1100);
  assert.deepEqual(await page.evaluate(()=>Array.from(qaRenderer.context.getImageData(44,400,1,1).data)),framePixel);
  assert.ok(Math.abs(await page.evaluate(()=>qaRenderer.armAngle))<.002);assert.ok(await page.evaluate(()=>qaRenderer.angle)>.5);
  await page.locator('canvas').screenshot({path:'output/qa/appearance/playing.png'});
  const angle=await page.evaluate(()=>{qaRenderer.setPlaying(false);return qaRenderer.angle;});await page.waitForTimeout(1400);
  assert.notEqual(await page.evaluate(()=>qaRenderer.angle),angle);assert.equal(await page.evaluate(()=>qaRenderer.speed),0);const stoppedAngle=await page.evaluate(()=>qaRenderer.angle);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>qaRenderer.angle),stoppedAngle);assert.equal(await page.evaluate(()=>qaRenderer.armAngle),-.48);
  await page.evaluate(()=>{qaRenderer.setPlaying(true);qaRenderer.setPlaying(false);qaRenderer.setPlaying(true);});await page.waitForTimeout(1400);assert.equal(await page.evaluate(()=>qaRenderer.armAngle),0);
  assert.deepEqual(errors,[]);console.log('PASS arm engagement/return, record rotation/stop, rapid toggling; screenshots saved');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
