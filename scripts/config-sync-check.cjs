const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{pathToFileURL}=require('url');
const {chromium}=require('C:/Users/10041/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=path.resolve('output/qa/config-sync');fs.mkdirSync(path.join(dir,'engine'),{recursive:true});
for(const f of ['index.html','styles.css','app.js',...fs.readdirSync('engine').filter(f=>f.endsWith('.js')).map(f=>'engine/'+f)])fs.copyFileSync(f,path.join(dir,f));
const disk=JSON.parse(fs.readFileSync('config.default.json'));
disk.playlists=Array.from({length:2},(_,p)=>({id:'p'+p,name:'Playlist '+p,tracks:Array.from({length:4},(_,t)=>({id:`p${p}t${t}`,title:`Song ${p}-${t}`,artist:'Test',sourceType:'url',src:'tone.wav',duration:0}))}));disk.activePlaylistId='p0';disk.trackId='p0t0';
fs.writeFileSync(path.join(dir,'engine/local-config.js'),`window.QADisk=${JSON.stringify(disk)};window.LocalConfig={read:async()=>structuredClone(QADisk),call:async()=>({})};`);
fs.appendFileSync(path.join(dir,'engine/music-player.js'),`\n{const Original=window.MusicPlayer;window.MusicPlayer=class extends Original{constructor(...args){super(...args);window.qaPlayer=this;}};}`);
const wav=Buffer.alloc(44+8000*120*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);fs.writeFileSync(path.join(dir,'tone.wav'),wav);fs.writeFileSync(path.join(dir,'replacement.wav'),wav);
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(dir,'index.html')).href);await page.waitForFunction(()=>document.body.dataset.ready==='true');
 await page.locator('[data-track-id=p0t2]').click();await page.waitForFunction(()=>!qaPlayer.audio.paused&&qaPlayer.audio.readyState>=2);
 await page.evaluate(()=>{qaPlayer.seek(30);window.originalAudio=qaPlayer.audio;window.originalToken=qaPlayer._loadToken;});
 // Simulate the config page saving a stale draft containing the first song and stale duration.
 await page.evaluate(()=>QADisk.background.color='#ffffff');await page.waitForFunction(()=>document.querySelector('#information').dataset.ink==='dark');
 assert.ok(await page.evaluate(()=>qaPlayer.audio===originalAudio&&qaPlayer._loadToken===originalToken&&!qaPlayer.audio.paused&&qaPlayer.audio.currentTime>=30&&qaPlayer.queue[qaPlayer.index]?.id==='p0t2'));
 // Metadata, reorder, append/remove other songs must update the queue without reopening audio.
 await page.evaluate(()=>{const t=QADisk.playlists[0].tracks;t[2].title='Renamed';QADisk.playlists[0].name='Edited';QADisk.playlists[0].tracks=[t[2],t[0],t[3]];});
 await page.waitForFunction(()=>document.getElementById('track-title').textContent==='Renamed');
 assert.ok(await page.evaluate(()=>qaPlayer.index===0&&qaPlayer.queue.length===3&&qaPlayer._loadToken===originalToken&&qaPlayer.audio.currentTime>=30&&!qaPlayer.audio.paused));
 // Paused position and the queue order survive another background save.
 await page.locator('#play-pause').click();await page.evaluate(()=>{qaPlayer.seek(47);QADisk.background.color='#dddddd';});await page.waitForFunction(()=>document.querySelector('#wallpaper-background').getContext('2d').getImageData(0,0,1,1).data[0]===221);
 assert.ok(await page.evaluate(()=>qaPlayer._loadToken===originalToken&&qaPlayer.audio.paused&&Math.abs(qaPlayer.audio.currentTime-47)<.1));
 await page.locator('#next').click();await page.waitForFunction(()=>qaPlayer.queue[qaPlayer.index]?.id==='p0t0');
 // The wallpaper may select another saved playlist after the editor opened.
 await page.locator('#saved-list [data-playlist-id=p1]').click();await page.waitForFunction(()=>qaPlayer.queue[qaPlayer.index]?.id==='p1t0');await page.locator('[data-track-id=p1t2]').click();
 await page.waitForFunction(()=>!qaPlayer.audio.paused&&qaPlayer.queue[qaPlayer.index]?.id==='p1t2');await page.evaluate(()=>{qaPlayer.seek(22);window.originalToken=qaPlayer._loadToken;QADisk.background.color='#eeeeee';});
 await page.waitForFunction(()=>document.querySelector('#wallpaper-background').getContext('2d').getImageData(0,0,1,1).data[0]===238);
 assert.ok(await page.evaluate(()=>qaPlayer.queue[qaPlayer.index]?.id==='p1t2'&&qaPlayer._loadToken===originalToken&&qaPlayer.audio.currentTime>=22));
 // Removing the current song selects its next neighbour, not the first song.
 await page.evaluate(()=>QADisk.playlists[1].tracks.splice(2,1));await page.waitForFunction(()=>qaPlayer.queue[qaPlayer.index]?.id==='p1t3');assert.ok(await page.evaluate(()=>!qaPlayer.audio.paused));
 // Changing the source of the same ID requires a real reload.
 await page.evaluate(()=>{window.originalToken=qaPlayer._loadToken;QADisk.playlists[1].tracks[2].src='replacement.wav';});await page.waitForFunction(()=>qaPlayer.audio.src.endsWith('/replacement.wav'));assert.ok(await page.evaluate(()=>qaPlayer._loadToken>originalToken));
 // Explicit disk playlist change is honoured; deleting all tracks clears the queue.
 await page.evaluate(()=>{QADisk.activePlaylistId='p1';QADisk.playlists[1].tracks=[];});await page.waitForFunction(()=>qaPlayer.index===-1);assert.ok(await page.locator('#play-pause').isDisabled());
 await page.evaluate(()=>{QADisk.activePlaylistId='p0';QADisk.trackId='p0t3';});await page.waitForFunction(()=>qaPlayer.queue[qaPlayer.index]?.id==='p0t3');assert.ok(await page.evaluate(()=>qaPlayer.audio.paused));
 // Keep a Bilibili resolve in flight while editing metadata; no duplicate resolver or cancellation.
 const online=await page.evaluate(async()=>{
   let complete,calls=0,cancels=0;const p=new MusicPlayer({resolveSource:()=>{calls++;return new Promise(r=>complete=r);}});
   const track={id:'online',sourceType:'bilibili',bvid:'BV1E2ER6NEvN',cid:'123',duration:120,title:'Old'};
   p._ensureAudioGraph=()=>{};p.audio.play=async()=>{};
   const pending=p.setQueue([track],0,{autoplay:true,startTime:19});const token=p._loadToken;
   const retained=p.updateQueue([{...track,title:'New'}, {...track,id:'next'}]);
   const before={retained,calls,tokenSame:p._loadToken===token,want:p._wantPlaying,time:p._position(),title:p.queue[p.index].title};
   complete({url:'http://localhost/unused.ogg',online:true,startTime:19,duration:120,cancel:()=>cancels++});await pending;
   p.pause();const pausedToken=p._loadToken;const paused=p.updateQueue([{...track,title:'Paused'}]);const after={paused,tokenSame:p._loadToken===pausedToken,want:p._wantPlaying,time:p._position(),calls,cancels};p.destroy();return {before,after};
 });
 assert.deepEqual(online.before,{retained:true,calls:1,tokenSame:true,want:true,time:19,title:'New'});assert.deepEqual(online.after,{paused:true,tokenSame:true,want:false,time:19,calls:1,cancels:1});
 assert.deepEqual(errors,[]);console.log('PASS save preserves playing/paused time, current song/playlist, metadata and ordering, next track, deletion/source replacement, explicit selection, and pending/paused online streams');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
