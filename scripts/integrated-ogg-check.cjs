const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),{pathToFileURL}=require('url');
const {chromium}=require('./runtime.cjs').dependency('playwright');
const fixture=path.resolve('output/qa/integrated-ogg');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(fixture,'connection.js'),'utf8'),scope);const c=scope.window.BlackVinylConnection;
async function call(route,body){const r=await fetch(c.url+route,{method:body?'POST':'GET',headers:{'X-BlackVinyl-Token':c.token},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;}
async function idle(){for(let n=0;n<30;n++){if((await call('status')).activeTranscodes===0)return;await new Promise(r=>setTimeout(r,200));}throw Error('Transcoder did not stop');}
(async()=>{
 assert.equal((await call('status')).transcoderAvailable,true);
 const item=require('./runtime.cjs').testVideo();
 const source=await call('bilibili/audio',item);assert.equal(source.codec,'vorbis');assert.equal(source.mimeType,'audio/ogg');assert.ok(source.duration>150);
 const response=await fetch(source.src);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/ogg');
 const reader=response.body.getReader();const first=await reader.read();assert.equal(Buffer.from(first.value).subarray(0,4).toString(),'OggS');
 const t=Date.now();await call('status');assert.ok(Date.now()-t<1500);
 await fetch(source.cancelUrl,{method:'POST'});await reader.cancel().catch(()=>{});await idle();
 assert.equal((await fetch(source.src)).status,410);
 console.log('PASS OGG headers, source duration, concurrent configuration, cancellation and cancelled URL rejection');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--mute-audio']});
 try{
  const p=await browser.newPage({viewport:{width:1600,height:900}});p.setDefaultTimeout(45000);
  await p.addInitScript(()=>{const install=()=>{if(!window.MusicPlayer)return;const Original=MusicPlayer;window.MusicPlayer=new Proxy(Original,{construct(target,args){const player=Reflect.construct(target,args);window.qaPlayer=player;window.qaErrors=[];player.addEventListener('error',e=>qaErrors.push(e.detail.message));player.addEventListener('state',e=>window.qaState=e.detail);return player;}});};document.addEventListener('DOMContentLoaded',()=>{}, {once:true});Object.defineProperty(window,'installPlayerProbe',{value:install});});
  const html=fs.readFileSync(path.join(fixture,'index.html'),'utf8').replace('<script src="app.js"></script>','<script>installPlayerProbe();</script><script src="app.js"></script>');
  await p.route('**/index.html',r=>r.fulfill({body:html,contentType:'text/html'}));
  await p.goto(pathToFileURL(path.join(fixture,'index.html')).href);await p.waitForFunction(()=>document.body.dataset.ready==='true');
  await idle();assert.match(await p.locator('#total-time').textContent(),/^02:3[12]$/);
  await p.locator('#play-pause').click();await p.waitForFunction(()=>qaState.currentTime>1&&qaState.playing);console.log('PASS production page streaming playback');
  await p.locator('#seek').evaluate(el=>{el.value=60;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await p.waitForFunction(()=>qaState.currentTime>60.5&&qaState.playing&&!qaState.loading);assert.ok(await p.evaluate(()=>qaState.duration>150));
  assert.match(await p.locator('#current-time').textContent(),/^01:/);console.log('PASS seek offset and full duration retained');
  await p.locator('#play-pause').click();await idle();const paused=await p.evaluate(()=>qaState.currentTime);assert.ok(paused>60);
  await p.locator('#seek').evaluate(el=>{el.value=30;el.dispatchEvent(new Event('change',{bubbles:true}));});await p.waitForFunction(()=>!qaState.loading&&qaState.currentTime===30);await idle();
  await p.locator('#play-pause').click();await p.waitForFunction(()=>qaState.currentTime>30.5&&qaState.playing);
  console.log('PASS paused seek starts no transcoder; resume uses correct position');
  await p.evaluate(async()=>{const track=qaPlayer.queue[0];await qaPlayer.setQueue([track,{...track,id:'second'}],0,{autoplay:true});});
  await p.locator('#next').click();await p.waitForFunction(()=>qaState.index===1&&qaState.currentTime>.5&&qaState.playing);
  await p.evaluate(()=>{qaPlayer.seek(90);qaPlayer.seek(40);qaPlayer.pause();});await idle();await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>qaState.playing),false);
  assert.equal((await call('status')).activeTranscodes,0);console.log('PASS next song, rapid seeks and pause cancel outstanding playback');
  await p.evaluate(()=>{qaPlayer.play();wallpaperPropertyListener.setPaused(true);});await idle();assert.equal(await p.evaluate(()=>qaState.pendingPlay),false);await p.evaluate(()=>wallpaperPropertyListener.setPaused(false));await p.waitForFunction(()=>qaState.playing&&qaState.currentTime>40.5&&!qaState.loading);await p.evaluate(()=>qaPlayer.pause());await idle();console.log('PASS host pause cancels pending start and host resume restores playback');
  const local=pathToFileURL(path.resolve('scripts/fixtures/qa-tone-a.wav')).href;
  await p.evaluate(async url=>{await qaPlayer.setQueue([{id:'local',title:'Local regression',sourceType:'url',src:url}],0,{autoplay:true});},local);
  await p.waitForFunction(()=>qaState.currentTime>.1&&qaState.playing);assert.deepEqual(await p.evaluate(()=>qaErrors),[]);
  await p.screenshot({path:path.join(fixture,'browser-check.png')});await p.evaluate(()=>qaPlayer.destroy());await idle();
  assert.ok(!fs.existsSync(path.join(fixture,'music')));
  console.log('PASS local audio unchanged and no complete audio cache created');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
