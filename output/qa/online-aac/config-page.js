(function(){'use strict';
const $=id=>document.getElementById(id),C=BlackVinylConfig;
const uid=()=>crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
const svg=name=>{const e=document.createElement('span');e.textContent='×';return e;};
const emptyRow=text=>{const e=document.createElement('div');e.className='empty-list';e.textContent=text;return e;};
function fillRange(input){input.style.setProperty('--fill',(input.value-input.min)/(input.max-input.min)*100+'%');}
function message(text,error=false){$('config-message').textContent=text;$('config-message').classList.toggle('error',error);}
function applyAppearance(){}
let draft=C.normalize(C.defaults),config=draft,editId=null,draftImported=false;
async function readConfig(){if(busy)return;lock(true);try{draft=C.normalize(await LocalConfig.read());config=draft;editId=draft.activePlaylistId;message('已连接当前壁纸文件夹。保存后壁纸自动更新。');}catch(e){message('首次使用请运行此壁纸文件夹中的“启用自动启动.cmd”；已启用时可运行 Start-Config.cmd 重试，然后点击“重新读取”。'+e.message,true);}finally{lock(false);renderEditor();renderDisplaySettings();}}
async function importAudio(files){
 if(!files.length||busy)return;lock(true);let added=0;const results=$('local-import-results');results.replaceChildren();
 try{const list=importDestination('我的歌单');for(const file of files){message('正在复制：'+file.name);const result=await LocalConfig.call('music','POST',file,{'X-Filename':encodeURIComponent(file.name)});list.tracks.push({id:uid(),title:file.name.replace(/\.[^.]+$/,''),filename:file.name,sourceType:'url',src:result.src,duration:0,artist:''});results.append(emptyRow('已导入 · '+file.name));added++;}message(`已导入 ${added} 首音乐，点击保存到壁纸后生效。`);}catch(e){message(`已导入 ${added} 首。`+e.message,true);}finally{lock(false);renderEditor();$('audio-files').value='';}
}
async function saveConfig(){if(busy)return;lock(true);try{const next=C.normalize(draft);await LocalConfig.call('config','POST',JSON.stringify(next));draft=next;config=next;message('已写入 config.json，壁纸将在约 2 秒内更新。');}catch(e){message('保存失败：'+e.message,true);}finally{lock(false);renderEditor();renderDisplaySettings();}}
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
    document.querySelectorAll('[data-setting]').forEach(input => { input.value = Math.round(draft.settings[input.dataset.setting] * 100); input.nextElementSibling.textContent = input.value + '%'; fillRange(input); });
  }
  function selectTab(name) {
    document.querySelectorAll('[data-tab]').forEach(tab => { const active = tab.dataset.tab === name; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    document.querySelectorAll('.tab-panel').forEach(panel => panel.hidden = panel.id !== 'panel-' + name);
  }
  function exportJSON() {
    const data = C.normalize(draft || config), blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'black-vinyl.config.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); message('已导出配置 JSON。音乐文件单独保存在本机。');
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
    document.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('input', () => { draft.settings[input.dataset.setting] = Number(input.value) / 100; input.nextElementSibling.textContent = input.value + '%'; fillRange(input); applyAppearance(draft.settings); }));
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
function renderBili(){coverObserver.disconnect();const root=$('bili-results');root.replaceChildren();if(!biliResult||!biliResult.items.length){root.append(emptyRow('收藏夹为空或没有可导入的视频。'));updateSelection();return;}
 for(const video of biliResult.items){const row=document.createElement('label');row.className='bili-result'+(video.available?'':' unavailable');
  const box=document.createElement('input');box.type='checkbox';box.checked=biliSelected.has(video.bvid);box.disabled=!video.available;box.setAttribute('aria-label','选择 '+video.title);box.addEventListener('change',()=>{box.checked?biliSelected.add(video.bvid):biliSelected.delete(video.bvid);updateSelection();});
  const cover=document.createElement('img');cover.alt='';if(/^https:\/\/i\d+\.hdslb\.com\//.test(video.cover)){cover.dataset.cover=video.cover;coverObserver.observe(cover);}
  const content=document.createElement('div'),title=document.createElement('strong'),description=document.createElement('p'),meta=document.createElement('small');title.textContent=video.title;description.textContent=video.description||'暂无简介';description.title=video.description||'';meta.textContent=video.available?`${video.artist} · ${Math.floor(video.duration/60)}:${String(video.duration%60).padStart(2,'0')} · ${video.bvid}`:'视频已失效或暂不支持导入';content.append(title,description,meta);row.append(box,cover,content);root.append(row);
 }updateSelection();}
async function parseBili(){if(busy)return;const url=$('bili-url').value.trim();try{const parsed=new URL(url);if(!['space.bilibili.com','www.bilibili.com'].includes(parsed.hostname)||!/^\d+$/.test(parsed.searchParams.get('fid')||''))throw Error();}catch(_){message('请粘贴带有 fid 编号的完整 B 站收藏夹链接。',true);return;}
 biliResult=null;biliSelected.clear();$('bili-results').replaceChildren(emptyRow('正在解析收藏夹，请稍候…'));$('bili-summary').textContent='正在解析…';updateSelection();lock(true);message('正在读取公开收藏夹…');
 try{biliResult=await LocalConfig.call('bilibili/favorites','POST',JSON.stringify({url}));for(const video of biliResult.items)if(video.available)biliSelected.add(video.bvid);$('bili-summary').textContent=`${biliResult.title} · ${biliResult.items.length} 个视频`+(biliResult.truncated?'（部分结果）':'');message('解析完成。勾选视频后点击“加入歌单”。');}catch(e){$('bili-summary').textContent='解析失败';message('收藏夹解析失败：'+e.message,true);}finally{lock(false);renderBili();}
}
function addBili(){if(!biliResult||!biliSelected.size||busy)return;const list=importDestination(biliResult.title||'B 站收藏夹');let added=0;
 for(const video of biliResult.items){if(!video.available||!biliSelected.has(video.bvid)||list.tracks.some(x=>x.sourceType==='bilibili'&&x.bvid===video.bvid&&String(x.cid)===String(video.cid)))continue;list.tracks.push({id:uid(),sourceType:'bilibili',bvid:video.bvid,cid:String(video.cid),title:video.title,artist:video.artist,description:video.description,cover:video.cover,duration:video.duration,filename:''});added++;}
 renderEditor();message(`已将 ${added} 首加入“${list.name}”，重复视频已跳过。点击“保存到壁纸”后生效。`);
}
function selectImport(name){document.querySelectorAll('[data-import]').forEach(button=>{const on=button.dataset.import===name;button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1;});$('import-local-panel').hidden=name!=='local';$('import-bilibili-panel').hidden=name!=='bilibili';}
document.querySelectorAll('[data-import]').forEach(button=>{button.addEventListener('click',()=>selectImport(button.dataset.import));button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=button.dataset.import==='local'?'bilibili':'local';selectImport(next);$('import-'+next).focus();}});});
$('parse-bili').addEventListener('click',parseBili);$('bili-url').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();parseBili();}});$('add-bili').addEventListener('click',addBili);
$('bili-select-all').addEventListener('change',()=>{biliSelected=new Set($('bili-select-all').checked?biliResult.items.filter(x=>x.available).map(x=>x.bvid):[]);renderBili();});
$('save-config').addEventListener('click',saveConfig);$('cancel-config').addEventListener('click',readConfig);selectTab('music');renderEditor();renderDisplaySettings();readConfig();})();
