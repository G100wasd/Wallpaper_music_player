const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{pathToFileURL}=require('url');
const {chromium}=require('C:/Users/10041/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=path.resolve('output/qa/startup-layout');fs.mkdirSync(path.join(dir,'engine'),{recursive:true});
for(const f of ['index.html','styles.css',...fs.readdirSync('engine').filter(f=>f.endsWith('.js')).map(f=>'engine/'+f)])fs.copyFileSync(f,path.join(dir,f));
fs.writeFileSync(path.join(dir,'app.js'),'setTimeout(()=>{\n'+fs.readFileSync('app.js','utf8')+'\n},800);');
fs.appendFileSync(path.join(dir,'engine/turntable.js'),'\n{const Original=TurntableRenderer;window.qaIntros=0;window.TurntableRenderer=class extends Original{startIntro(){qaIntros++;super.startIntro();}};}');
const config=JSON.parse(fs.readFileSync('config.default.json'));config.settings.playerScale=1.25;config.settings.listScale=.7;
fs.writeFileSync(path.join(dir,'engine/local-config.js'),`let first=true;window.qaDisk=${JSON.stringify(config)};window.LocalConfig={read:()=>{if(first){first=false;return new Promise((resolve,reject)=>{window.qaResolve=()=>resolve(structuredClone(qaDisk));window.qaReject=()=>reject(Error('offline'));});}return Promise.resolve(structuredClone(qaDisk));},call:async()=>({})};`);
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const errors=[];
 for(const [width,height,reject] of [[1600,900,false],[900,1600,true]]){
  const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.qaBadFrames=[];const inspect=()=>{const root=document.getElementById('wallpaper');if(root&&getComputedStyle(root).visibility==='visible'){for(const id of ['information','player-region','playlist-region','utility']){const el=document.getElementById(id);if(!el.style.transform||!root.hasAttribute('data-layout-ready'))qaBadFrames.push(id);}}requestAnimationFrame(inspect);};requestAnimationFrame(inspect);});
  await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
  assert.equal(await page.locator('#wallpaper').evaluate(e=>getComputedStyle(e).visibility),'hidden','hide markup before app starts');
  await page.waitForFunction(()=>document.getElementById('wallpaper').hasAttribute('data-layout-ready')&&typeof qaResolve==='function');
  assert.notEqual(await page.locator('#clock').textContent(),'00:00:00');assert.notEqual(await page.locator('body').getAttribute('data-ready'),'true','helper is still pending');
  const placed=await page.evaluate(()=>{const r=id=>document.getElementById(id).getBoundingClientRect(),i=r('information'),p=r('player-region'),l=r('playlist-region'),u=r('utility');return i.left>innerWidth*.4&&i.top>0&&p.left>0&&p.top>i.top&&l.right<=innerWidth&&l.bottom<=innerHeight&&u.top>innerHeight*.7;});assert.ok(placed);
  // The shell responds to a display orientation change even before the helper returns.
  await page.setViewportSize({width:height,height:width});await page.waitForFunction(()=>document.body.dataset.orientation===(innerHeight>innerWidth*1.08?'portrait':'landscape'));
  await page.waitForFunction(()=>document.getElementById('turntable').dataset.intro==='complete');assert.equal(await page.evaluate(()=>qaIntros),1);
  await page.evaluate(reject=>reject?qaReject():qaResolve(),reject);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  assert.equal(await page.evaluate(()=>qaIntros),1,'slow settings must not replay the intro');assert.deepEqual(await page.evaluate(()=>qaBadFrames),[]);
  await page.screenshot({path:path.join(dir,reject?'offline.png':'loaded.png')});await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS hidden pre-script markup, positioned first frame, slow/offline helper, resize while loading, and one preserved startup drawing animation');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
