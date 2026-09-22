const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),{pathToFileURL}=require('url');
const {chromium}=require('./runtime.cjs').dependency('playwright');
(async()=>{
 const favoritesUrl=process.env.BLACKVINYL_TEST_FAVORITES_URL;if(!favoritesUrl)throw Error('Set BLACKVINYL_TEST_FAVORITES_URL to a public test collection with at least two available videos.');
 const fixture=path.resolve('output/qa/integrated-ogg'),scope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(fixture,'connection.js'),'utf8'),scope);const c=scope.window.BlackVinylConnection;
 for(const file of ['index.html','config.html','app.js','config-page.js','styles.css',...fs.readdirSync('engine').filter(x=>x.endsWith('.js')).map(x=>'engine/'+x)])fs.copyFileSync(file,path.join(fixture,file));
 async function call(route,body){const r=await fetch(c.url+route,{method:body?'POST':'GET',headers:{'X-BlackVinyl-Token':c.token},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;}
 await call('config',JSON.parse(fs.readFileSync('config.default.json','utf8')));
 const result=await call('bilibili/favorites',{url:favoritesUrl});assert.ok(result.items.length>=2);assert.ok(result.title);
 const first=result.items.find(x=>x.available);assert.ok(first.title&&first.cover&&first.cid);
 console.log('PASS live public favorites: '+result.items.length+' videos');
 const audio=await call('bilibili/audio',{bvid:first.bvid,cid:first.cid});assert.equal(audio.online,true);assert.equal(audio.codec,'vorbis');assert.ok(!fs.existsSync(path.join(fixture,'music/bilibili-cache')));
 const ogg=await fetch(audio.src);assert.equal(ogg.status,200);assert.equal(ogg.headers.get('content-type'),'audio/ogg');const streamReader=ogg.body.getReader();const firstChunk=await streamReader.read();assert.equal(Buffer.from(firstChunk.value).subarray(0,4).toString(),'OggS');await streamReader.cancel().catch(()=>{});
 const rejected=await fetch(audio.src,{headers:{Origin:'https://example.com'}});assert.equal(rejected.status,403);
 const invalid=await fetch(audio.src.replace(/stream\/[a-f0-9]+/, 'stream/'+ '0'.repeat(64)));assert.equal(invalid.status,404);
 const then=Date.now();await call('status');assert.ok(Date.now()-then<2000);
 console.log('PASS online OGG, media headers, origin/token rejection, concurrent configuration');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--mute-audio']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/connection.js*',route=>route.fulfill({contentType:'application/javascript',body:'window.BlackVinylConnection='+JSON.stringify(c)+';'}));
  await page.goto(pathToFileURL(path.resolve('config.html')).href);await page.waitForFunction(()=>document.querySelector('#config-message').textContent.includes('已连接'));
  assert.deepEqual(await page.locator('[data-tab]').allTextContents(),['歌单','导入','显示设置','配置备份']);
  assert.equal(await page.locator('#audio-files').isVisible(),false);
  await page.locator('#tab-import').click();await page.locator('#import-bilibili').click();await page.locator('#bili-url').fill(favoritesUrl);await page.locator('#parse-bili').click();await page.waitForFunction(()=>document.querySelectorAll('.bili-result').length>=2);
  await page.waitForFunction(()=>[...document.querySelectorAll('.bili-result img')].slice(0,3).every(x=>x.complete&&x.naturalWidth>0));
  await page.screenshot({path:'output/qa/import-bilibili.png'});
  await page.locator('#bili-select-all').uncheck();assert.equal(await page.locator('#add-bili').isDisabled(),true);await page.locator('.bili-result input:not(:disabled)').first().check();await page.locator('#add-bili').click();await page.locator('#add-bili').click();
  await page.locator('#tab-music').click();assert.equal(await page.locator('.edit-track').count(),1);await page.locator('.track-title-editor').fill('测试：已编辑的标题');await page.locator('#repeat-mode').selectOption('one');await page.locator('#save-config').click();await page.waitForFunction(()=>document.querySelector('#config-message').textContent.includes('已写入'));
  const saved=await call('config');assert.equal(saved.playlists[0].tracks.length,1);assert.equal(saved.playlists[0].tracks[0].sourceType,'bilibili');assert.equal(saved.playlists[0].tracks[0].title,'测试：已编辑的标题');assert.equal(saved.playlists[0].tracks[0].description,first.description);assert.equal(saved.settings.repeat,'one');
  await page.screenshot({path:'output/qa/playlist-editor.png'});
  await page.locator('#tab-import').click();await page.locator('#import-local').click();await page.locator('#audio-files').setInputFiles(path.resolve('scripts/fixtures/qa-tone-a.wav'));await page.waitForFunction(()=>document.querySelector('#config-message').textContent.includes('已导入 1 首'));await page.locator('#save-config').click();
  await page.locator('#tab-music').click();assert.equal(await page.locator('.edit-track').count(),2);await page.locator('.reorder-track').last().isDisabled();await page.locator('.edit-track').last().locator('.reorder-track').first().click();assert.ok((await page.locator('.track-title-editor').first().inputValue()).includes('qa-tone'));
  await page.locator('#tab-import').click();await page.screenshot({path:'output/qa/import-local.png'});await page.setViewportSize({width:430,height:920});await page.locator('#import-bilibili').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'output/qa/import-mobile.png'});
  // The relayed OGG must decode and advance; seeking is covered by integrated-ogg-check.
  const p=await browser.newPage();await p.goto(pathToFileURL(path.join(fixture,'config.html')).href);await p.evaluate(src=>{const a=new Audio(src);a.id='probe';document.body.append(a);},audio.src);await p.waitForFunction(()=>document.getElementById('probe').duration>1);await p.evaluate(()=>document.getElementById('probe').play());await p.waitForFunction(()=>document.getElementById('probe').currentTime>.1);await p.evaluate(()=>{const a=document.getElementById('probe');a.pause();a.removeAttribute('src');a.load();});await fetch(audio.cancelUrl,{method:'POST'});
  await p.addInitScript(()=>{const Native=window.Audio;window.Audio=new Proxy(Native,{construct(target,args){const a=Reflect.construct(target,args);window.testAudio=a;return a;}});});
  await p.goto(pathToFileURL(path.join(fixture,'index.html')).href);await p.waitForFunction(()=>document.body.dataset.ready==='true');await p.locator('#play-pause').click();await p.waitForFunction(()=>window.testAudio.currentTime>.1&&!window.testAudio.paused);
  const unsupported=await p.evaluate(async()=>{const player=new MusicPlayer({resolveSource:async()=>({url:'http://localhost:18785/test',online:true})});player.audio.canPlayType=()=>'';const messages=[];player.addEventListener('error',e=>messages.push(e.detail.message));const played=await player.setQueue([{sourceType:'bilibili'}],0,{autoplay:true});player.destroy();return {played,messages};});assert.equal(unsupported.played,false);assert.ok(unsupported.messages[0].includes('不支持 OGG'));assert.equal(unsupported.messages.length,1);
  assert.ok(!fs.existsSync(path.join(fixture,'music/bilibili-cache')));
  assert.deepEqual(errors,[]);console.log('PASS independent tabs, live result list, selective import, deduplication, metadata JSON, title editing, reorder, local import, mobile layout, actual OGG playback');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
