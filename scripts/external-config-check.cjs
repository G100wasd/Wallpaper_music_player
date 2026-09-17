const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{pathToFileURL}=require('url');
const {chromium}=require('C:/Users/10041/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 fs.mkdirSync('output/qa',{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--mute-audio']});
 try{
 const wc=await browser.newContext({viewport:{width:1600,height:900}}),ec=await browser.newContext({viewport:{width:1100,height:900}});
 const w=await wc.newPage(),e=await ec.newPage(),errors=[];for(const p of [w,e])p.on('pageerror',x=>errors.push(x.message));
 await e.goto(pathToFileURL(path.resolve('config.html')).href);await e.evaluate(async()=>{await LocalConfig.call('config','POST',JSON.stringify(BlackVinylConfig.defaults));});
 await w.goto(pathToFileURL(path.resolve('index.html')).href);await w.waitForFunction(()=>document.body.dataset.ready==='true');
 assert.equal(await w.locator('#switch-style,#config-dialog').count(),0);
 await w.waitForFunction(()=>document.querySelector('#turntable').dataset.intro==='drawing');
 await w.screenshot({path:'output/qa/startup-lines.png'});
 await w.waitForFunction(()=>document.querySelector('#turntable').dataset.intro==='complete');
 const originalURL=w.url();await w.locator('#open-config').click();assert.equal(w.url(),originalURL);
 await e.goto(pathToFileURL(path.resolve('config.html')).href);await e.waitForFunction(()=>document.querySelector('#config-message').textContent.includes('已连接'));
 await e.locator('#new-playlist').click();await e.locator('#playlist-name').fill('外部配置同步测试');
 await e.locator('#audio-files').setInputFiles(path.resolve('scripts/fixtures/qa-tone-a.wav'));await e.waitForFunction(()=>document.querySelector('#config-message').textContent.includes('音乐已复制'));
 await e.locator('#save-config').click();await e.waitForFunction(()=>document.querySelector('#config-message').textContent.includes('已写入'));
 await w.waitForFunction(()=>Number(document.querySelector('#current-count').textContent)===1);
 const disk=JSON.parse(fs.readFileSync('config.json','utf8'));assert.equal(disk.playlists[0].name,'外部配置同步测试');assert.ok(fs.existsSync(disk.playlists[0].tracks[0].src));
 await w.locator('#play-pause').click();await w.waitForFunction(()=>document.querySelector('#play-pause').getAttribute('aria-label').includes('暂停'));
 await w.locator('#play-pause').click();
 await e.locator('#tab-display').click();await e.locator('#setting-infoScale').evaluate(x=>{x.value='125';x.dispatchEvent(new Event('input',{bubbles:true}));});await e.locator('#save-config').click();
 await w.waitForFunction(()=>JSON.parse(localStorage.getItem('black-vinyl.config.v1')).settings.infoScale===1.25);
 await e.screenshot({path:'output/qa/external-config.png'});
 await w.locator('#collapse-current').click();await w.locator('#current-list').waitFor({state:'hidden'});
 await w.setViewportSize({width:900,height:1600});await w.screenshot({path:'output/qa/line-portrait.png'});
 assert.deepEqual(errors,[]);console.log('PASS separate browser contexts + file:// pages; JSON disk write; copied music playback; live scale sync; independent fold; portrait; startup line drawing; no wallpaper config UI.');
 // Restore empty deliverable configuration after exercising the actual helper.
 await e.evaluate(async()=>{await LocalConfig.call('config','POST',JSON.stringify(BlackVinylConfig.defaults));});
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
