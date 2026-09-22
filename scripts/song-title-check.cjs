const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),{pathToFileURL}=require('url');
const {chromium}=require('./runtime.cjs').dependency('playwright');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync('engine/song-title.js','utf8'),ctx);const extract=ctx.window.SongTitle.extract;
for(const [title,desc,want,source] of [
 ['《标题备用》','BGM：测试歌曲一——测试乐队','测试歌曲一','description'],
 ['视频标题','歌曲名称：《Example Two》','Example Two','description'],
 ['「风格」示例 | Example Three | Example Artist','-','Example Three','title'],
 ['《テスト曲》','点歌留言','テスト曲','title'],
 ['原样保留的标题','专辑：《不是歌曲》','原样保留的标题','fallback'],
 ['视频','歌手：Artist\nBGM：Artist - Song','Song','description'],
 ['【风格】长视频标题','BGM：Song-A——Band','Song-A','description'],
 ['合集标题','BGM：第一首\nBGM：第二首','合集标题','fallback'],
 ['普通标题','BGM：https://example.com/song','普通标题','fallback'],
 ['原始标题','','原始标题','fallback']
]){const result=extract(title,desc);assert.equal(result.name,want);assert.equal(result.source,source);}
const dir=path.resolve('output/qa/song-title'),favorite=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/favorites.json')));
for(const f of ['config.html','config-page.js','background-editor.css','engine/background.js','engine/background-editor.js','styles.css','engine/config.js','engine/music-library.js','engine/song-title.js']){fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.copyFileSync(f,path.join(dir,f));}
const defaults=JSON.parse(fs.readFileSync('config.default.json'));
fs.writeFileSync(path.join(dir,'engine/local-config.js'),`window.qaSaved=${JSON.stringify(defaults)};window.qaFavorites=${JSON.stringify(favorite)};window.LocalConfig={read:async()=>structuredClone(qaSaved),call:async(route,method,body)=>{if(route==='bilibili/favorites')return structuredClone(qaFavorites);if(route==='bilibili/cover')return {};if(route==='config'&&method==='POST'){qaSaved=JSON.parse(body);return {ok:true};}if(route==='display')return {settings:qaSaved.settings};throw Error('Unexpected route '+route);}};`);
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
const page=await browser.newPage({viewport:{width:1150,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.join(dir,'config.html')).href);await page.waitForFunction(()=>document.querySelector('#config-message').textContent.includes('已连接'));
await page.locator('#tab-import').click();await page.locator('#import-bilibili').click();await page.locator('#bili-url').fill('https://space.bilibili.com/1/favlist?fid=1');await page.locator('#parse-bili').click();await page.waitForSelector('.bili-result');assert.equal(await page.locator('.bili-result').count(),favorite.items.length);
const rows=page.locator('.bili-result'),first=rows.nth(0);assert.equal(await first.locator('strong').textContent(),'测试歌曲一');assert.equal(await first.getByRole('switch').getAttribute('aria-checked'),'true');
const selection=await page.locator('#bili-selection').textContent();await first.getByRole('switch').click();assert.equal(await first.locator('strong').textContent(),favorite.items[0].title);assert.equal(await page.locator('#bili-selection').textContent(),selection);assert.ok(await first.locator('input').isChecked());
// Selection rebuild must preserve each video's naming mode.
await page.locator('#bili-select-all').uncheck();assert.equal(await rows.nth(0).getByRole('switch').getAttribute('aria-checked'),'false');for(let i=0;i<3;i++)await rows.nth(i).locator('input').check();
await rows.nth(1).getByRole('switch').focus();await page.keyboard.press('Space');assert.equal(await rows.nth(1).getByRole('switch').getAttribute('aria-checked'),'false');await page.keyboard.press('Space');assert.equal(await rows.nth(1).getByRole('switch').getAttribute('aria-checked'),'true');
await page.screenshot({path:path.join(dir,'import-desktop.png')});await page.setViewportSize({width:540,height:900});await page.screenshot({path:path.join(dir,'import-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1150,height:950});
await page.locator('#add-bili').click();await page.locator('#tab-music').click();assert.deepEqual(await page.locator('.track-title-editor').evaluateAll(es=>es.map(e=>e.value)),[favorite.items[0].title,'Example Two','Example Three']);
await page.locator('#save-config').click();await page.waitForFunction(()=>qaSaved.playlists.length===1);let tracks=await page.evaluate(()=>qaSaved.playlists[0].tracks);assert.equal(tracks[0].titleMode,'video');assert.equal(tracks[0].songTitle,'测试歌曲一');assert.equal(tracks[1].titleMode,'song');assert.equal(tracks[2].originalTitle,favorite.items[2].title);
await page.locator('#cancel-config').click();await page.waitForFunction(()=>!document.querySelector('#save-config').disabled);assert.equal(await page.locator('.track-title-editor').nth(2).inputValue(),'Example Three');
await page.locator('.track-title-editor').nth(1).fill('手动改名');await page.locator('#save-config').click();await page.waitForFunction(()=>qaSaved.playlists[0].tracks[1].title==='手动改名');assert.deepEqual(errors,[]);
console.log('PASS: extraction priority/fallback/ambiguity; synthetic favorites; independent switch and selection; keyboard/mobile; mixed naming imports; JSON round trip; manual rename retained');
fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,items:favorite.items.length,extracted:favorite.items.map(v=>({originalTitle:v.title,...extract(v.title,v.description)}))},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
