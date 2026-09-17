const fs=require('fs'),path=require('path'),http=require('http'),vm=require('vm'),assert=require('assert/strict'),{spawn}=require('child_process'),{pathToFileURL}=require('url');
const {chromium}=require('C:/Users/10041/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=path.resolve('output/qa/display-sync'),exe='H:/steam/steamapps/common/wallpaper_engine/wallpaper64.exe',location='Black Vinyl Display Sync Test';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let events=[];
const cli=args=>new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsVerbatimArguments:true,windowsHide:true});p.on('error',reject);p.on('exit',resolve);});
const until=async(f,label)=>{const end=Date.now()+12000;while(!await f()){if(Date.now()>end)throw Error('Timeout: '+label);await sleep(100);}};
(async()=>{const server=http.createServer(async(req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');let data='';for await(const c of req)data+=c;if(data)events.push(JSON.parse(data));res.end('ok');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 const endpoint='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(dir,'sync-probe.js'),`const original=wallpaperPropertyListener.applyUserProperties;wallpaperPropertyListener.applyUserProperties=function(p){fetch(${JSON.stringify(endpoint)},{method:'POST',body:JSON.stringify(p)});return original(p);};`);
 fs.writeFileSync(path.join(dir,'index.html'),fs.readFileSync('index.html','utf8').replace('<script src="app.js"></script>','<script src="sync-probe.js"></script><script src="app.js"></script>'));
 await cli(['-control','openWallpaper','-file','"'+path.join(dir,'project.json')+'"','-playInWindow','"'+location+'"','-width','800','-height','600']);await until(()=>events.length,'host initial callback');
 const box={window:{}};vm.runInNewContext(fs.readFileSync(path.join(dir,'connection.js'),'utf8'),box);const c=box.window.BlackVinylConnection;
 const api=async(route,body)=>{const r=await fetch(c.url+route,{method:body?'POST':'GET',headers:{'X-BlackVinyl-Token':c.token},body:body&&JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(dir,'config.html')).href);await until(async()=>!(await page.locator('#save-config').isDisabled()),'page loaded');await page.locator('#new-playlist').click();await page.locator('#playlist-name').fill('未保存的编辑');await page.locator('#tab-display').click();
 await cli(['-control','applyProperties','-properties','RAW~({"playerscale":125,"listscale":70,"wavegain":200})~END','-location','"'+location+'"']);
 await until(async()=>await page.locator('#setting-playerScale').inputValue()==='125'&&await page.locator('#setting-listScale').inputValue()==='70','host to config');
 await page.locator('#tab-music').click();assert.equal(await page.locator('#playlist-name').inputValue(),'未保存的编辑');await page.locator('#tab-display').click();events=[];
 await page.locator('#setting-playerScale').evaluate(e=>{e.value=115;e.dispatchEvent(new Event('input',{bubbles:true}));});
 await until(()=>events.some(p=>p.playerscale?.value===115),'config to actual host');assert.equal((await api('display')).settings.playerScale,1.15);
 // A stale full configuration must preserve newer display settings on disk.
 const stale=await api('config');await api('host-display',{infoScale:1.3});stale.settings.infoScale=.5;await api('config',stale);assert.equal((await api('display')).settings.infoScale,1.3);
 await page.locator('#save-config').click();await until(async()=>(await api('config')).playlists[0]?.name==='未保存的编辑','save playlist');assert.equal((await api('display')).settings.infoScale,1.3);
 // Rapid changes coalesce to latest; other controls and drafts remain intact.
 await page.locator('#setting-listScale').evaluate(e=>{for(const value of [85,90,95]){e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}});
 await until(()=>events.some(p=>p.listscale?.value===95),'coalesced change');assert.equal((await api('display')).settings.listScale,.95);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['actual Wallpaper Engine callback to config page','config page to actual Wallpaper Engine callback','unsaved playlist preserved','stale save protects display','rapid changes last value wins'],events},null,2));console.log('PASS: bidirectional display synchronization with actual Wallpaper Engine');
}finally{if(browser)await browser.close();server.close();server.closeAllConnections();}
})().catch(e=>{console.error(e);process.exitCode=1;});
