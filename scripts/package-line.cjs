const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{pathToFileURL}=require('url');
const {dependency}=require('./runtime.cjs');
const {chromium}=dependency('playwright'),JSZip=dependency('jszip');
const files=['index.html','config.html','config-page.js','background-editor.css','engine/background.js','engine/background-editor.js','styles.css','app.js','engine/bridge.js','engine/audio-wave.js','engine/AudioDevice.cs','engine/LoopbackWave.cs','engine/config.js','engine/song-title.js','engine/music-library.js','engine/music-player.js','engine/turntable.js','engine/paged-list.js','engine/local-config.js','engine/bilibili.ps1','engine/display-sync.ps1','engine/StreamRelay.cs','engine/OggTranscoder.cs','tools/ffmpeg/ffmpeg.exe','tools/ffmpeg/COPYING.GPLv3.txt','tools/ffmpeg/NOTICE.txt','project.json','config.default.json','README.md','Config-Helper.ps1','Start-Config.cmd','Stop-Config.ps1','Stop-Config.cmd','Setup-Autostart.ps1','Start-Config-Quiet.cmd','启用自动启动.cmd','取消自动启动.cmd'];
(async()=>{
 require('child_process').execFileSync(process.execPath,[path.join(__dirname,'windows-helper-syntax-check.cjs')],{stdio:'inherit',windowsHide:true});
 const dest=path.resolve('dist/BlackVinyl-Line');fs.mkdirSync(dest,{recursive:true});
 for(const f of files){fs.mkdirSync(path.dirname(path.join(dest,f)),{recursive:true});fs.copyFileSync(f,path.join(dest,f));}
 const defaults=fs.readFileSync('config.default.json','utf8');
 const generated={'connection.js':'window.BlackVinylConnection = null;','config.json':defaults,'config-data.js':'window.BlackVinylDiskConfig = '+defaults+';'};
 for(const [name,data]of Object.entries(generated))fs.writeFileSync(path.join(dest,name),data);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(dest,'index.html')).href);await page.waitForFunction(()=>document.body.dataset.ready==='true');await page.waitForFunction(()=>document.querySelector('#turntable').dataset.intro==='complete');
 await page.screenshot({path:path.join(dest,'preview.jpg'),type:'jpeg',quality:85});
 assert.equal(await page.locator('#config-dialog,#switch-style,#style-transition').count(),0);
 await page.locator('#open-config').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('启用自动启动.cmd'));
 const hostProps=JSON.parse(fs.readFileSync(path.join(dest,'project.json')));assert.ok(!hostProps.general.properties.playerstyle);
 for(const key of ['infoscale','playerscale','listscale','wavegain'])assert.ok(!Object.hasOwn(hostProps.general.properties,key));
 await page.goto(pathToFileURL(path.join(dest,'config.html')).href);await page.waitForFunction(()=>document.querySelector('#config-message').textContent.includes('启用自动启动.cmd'));
 assert.equal(await page.locator('#setting-style').count(),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
 const zip=new JSZip();for(const f of [...files,...Object.keys(generated),'preview.jpg'])zip.file('BlackVinyl-Line/'+f,fs.readFileSync(path.join(dest,f)));
 const archive=path.resolve('dist/BlackVinyl-Line-Wallpaper.zip');fs.writeFileSync(archive,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 const verify=await JSZip.loadAsync(fs.readFileSync(archive));assert.ok(!Object.keys(verify.files).some(n=>n.includes('style-transition')));
 const updateFiles=files;
 const updateZip=new JSZip();for(const file of updateFiles)updateZip.file(file,fs.readFileSync(path.join(dest,file)));
 const updateArchive=path.resolve('dist/BlackVinyl-Update.zip');fs.writeFileSync(updateArchive,await updateZip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 assert.ok(!Object.keys(updateZip.files).some(name=>['config.json','config-data.js','connection.js'].includes(name)||name.startsWith('music/')));
 console.log(JSON.stringify({success:true,archive,updateArchive,files:files.length+4,checks:['clean file startup','offline snapshot','no embedded config or particle renderer','no live connection token in package','display controls only in configuration page','helper-not-running guidance','update preserves existing configuration and music']},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
