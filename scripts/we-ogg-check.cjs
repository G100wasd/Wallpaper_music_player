const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const dir=path.resolve('output/qa/integrated-ogg'),token=crypto.randomBytes(24).toString('hex');
const server=http.createServer(async(req,res)=>{
 if(req.url!=='/'+token||req.method!=='POST'){res.writeHead(404);res.end();return;}
 res.setHeader('Access-Control-Allow-Origin','*');let text='';for await(const chunk of req){text+=chunk;if(text.length>50000){res.writeHead(413);res.end();return;}}
 const result=JSON.parse(text);fs.writeFileSync(path.join(dir,'wallpaper-engine-result.json'),JSON.stringify(result,null,2));res.end('ok');
 console.log(JSON.stringify(result));if(result.finished)server.close();
});
server.listen(0,'127.0.0.1',()=>{
 const endpoint='http://127.0.0.1:'+server.address().port+'/'+token;
 const probe=`
const NativePlayer=window.MusicPlayer;
window.MusicPlayer=new Proxy(NativePlayer,{construct(target,args){const p=Reflect.construct(target,args);window.qaPlayer=p;window.qaErrors=[];p.addEventListener('state',e=>window.qaState=e.detail);p.addEventListener('error',e=>qaErrors.push(e.detail.message));return p;}});
(async()=>{
 const r={wallpaperHost:typeof wallpaperRegisterAudioListener==='function',userAgent:navigator.userAgent,steps:[],finished:false};
 const post=()=>fetch(${JSON.stringify(endpoint)},{method:'POST',body:JSON.stringify(r)});
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async predicate=>{const start=Date.now();while(!(await predicate())){if(Date.now()-start>35000)throw new Error('Timeout at '+r.steps.join(', '));await sleep(100);}};
 const idle=()=>until(async()=>(await LocalConfig.call('status')).activeTranscodes===0);
 const step=async name=>{r.steps.push(name);await post();};
 try{
  await until(()=>document.body.dataset.ready==='true');qaPlayer.setVolume(0);await idle();await step('No transcoding before play');
  const start=Date.now();document.getElementById('play-pause').click();await until(()=>qaState.playing&&qaState.currentTime>1&&!qaState.loading);r.startMs=Date.now()-start;r.duration=qaState.duration;await step('OGG playback in actual wallpaper');
  const seek=document.getElementById('seek');seek.value=60;seek.dispatchEvent(new Event('change',{bubbles:true}));await until(()=>qaState.playing&&qaState.currentTime>60.5&&!qaState.loading);r.seekDisplay=document.getElementById('current-time').textContent;await step('Seek uses full song position');
  document.getElementById('play-pause').click();await idle();const paused=qaState.currentTime;r.pausedAt=paused;await sleep(500);if(Math.abs(qaState.currentTime-paused)>.1)throw Error('Paused position moved');await step('Pause stops transcoding');
  document.getElementById('play-pause').click();await until(()=>qaState.playing&&qaState.currentTime>paused+.5&&!qaState.loading);await step('Resume continues at saved position');
  document.getElementById('next').click();await until(()=>qaState.playing&&qaState.currentTime>.5&&qaState.currentTime<15&&!qaState.loading);await step('Next track starts from zero');
  qaPlayer.setRepeat('one');await qaPlayer.seek(qaState.duration-1);await until(()=>qaState.playing&&qaState.currentTime>.5&&qaState.currentTime<15&&!qaState.loading);await step('End of stream repeats correctly');
  qaPlayer.pause();await idle();r.errors=qaErrors;if(qaErrors.length)throw Error(qaErrors.join('; '));r.passed=true;
 }catch(error){r.failure=error.message;r.errors=window.qaErrors;try{qaPlayer.pause();}catch(_){}r.passed=false;}
 r.finished=true;await post();
})();`;
 fs.writeFileSync(path.join(dir,'we-probe.js'),probe);
 const html=fs.readFileSync('index.html','utf8').replace('<script src="app.js"></script>','<script src="we-probe.js"></script><script src="app.js"></script>');
 fs.writeFileSync(path.join(dir,'we-probe.html'),html);console.log('Wallpaper Engine integration probe ready');
});
setTimeout(()=>{server.close();server.closeAllConnections();},240000).unref();
