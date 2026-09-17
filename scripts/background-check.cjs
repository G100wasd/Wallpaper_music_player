const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),{spawn}=require('child_process'),{pathToFileURL}=require('url');
const {chromium}=require('C:/Users/10041/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=path.resolve('output/qa/background');fs.mkdirSync(path.join(dir,'engine'),{recursive:true});
for(const f of ['index.html','config.html','config-page.js','styles.css','background-editor.css','app.js','Config-Helper.ps1','config.default.json',...fs.readdirSync('engine').filter(f=>/\.(js|cs|ps1)$/.test(f)).map(f=>'engine/'+f)])fs.copyFileSync(f,path.join(dir,f));
const defaults=JSON.parse(fs.readFileSync('config.default.json','utf8'));
defaults.playlists=[{id:'demo',name:'测试歌单',tracks:[{id:'track',title:'歌曲名称',artist:'歌手',sourceType:'url',src:'music/example.ogg',duration:152}]}];defaults.activePlaylistId='demo';defaults.trackId='track';
fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(defaults));fs.writeFileSync(path.join(dir,'connection.js'),'window.BlackVinylConnection=null;');
(async()=>{
 const child=spawn('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'Config-Helper.ps1'),'-NoOpen'],{windowsHide:true,stdio:'ignore'});let c,browser;
 try{
  for(let i=0;i<60;i++){const scope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(dir,'connection.js'),'utf8'),scope);c=scope.window.BlackVinylConnection;if(c)break;if(child.exitCode!==null)throw Error('QA helper startup failed');await new Promise(r=>setTimeout(r,200));}
  assert.ok(c);const headers={'X-BlackVinyl-Token':c.token};
  const request=(route,body)=>fetch(c.url+route,{headers,method:body===undefined?'GET':'POST',body});
  assert.equal((await fetch(c.url+'background',{method:'POST',body:'invalid image'})).status,403);
  assert.equal((await request('background',Buffer.alloc(24))).status,400);
  browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1320,height:1050}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.goto(pathToFileURL(path.join(dir,'config.html')).href);await page.waitForFunction(()=>document.getElementById('config-message').textContent.includes('已连接'));
  assert.ok(await page.locator('#bg-pick').isDisabled());await page.locator('#tab-background').click();
  const preview=()=>page.frames().find(f=>f.url().includes('?preview=background'));
  await page.waitForFunction(()=>document.getElementById('bg-preview').getAttribute('src'));
  while(!preview())await new Promise(r=>setTimeout(r,30));const frame=preview();await frame.waitForFunction(()=>document.body.dataset.ready==='true');
  await page.locator('#bg-hex').fill('#ffffff');await page.locator('#bg-hex').dispatchEvent('change');await frame.waitForFunction(()=>document.querySelector('#information').dataset.ink==='dark');
  assert.equal(await frame.locator('#turntable').getAttribute('data-ink'),'dark');
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=400;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,400,200);x.fillStyle='#111111';x.fillRect(0,200,400,200);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#bg-upload').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});await page.waitForFunction(()=>!document.getElementById('bg-pick').disabled);
  assert.equal(requests.filter(r=>r.url.endsWith('/background')).length,0,'upload stays staged until Save');
  await page.locator('#bg-scale').fill('200');await page.locator('#bg-scale').dispatchEvent('input');
  await frame.waitForFunction(()=>document.querySelector('#information').dataset.ink==='dark'&&document.querySelector('#playlist-region').dataset.ink==='light');
  const cropBox=await page.locator('#bg-source').boundingBox();await page.mouse.move(cropBox.x+cropBox.width*.35,cropBox.y+cropBox.height*.2);await page.mouse.down();await page.mouse.move(cropBox.x+cropBox.width*.65,cropBox.y+cropBox.height*.65,{steps:3});await page.mouse.up();assert.ok(Number(await page.locator('[data-crop=width]').inputValue())<100);
  await page.locator('#bg-crop-reset').click();assert.equal(await page.locator('[data-crop=width]').inputValue(),'100');
  await page.locator('#bg-pick').click();const box=await page.locator('#bg-source').boundingBox();await page.mouse.click(box.x+box.width*.5,box.y+box.height*.2);assert.equal(await page.locator('#bg-color').inputValue(),'#ff0000');
  // Crop top half via exact fields, move image to the bottom, retain a white upper area.
  await page.locator('[data-crop=height]').fill('50');await page.locator('[data-crop=height]').dispatchEvent('change');
  await page.locator('#bg-hex').fill('#ffffff');await page.locator('#bg-hex').dispatchEvent('change');
  await page.locator('#bg-y').fill('100');await page.locator('#bg-y').dispatchEvent('input');
  await page.locator('#bg-scale').fill('125');await page.locator('#bg-scale').dispatchEvent('input');
  await frame.waitForFunction(()=>{const c=document.getElementById('wallpaper-background'),x=c.getContext('2d'),top=x.getImageData(0,0,1,1).data,bottom=x.getImageData(c.width/2,c.height-10,1,1).data;return top[0]===255&&top[1]===255&&bottom[0]===255&&bottom[1]===0;});
  assert.equal(await frame.locator('#information').getAttribute('data-ink'),'dark');
  await page.locator('#bg-orientation').selectOption('landscape');await frame.waitForFunction(()=>innerWidth===1920&&innerHeight===1080);
  await page.locator('#bg-orientation').selectOption('portrait');await frame.waitForFunction(()=>innerWidth===1600&&innerHeight===2560);
  // Exercise actual preview dragging and wheel zoom, then restore exact values for persistence.
  const drag=await page.locator('#bg-preview-drag').boundingBox();await page.mouse.move(drag.x+drag.width/2,drag.y+drag.height/2);await page.mouse.down();await page.mouse.move(drag.x+drag.width/2+15,drag.y+drag.height/2-30,{steps:3});await page.mouse.up();assert.notEqual(await page.locator('#bg-x').inputValue(),'50');
  await page.mouse.wheel(0,-60);assert.ok(Number(await page.locator('#bg-scale').inputValue())>125);
  await page.locator('#bg-x').fill('50');await page.locator('#bg-x').dispatchEvent('input');await page.locator('#bg-y').fill('100');await page.locator('#bg-y').dispatchEvent('input');await page.locator('#bg-scale').fill('125');await page.locator('#bg-scale').dispatchEvent('input');
  // Preview must never call playback/open/display mutation endpoints.
  assert.equal(requests.filter(r=>r.method==='POST').length,0);
  await page.locator('#save-config').click();await page.waitForFunction(()=>document.getElementById('config-message').textContent.includes('背景与配置已保存'));
  let saved=await(await request('config')).json();assert.match(saved.background.image,/^backgrounds\/[a-f0-9]{32}\.png$/);assert.equal(saved.background.y,100);assert.equal(saved.background.scale,1.25);assert.equal(saved.background.crop.height,.5);assert.equal(saved.background.color,'#ffffff');assert.ok(fs.existsSync(path.join(dir,saved.background.image+'.js')));
  await page.reload();await page.waitForFunction(()=>document.getElementById('config-message').textContent.includes('已连接'));await page.locator('#tab-background').click();await page.waitForFunction(()=>!document.getElementById('bg-pick').disabled);assert.equal(await page.locator('#bg-y').inputValue(),'100');
  await page.locator('#bg-upload').setInputFiles('C:/Users/10041/Desktop/缪缪/壁纸/78434819E98906D020636DBF704FC6A7.jpg');await page.waitForFunction(()=>document.getElementById('bg-status').textContent.includes('图片已载入'));
  await page.locator('#bg-y').fill('99');await page.locator('#bg-y').dispatchEvent('input');await page.locator('#bg-scale').fill('105');await page.locator('#bg-scale').dispatchEvent('input');
  await preview().waitForFunction(()=>document.querySelector('#turntable').dataset.intro==='complete');
  await page.screenshot({path:path.join(dir,'background-editor.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);await page.screenshot({path:path.join(dir,'background-editor-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1320,height:1050});
  await page.locator('#bg-remove').click();assert.ok(await page.locator('#bg-pick').isDisabled());
  // Discard the staged replacement; original saved asset remains intact.
  await page.locator('#cancel-config').click();await page.waitForFunction(()=>document.getElementById('bg-y').value==='100');
  await request('stop','');c=null;await new Promise(r=>setTimeout(r,300));
  const wallpaper=await browser.newPage({viewport:{width:1600,height:2560}});wallpaper.on('pageerror',e=>errors.push(e.message));await wallpaper.goto(pathToFileURL(path.join(dir,'index.html')).href);await wallpaper.waitForFunction(()=>document.body.dataset.ready==='true');await wallpaper.waitForFunction(()=>document.querySelector('#turntable').dataset.intro==='complete');
  await wallpaper.waitForFunction(()=>{const c=document.getElementById('wallpaper-background'),d=c.getContext('2d').getImageData(c.width/2,c.height-10,1,1).data;return d[0]===255&&d[1]===0;});assert.equal(await wallpaper.locator('#information').getAttribute('data-ink'),'dark');
  await wallpaper.screenshot({path:path.join(dir,'saved-background.png')});assert.deepEqual(errors,[]);
  console.log('PASS background staging, pixel color picker, crop/position/zoom, both preview layouts, drag/wheel, per-region ink, authenticated asset save, reload, discard and offline wallpaper startup/intro');
 }finally{if(browser)await browser.close();if(c)await fetch(c.url+'stop',{method:'POST',headers:{'X-BlackVinyl-Token':c.token}}).catch(()=>{});if(child.exitCode===null){await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);if(child.exitCode===null)child.kill();}}
})().catch(e=>{console.error(e);process.exitCode=1;});
