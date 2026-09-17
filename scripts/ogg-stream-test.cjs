// Isolated compatibility test; does not modify the wallpaper or its configuration.
const fs=require('fs'),path=require('path'),http=require('http'),vm=require('vm'),crypto=require('crypto');
const {spawn}=require('child_process');
const dir=path.resolve('output/qa/online-ogg');
const scope={window:{}};
vm.runInNewContext(fs.readFileSync('output/qa/online-aac/connection.js','utf8'),scope);
const connection=scope.window.BlackVinylConnection;
const ffmpeg=path.join(dir,'tools/ffmpeg.exe');
const token=crypto.randomBytes(24).toString('hex');
const children=new Set(),records=[];
const report={source:{bvid:'BV12vqGBqEgW',cid:'34792474885'},output:{container:'ogg',codec:'vorbis',quality:5},streams:records};
const save=()=>fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));
let base;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,base);
 if(!url.pathname.startsWith('/'+token+'/')){res.writeHead(404);res.end();return;}
 const origin=req.headers.origin;
 if(origin&&origin!=='null'&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)){res.writeHead(403);res.end();return;}
 res.setHeader('Access-Control-Allow-Origin',origin||'null');res.setHeader('Access-Control-Allow-Private-Network','true');
 res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const route=url.pathname.slice(token.length+2);
 if(route==='result'&&req.method==='POST'){
  let body='';for await(const chunk of req){body+=chunk;if(body.length>32768){res.writeHead(413);res.end();return;}}
  report.browser=JSON.parse(body);save();res.end('ok');console.log('RESULT '+JSON.stringify(report.browser));return;
 }
 if(route==='status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({active:children.size,records}));return;}
 if(route==='stop'&&req.method==='POST'){res.end('ok');shutdown();return;}
 if(route!=='stream.ogg'){res.writeHead(404);res.end();return;}
 const offset=Number(url.searchParams.get('start')||0);
 if(!Number.isFinite(offset)||offset<0||offset>140){res.writeHead(400);res.end();return;}
 const record={offset,started:Date.now(),outputBytes:0,oggHeader:false,vorbisHeader:false};records.push(record);
 try{
  const response=await fetch(connection.url+'bilibili/audio',{method:'POST',headers:{'X-BlackVinyl-Token':connection.token},body:JSON.stringify(report.source),signal:AbortSignal.timeout(30000)});
  const source=await response.json();if(!response.ok||!source.online)throw new Error('AAC source resolution failed');
  record.resolveMs=Date.now()-record.started;
  if(res.destroyed)return;
  const args=['-hide_banner','-loglevel','error','-nostdin','-rw_timeout','20000000','-re'];
  if(offset)args.push('-ss',String(offset));
  args.push('-i',source.src,'-map','0:a:0','-vn','-c:a','libvorbis','-q:a','5','-f','ogg','-page_duration','200000','-flush_packets','1','pipe:1');
  const child=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);
  let header=Buffer.alloc(0);
  res.setHeader('Content-Type','audio/ogg');res.setHeader('Accept-Ranges','none');
  child.stdout.on('data',chunk=>{
   if(record.firstByteMs===undefined)record.firstByteMs=Date.now()-record.started;
   record.outputBytes+=chunk.length;
   if(header.length<8192){header=Buffer.concat([header,chunk]).subarray(0,8192);record.oggHeader=header.subarray(0,4).toString()==='OggS';record.vorbisHeader=header.includes(Buffer.from('vorbis'));}
  });
  child.stderr.on('data',chunk=>{record.error=(record.error||'')+chunk.toString().replace(/http:\/\/localhost:\d+\/stream\/[^\s]+/g,'[local audio stream]');});
  child.on('error',error=>{record.error=error.message;if(!res.headersSent)res.writeHead(502);res.end();save();});
  child.on('close',code=>{children.delete(child);record.exitCode=code;record.elapsedMs=Date.now()-record.started;save();});
  res.on('close',()=>{if(child.exitCode===null){child.kill();record.clientClosed=true;}});
  child.stdout.pipe(res);
 }catch(error){record.error=error.message;if(!res.headersSent)res.writeHead(502);res.end();save();}
});
function shutdown(){for(const child of children)child.kill();server.close();server.closeAllConnections();setTimeout(()=>process.exit(),300).unref();}
server.listen(0,'127.0.0.1',()=>{
 base='http://127.0.0.1:'+server.address().port;
 const endpoint=base+'/'+token+'/';
 fs.writeFileSync(path.join(dir,'control.json'),JSON.stringify({endpoint}));
 fs.writeFileSync(path.join(dir,'ogg-probe.html'),`<!doctype html><meta charset="utf-8"><title>Black Vinyl OGG Test</title><style>body{background:#000;color:#fff;font:18px 'Microsoft YaHei';padding:32px;white-space:pre-wrap}</style><body>OGG 在线转码测试…<script>
 (async()=>{
 const endpoint=${JSON.stringify(endpoint)};
 const a=new Audio();a.muted=true;
 const report={userAgent:navigator.userAgent,wallpaperHost:typeof wallpaperRegisterAudioListener==='function',canPlay:a.canPlayType('audio/ogg; codecs="vorbis"'),events:[]};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 for(const event of ['loadedmetadata','canplay','playing','waiting','pause','error'])a.addEventListener(event,()=>{report.events.push({event,time:a.currentTime});});
 const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Playback timeout')),30000))]);
 try{
  const start=performance.now();a.src=endpoint+'stream.ogg';await bounded(a.play());report.firstPlayMs=Math.round(performance.now()-start);
  report.atFirstPlay=await(await fetch(endpoint+'status')).json();
  await sleep(10000);report.playedSeconds=a.currentTime;report.decodedBytes=a.webkitAudioDecodedByteCount;
  a.pause();const atPause=a.currentTime;await sleep(600);report.pauseHeld=Math.abs(a.currentTime-atPause)<.1;
  await bounded(a.play());await sleep(1700);report.resumeAdvanced=a.currentTime>atPause+1;
  a.pause();a.removeAttribute('src');a.load();
  const seekStart=performance.now();a.src=endpoint+'stream.ogg?start=60';await bounded(a.play());report.restartAt60Ms=Math.round(performance.now()-seekStart);await sleep(4000);report.restartPlayedSeconds=a.currentTime;
  report.error=a.error?{code:a.error.code,message:a.error.message}:null;
 }catch(error){report.failure={name:error.name,message:error.message};report.error=a.error?{code:a.error.code,message:a.error.message}:null;}
 a.pause();a.removeAttribute('src');a.load();
 report.passed=report.playedSeconds>8&&report.pauseHeld&&report.resumeAdvanced&&report.restartPlayedSeconds>3&&!report.error&&!report.failure;
 document.body.textContent=JSON.stringify(report,null,2);
 await fetch(endpoint+'result',{method:'POST',body:JSON.stringify(report)});
 })().catch(e=>document.body.textContent=e.stack);
 </script>`);
 console.log('OGG test server ready');
});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
setTimeout(shutdown,240000).unref();
