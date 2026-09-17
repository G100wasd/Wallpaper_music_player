(function(){'use strict';
const $=id=>document.getElementById(id),C=BlackVinylConfig;
const uid=()=>crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
const svg=name=>{const e=document.createElement('span');e.textContent='×';return e;};
const emptyRow=text=>{const e=document.createElement('div');e.className='empty-list';e.textContent=text;return e;};
function fillRange(input){input.style.setProperty('--fill',(input.value-input.min)/(input.max-input.min)*100+'%');}
function message(text,error=false){$('config-message').textContent=text;$('config-message').classList.toggle('error',error);}
function applyAppearance(){backgroundEditor.refresh();}
let draft=C.normalize(C.defaults),config=draft,editId=null,draftImported=false;
const backgroundEditor=new BackgroundEditor(()=>draft,message);
const displayKeys=['infoScale','playerScale','listScale','waveGain'];
let displayPending={},displayTimer,displaySaving=null,displayPolling=false;
function displayMessage(text,error=false){const node=$('display-sync-status');node.textContent=text;node.classList.toggle('error',error);}
function mergeDisplay(settings){for(const key of displayKeys){if(Number.isFinite(settings[key])&&!Object.hasOwn(displayPending,key))draft.settings[key]=settings[key];}renderDisplaySettings();}
function queueDisplay(key,value){displayPending[key]=value;clearTimeout(displayTimer);displayMessage('正在同步显示设置…');displayTimer=setTimeout(()=>flushDisplay().catch(()=>{}),250);}
async function flushDisplay(){
 clearTimeout(displayTimer);
 if(displaySaving){await displaySaving;if(Object.keys(displayPending).length)return flushDisplay();return;}
 if(!Object.keys(displayPending).length)return;
 displaySaving=(async()=>{
  while(Object.keys(displayPending).length){
   const patch=displayPending;displayPending={};
   try{const result=await LocalConfig.call('display','POST',JSON.stringify(patch));mergeDisplay(result.settings);displayMessage(result.hostUpdated?'显示设置已应用到壁纸。Wallpaper Engine 面板滑块不会反向更新。':'显示设置已保存；当前未找到正在运行的对应壁纸。');}
   catch(e){displayPending={...patch,...displayPending};displayMessage('同步失败，请确认本机助手正在运行。'+e.message,true);throw e;}
  }
 })();
 try{await displaySaving;}finally{displaySaving=null;}
}
async function pollDisplay(){
 if(busy||draftImported||displaySaving||displayPolling||Object.keys(displayPending).length)return;
 displayPolling=true;
 try{const result=await LocalConfig.call('display');if(!busy&&!draftImported&&!displaySaving&&!Object.keys(displayPending).length)mergeDisplay(result.settings);}
 catch(e){displayMessage('显示设置同步暂不可用，请确认本机助手正在运行。',true);}
 finally{displayPolling=false;}
}
let audioDevicePolling=false;
async function pollAudioDevice(){
 if(audioDevicePolling)return;audioDevicePolling=true;
 try{const d=await LocalConfig.call('audio-device');$('audio-device-status').textContent=d.available?'当前默认输出：'+d.name+' · '+(d.isHeadphones?'识别为耳机，自动模式使用左右声道':'自动模式使用单区域'):'未检测到默认输出设备，自动模式暂用单区域。';}
 catch(_){$('audio-device-status').textContent='设备识别暂不可用，自动模式暂用单区域。请确认已重启新版本机助手。';}
 finally{audioDevicePolling=false;}
}
async function readConfig(){if(busy)return;lock(true);try{await flushDisplay();draft=C.normalize(await LocalConfig.read());draftImported=false;config=draft;editId=draft.activePlaylistId;message('已连接当前壁纸文件夹。保存后壁纸自动更新。');}catch(e){message('首次使用请运行此壁纸文件夹中的“启用自动启动.cmd”；已启用时可运行 Start-Config.cmd 重试，然后点击“重新读取”。'+e.message,true);}finally{lock(false);renderEditor();renderDisplaySettings();backgroundEditor.refresh();}}
async function importAudio(files){
 if(!files.length||busy)return;lock(true);let added=0;const results=$('local-import-results');results.replaceChildren();
 try{const list=importDestination('我的歌单');for(const file of files){message('正在复制：'+file.name);const result=await LocalConfig.call('music','POST',file,{'X-Filename':encodeURIComponent(file.name)});list.tracks.push({id:uid(),title:file.name.replace(/\.[^.]+$/,''),filename:file.name,sourceType:'url',src:result.src,duration:0,artist:''});results.append(emptyRow('已导入 · '+file.name));added++;}message(`已导入 ${added} 首音乐，点击保存到壁纸后生效。`);}catch(e){message(`已导入 ${added} 首。`+e.message,true);}finally{lock(false);renderEditor();$('audio-files').value='';}
}
async function saveConfig(){if(busy)return;lock(true);try{
 if(draftImported)for(const key of displayKeys)displayPending[key]=draft.settings[key];
 await flushDisplay();await backgroundEditor.commit();const next=C.normalize(draft);await LocalConfig.call('config','POST',JSON.stringify(next));draft=next;config=next;draftImported=false;
 mergeDisplay((await LocalConfig.call('display')).settings);message('歌单、背景与配置已保存，壁纸将在约 2 秒内更新。');backgroundEditor.send();
 }catch(e){message('保存失败：'+e.message,true);}finally{lock(false);renderEditor();renderDisplaySettings();}}
  function editedList(create = false) {
    let list = draft.playlists.find(item => item.id === editId);
    if (!list && create) { list = { id: uid(), name: '我的歌单', tracks: [] }; draft.playlists.push(list); editId = list.id; if (!draft.activePlaylistId) draft.activePlaylistId = list.id; }
    return list;
  }
  function renderEditor() {
    const destination=$('import-target'),prior=destination.value;destination.replaceChildren();
    destination.add(new Option('新建歌单',''));
    draft.playlists.forEach(list=>destination.add(new Option(list.name,list.id)));
    destination.value=draft.playlists.some(list=>list.id===prior)?prior:(editId||'');
    const select = $('edit-playlist'); select.replaceChildren();
    if (!draft.playlists.length) { const option = document.createElement('option'); option.textContent = '暂无歌单'; option.value = ''; select.append(option); }
    draft.playlists.forEach(list => { const option = document.createElement('option'); option.value = list.id; option.textContent = list.name; select.append(option); });
    const list = editedList(); select.value = list ? list.id : '';
    $('playlist-name').value = list ? list.name : ''; $('playlist-name').disabled = !list; $('delete-playlist').disabled = !list;
    $('edit-tracks').replaceChildren();
    if (!list || !list.tracks.length) $('edit-tracks').append(emptyRow('导入音乐后，歌曲会出现在这里。'));
    else list.tracks.forEach((track, index) => {
      const row = document.createElement('div'); row.className = 'edit-track';
      const number = document.createElement('span'); number.className = 'track-number'; number.textContent = String(index + 1).padStart(2, '0');
      const title = document.createElement('input');title.type='text';title.className='track-title-editor';title.value=track.title;title.maxLength=180;title.setAttribute('aria-label','歌曲名称 '+(index+1));title.addEventListener('input',()=>{track.title=title.value.trim()||'未命名音乐';});
      const badge=document.createElement('span');badge.className='source-badge';badge.textContent=track.sourceType==='bilibili'?'B 站':'本地 / 链接';
      const up=document.createElement('button'),down=document.createElement('button');
      for(const [button,delta,label] of [[up,-1,'上移'],[down,1,'下移']]){button.className='reorder-track';button.textContent=delta<0?'↑':'↓';button.setAttribute('aria-label',label+' '+track.title);button.disabled=index+delta<0||index+delta>=list.tracks.length;button.addEventListener('click',()=>{[list.tracks[index],list.tracks[index+delta]]=[list.tracks[index+delta],list.tracks[index]];renderEditor();});}
      const remove = document.createElement('button'); remove.className = 'icon-button remove-track'; remove.setAttribute('aria-label', '移除 ' + track.title); remove.append(svg('close'));
      remove.addEventListener('click', () => { list.tracks.splice(index, 1); renderEditor(); });
      row.append(number, title, badge, up, down, remove); $('edit-tracks').append(row);
    });
    $('repeat-mode').value = draft.settings.repeat;
  }
  function renderDisplaySettings() {
    const waveform = draft.settings.audioDisplay === 'waveform';
    $('setting-audioDisplay').setAttribute('aria-checked', String(waveform));
    $('setting-audioDisplay').textContent = waveform ? '波形' : '音量';
    $('setting-waveMode').value = draft.settings.waveMode;
    document.querySelectorAll('[data-setting]').forEach(input => { input.value = Math.round(draft.settings[input.dataset.setting] * 100); input.nextElementSibling.textContent = input.value + '%'; fillRange(input); });
  }
  function selectTab(name) {
    $('config-dialog').classList.toggle('background-active',name==='background');
    document.querySelectorAll('[data-tab]').forEach(tab => { const active = tab.dataset.tab === name; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    document.querySelectorAll('.tab-panel').forEach(panel => panel.hidden = panel.id !== 'panel-' + name);
    if(name==='background')backgroundEditor.activate();
  }
  function exportJSON() {
    const data = C.normalize(draft || config), blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'black-vinyl.config.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); message('已导出配置 JSON。音乐与背景图片单独保存在本机，迁移时请一起复制。');
  }
    document.querySelectorAll('[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
        event.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')];
        const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : tabs.length-1)) % tabs.length]; selectTab(next.dataset.tab); next.focus();
      });
    });
    $('edit-playlist').addEventListener('change', () => { editId = $('edit-playlist').value; renderEditor(); });
    $('new-playlist').addEventListener('click', () => {
      const list = { id: uid(), name: '新歌单', tracks: [] }; draft.playlists.push(list); editId = list.id;
      if (!draft.activePlaylistId) draft.activePlaylistId = list.id; renderEditor(); $('playlist-name').focus(); $('playlist-name').select();
    });
    $('playlist-name').addEventListener('input', () => { const list = editedList(); if (list) { list.name = $('playlist-name').value || '未命名歌单'; const option = [...$('edit-playlist').options].find(item => item.value === list.id); if (option) option.textContent = list.name; } });
    $('delete-playlist').addEventListener('click', () => { draft.playlists = draft.playlists.filter(list => list.id !== editId); if (draft.activePlaylistId === editId) draft.activePlaylistId = (draft.playlists[0] || {}).id || null; editId = (draft.playlists[0] || {}).id || null; renderEditor(); });
    $('audio-files').addEventListener('change', event => importAudio(Array.from(event.target.files)));
    document.querySelectorAll('.file-button').forEach(label => label.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); label.querySelector('input').click(); } }));
    $('add-source').addEventListener('click', () => {
      const src = $('source-url').value.trim();
      try {
        if (!C.safeSource(src)) throw new Error('请填写有效的音频链接或本地文件路径。'); MusicLibrary.safeSource(src);
        const list = importDestination('我的歌单'); let filename = src.split(/[\\/]/).pop().split('?')[0]; try { filename = decodeURIComponent(filename); } catch (_) {}
        list.tracks.push({ id: uid(), title: $('source-title').value.trim() || filename || '未命名音乐', artist: '', filename, duration: 0, sourceType: 'url', src });
        $('source-url').value = ''; $('source-title').value = ''; renderEditor(); message('音频地址已加入，保存后生效。');
      } catch (error) { message(error.message, true); }
    });
    $('repeat-mode').addEventListener('change', () => draft.settings.repeat = $('repeat-mode').value);
    $('setting-waveMode').addEventListener('change', () => { draft.settings.waveMode = $('setting-waveMode').value; message('音频显示方式已修改，点击“保存到壁纸”后生效。'); });
    $('setting-audioDisplay').addEventListener('click', () => { draft.settings.audioDisplay = draft.settings.audioDisplay === 'waveform' ? 'volume' : 'waveform'; renderDisplaySettings(); message('显示类型已修改，点击“保存到壁纸”后生效。'); });
    document.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('input', () => { draft.settings[input.dataset.setting] = Number(input.value) / 100; input.nextElementSibling.textContent = input.value + '%'; fillRange(input); if(!draftImported)queueDisplay(input.dataset.setting,draft.settings[input.dataset.setting]); }));
    $('export-json').addEventListener('click', exportJSON);
    $('import-json').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error('配置文件过大，请选择小于 5 MB 的 JSON。');
        const next = C.normalize(JSON.parse(await file.text())); if (!draft) return;
        draft = next; draftImported = true; editId = next.activePlaylistId || (next.playlists[0] || {}).id || null;
        renderEditor(); renderDisplaySettings(); applyAppearance(draft.settings); message('配置已读取。点击“保存到壁纸”后生效。');
      } catch (error) { message(error instanceof SyntaxError ? 'JSON 格式不正确，请检查配置文件。' : error.message, true); }
      event.target.value = '';
    });

let busy=false, locked=[],biliResult=null,biliSelected=new Set();
const coverLoads=new Map();
const coverObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const image=entry.target;coverObserver.unobserve(image);const url=image.dataset.cover;if(!coverLoads.has(url)){if(coverLoads.size>80)coverLoads.delete(coverLoads.keys().next().value);coverLoads.set(url,LocalConfig.call('bilibili/cover','POST',JSON.stringify({url})));}coverLoads.get(url).then(result=>{if(/^data:image\/(webp|png|jpeg);base64,/.test(result.dataUrl))image.src=result.dataUrl;}).catch(()=>{image.alt='封面暂不可用';coverLoads.delete(url);});}},{root:$('bili-results'),rootMargin:'80px'});
function lock(value){busy=value;if(value){locked=[...document.querySelectorAll('button,input,select')].filter(e=>!e.hasAttribute('data-tab')).map(e=>[e,e.disabled]);locked.forEach(([e])=>e.disabled=true);}else{locked.forEach(([e,disabled])=>e.disabled=disabled);locked=[];}}
function importDestination(name){let list=draft.playlists.find(x=>x.id===$('import-target').value);if(!list){list={id:uid(),name,tracks:[]};draft.playlists.push(list);if(!draft.activePlaylistId)draft.activePlaylistId=list.id;}editId=list.id;return list;}
function updateSelection(){const available=biliResult?biliResult.items.filter(x=>x.available):[];$('bili-select-all').disabled=!available.length;$('bili-select-all').checked=available.length>0&&biliSelected.size===available.length;$('bili-select-all').indeterminate=biliSelected.size>0&&biliSelected.size<available.length;$('add-bili').disabled=!biliSelected.size;$('bili-selection').textContent=`已选择 ${biliSelected.size} 个视频`;}
function biliDisplayTitle(video){return video.titleMode==='video'?video.title:video.songTitle;}
function renderBili(){coverObserver.disconnect();const root=$('bili-results');root.replaceChildren();if(!biliResult||!biliResult.items.length){root.append(emptyRow('没有可导入的视频。'));updateSelection();return;}
 for(const video of biliResult.items){const row=document.createElement('div');row.className='bili-result'+(video.available?'':' unavailable');row.dataset.bvid=video.bvid;
  const box=document.createElement('input');box.type='checkbox';box.checked=biliSelected.has(video.bvid);box.disabled=!video.available;box.setAttribute('aria-label','选择 '+video.title);box.addEventListener('change',()=>{box.checked?biliSelected.add(video.bvid):biliSelected.delete(video.bvid);updateSelection();});
  const cover=document.createElement('img');cover.alt='';if(/^https:\/\/i\d+\.hdslb\.com\//.test(video.cover)){cover.dataset.cover=video.cover;coverObserver.observe(cover);}
  const content=document.createElement('div');content.className='bili-result-content';
  const title=document.createElement('strong'),description=document.createElement('p'),meta=document.createElement('small'),naming=document.createElement('small');
  description.textContent=video.description||'暂无简介';description.title=video.description||'';
  meta.textContent=video.available?video.artist+' · '+Math.floor(video.duration/60)+':'+String(video.duration%60).padStart(2,'0')+' · '+video.bvid+(video.page?' · P'+video.page+' '+(video.part||''):''):'视频已失效或暂不支持导入';
  naming.className='bili-name-source';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='bili-title-toggle';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','使用歌曲名称：'+video.title);
  const updateTitle=()=>{const song=video.titleMode==='song';title.textContent=biliDisplayTitle(video);title.title=title.textContent;toggle.setAttribute('aria-checked',String(song));toggle.textContent=song?'歌曲名称':'视频标题';naming.textContent=!song?'按视频标题导入':video.songTitleSource==='description'?'从简介提取 · 按歌名导入':video.songTitleSource==='title'?'从标题提取 · 按歌名导入':'未识别歌名 · 使用视频标题';};
  toggle.addEventListener('click',()=>{video.titleMode=video.titleMode==='song'?'video':'song';updateTitle();});updateTitle();
  content.append(title,description,meta,naming);row.append(box,cover,content,toggle);
  row.addEventListener('click',event=>{if(event.target===box||toggle.contains(event.target)||!video.available)return;box.click();});root.append(row);
 }updateSelection();}
async function parseBili(){
 if(busy)return;const url=$('bili-url').value.trim();let route;
 try{
  const parsed=new URL(url);
  if(!['http:','https:'].includes(parsed.protocol))throw Error();
  const video=['www.bilibili.com','bilibili.com','m.bilibili.com'].includes(parsed.hostname)&&/^\/video\/(BV[0-9a-zA-Z]{10}|av\d{1,20})\/?$/i.test(parsed.pathname);
  const favorites=['space.bilibili.com','www.bilibili.com'].includes(parsed.hostname)&&/^\d+$/.test(parsed.searchParams.get('fid')||'');
  if(video){const p=parsed.searchParams.get('p');if(p!==null&&(!/^\d+$/.test(p)||!Number.isSafeInteger(Number(p))||Number(p)<1))throw Error();route='bilibili/video';}
  else if(favorites)route='bilibili/favorites';else throw Error();
 }catch(_){message('请粘贴完整的 B 站视频链接（BV / av）或带 fid 的公开收藏夹链接；分 P 编号需为正整数。',true);return;}
 biliResult=null;biliSelected.clear();$('bili-results').replaceChildren(emptyRow('正在解析链接，请稍候…'));$('bili-summary').textContent='正在解析…';updateSelection();lock(true);message('正在读取 B 站视频信息…');
 try{biliResult=await LocalConfig.call(route,'POST',JSON.stringify({url}));for(const video of biliResult.items){const extracted=SongTitle.extract(video.title,video.description);video.songTitle=extracted.name;video.songTitleSource=extracted.source;video.titleMode='song';if(video.available)biliSelected.add(video.bvid);}$('bili-summary').textContent=`${biliResult.title} · ${biliResult.items.length} 个视频`+(biliResult.truncated?'（部分结果）':'');message('解析完成。默认使用提取的歌名；每条右侧可切换为视频标题，加入歌单时使用当前显示名称。');}
 catch(e){$('bili-summary').textContent='解析失败';message('B 站链接解析失败：'+e.message,true);}finally{lock(false);renderBili();}
}

function addBili(){if(!biliResult||!biliSelected.size||busy)return;const list=importDestination(biliResult.title||'B 站歌单');let added=0;
 for(const video of biliResult.items){if(!video.available||!biliSelected.has(video.bvid)||list.tracks.some(x=>x.sourceType==='bilibili'&&x.bvid===video.bvid&&String(x.cid)===String(video.cid)))continue;list.tracks.push({id:uid(),sourceType:'bilibili',bvid:video.bvid,cid:String(video.cid),title:biliDisplayTitle(video),originalTitle:video.title,songTitle:video.songTitle,titleMode:video.titleMode,artist:video.artist,description:video.description,cover:video.cover,duration:video.duration,filename:''});added++;}
 renderEditor();message(`已将 ${added} 首加入“${list.name}”，重复视频已跳过。点击“保存到壁纸”后生效。`);
}
function selectImport(name){document.querySelectorAll('[data-import]').forEach(button=>{const on=button.dataset.import===name;button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1;});$('import-local-panel').hidden=name!=='local';$('import-bilibili-panel').hidden=name!=='bilibili';}
document.querySelectorAll('[data-import]').forEach(button=>{button.addEventListener('click',()=>selectImport(button.dataset.import));button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=button.dataset.import==='local'?'bilibili':'local';selectImport(next);$('import-'+next).focus();}});});
$('parse-bili').addEventListener('click',parseBili);$('bili-url').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();parseBili();}});$('add-bili').addEventListener('click',addBili);
$('bili-select-all').addEventListener('change',()=>{biliSelected=new Set($('bili-select-all').checked?biliResult.items.filter(x=>x.available).map(x=>x.bvid):[]);renderBili();});
$('save-config').addEventListener('click',saveConfig);$('cancel-config').addEventListener('click',readConfig);selectTab('music');renderEditor();renderDisplaySettings();readConfig();setInterval(pollDisplay,1200);pollAudioDevice();setInterval(pollAudioDevice,2000);})();
