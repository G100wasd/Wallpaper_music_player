(function(){'use strict';
  window.BackgroundEditor=class{
    constructor(getDraft,message){
      this.getDraft=getDraft;this.message=message;this.image=null;this.source='';this.serial=0;this.picking=false;this.pending=null;this.uploading=false;
      const $=id=>document.getElementById(id);this.$=$;
      $('panel-background').innerHTML=`
        <div class="background-editor">
          <div class="background-controls">
            <h2>底色与图片</h2>
            <div class="bg-color-row"><label for="bg-color">背景颜色</label><input id="bg-color" type="color" value="#000000"><input id="bg-hex" aria-label="背景颜色十六进制值" type="text" value="#000000" maxlength="7"></div>
            <div class="bg-actions"><label class="outline-button file-button" tabindex="0">上传图片<input id="bg-upload" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="bg-remove" class="text-button" disabled>移除图片</button></div>
            <p class="import-hint">支持 JPG、PNG、WebP。图片保留在壁纸文件夹；下方调整只改变显示方式。</p>
            <div class="bg-actions"><button id="bg-pick" class="outline-button small" aria-pressed="false" disabled>从图片取色</button><button id="bg-crop-reset" class="text-button" disabled>还原裁切</button></div>
            <p id="bg-image-help" class="import-hint">上传图片后，可在原图上拖出裁切框。</p>
            <canvas id="bg-source" width="480" height="300" aria-label="原图裁切和取色区域"></canvas>
            <div class="bg-crop-fields" aria-label="精确裁切（百分比）">${[['x','左边'],['y','上边'],['width','宽度'],['height','高度']].map(([k,label])=>`<label>${label} %<input type="number" data-crop="${k}" min="${k==='x'||k==='y'?0:1}" max="100" step="1" disabled></label>`).join('')}</div>
            <h2 class="bg-position-title">位置与缩放</h2>
            ${[['x','水平位置',-100,200,50],['y','垂直位置',-100,200,50],['scale','图片缩放',10,400,100]].map(([k,label,min,max,value])=>`<label class="bg-range-label" for="bg-${k}">${label}<output id="bg-${k}-value">${value}%</output></label><input id="bg-${k}" type="range" min="${min}" max="${max}" value="${value}" step="1" disabled>`).join('')}
            <button id="bg-position-reset" class="text-button" disabled>图片居中 · 重置缩放</button>
          </div>
          <div class="background-live">
            <div class="bg-preview-toolbar"><span>实时预览</span><select id="bg-orientation" aria-label="预览屏幕比例"><option value="portrait">竖屏 10:16</option><option value="landscape">横屏 16:9</option><option value="screen">当前屏幕比例</option></select></div>
            <div id="bg-preview-stage"><iframe id="bg-preview" title="壁纸背景实时预览" tabindex="-1"></iframe><div id="bg-preview-drag" aria-label="拖动图片位置"></div></div>
            <p class="import-hint">拖动预览图可移动背景，滚轮可缩放。上方留白时，把图片向下移动即可。</p>
            <p class="import-hint">文字与线条按各区域背景明暗自动切换为黑色或白色；图片复杂处添加细阴影帮助辨认。点击“保存到壁纸”后应用。</p>
            <p id="bg-status" class="import-hint" role="status"></p>
          </div>
        </div>`;
      this.canvas=$('bg-source');this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.raw=document.createElement('canvas');this.rawctx=this.raw.getContext('2d',{willReadFrequently:true});this.frame=$('bg-preview');
      this.frame.addEventListener('load',()=>this.send());
      window.addEventListener('message',e=>{if(e.source===this.frame.contentWindow&&e.data&&e.data.type==='black-vinyl-background-ready')this.send();});
      $('bg-color').addEventListener('input',()=>{this.bg.color=$('bg-color').value;this.changed();});
      $('bg-hex').addEventListener('change',()=>{const value=$('bg-hex').value;if(/^#[0-9a-f]{6}$/i.test(value)){this.bg.color=value;this.changed();}else{this.message('颜色请填写 #RRGGBB，例如 #ffffff。',true);this.syncControls();}});
      $('bg-upload').addEventListener('change',e=>this.upload(e.target.files[0]));
      $('bg-remove').addEventListener('click',()=>{this.serial++;this.pending=null;this.bg.image='';this.image=null;this.source='';this.picking=false;this.changed();this.drawSource();});
      $('bg-pick').addEventListener('click',()=>{this.picking=!this.picking;this.syncControls();});
      $('bg-crop-reset').addEventListener('click',()=>{this.bg.crop={x:0,y:0,width:1,height:1};this.changed();});
      for(const k of ['x','y','scale'])$('bg-'+k).addEventListener('input',()=>{this.bg[k]=Number($('bg-'+k).value)/(k==='scale'?100:1);this.changed();});
      document.querySelectorAll('[data-crop]').forEach(input=>input.addEventListener('change',()=>{this.bg.crop[input.dataset.crop]=Number(input.value)/100;this.getDraft().background=BlackVinylConfig.normalize(this.getDraft()).background;this.changed();}));
      $('bg-position-reset').addEventListener('click',()=>{Object.assign(this.bg,{x:50,y:50,scale:1});this.changed();});
      $('bg-orientation').addEventListener('change',()=>this.resize());
      this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe($('bg-preview-stage'));
      this.bindPointer();this.syncControls();this.drawSource();
    }
    get bg(){return this.getDraft().background;}
    status(text){this.$('bg-status').textContent=text;}
    async refresh(){
      this.pending=null;this.picking=false;const source=this.bg.image,serial=++this.serial;
      this.source=source;this.image=null;this.syncControls();this.drawSource();this.send();
      try{const image=await WallpaperBackground.load(source);if(serial!==this.serial)return;this.setImage(image);this.status('');this.send();}
      catch(e){if(serial===this.serial)this.status(e.message);}
    }
    async upload(file){
      if(!file)return;if(this.uploading)return;
      this.uploading=true;const serial=++this.serial;
      try{
        if(file.size>24*1024*1024)throw Error('请选择小于 24 MB 的图片。');
        if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 图片。');
        const url=URL.createObjectURL(file),image=new Image();
        try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('图片无法解码，请换一张图片。'));image.src=url;});}finally{URL.revokeObjectURL(url);}
        const scale=Math.min(1,3072/Math.max(image.naturalWidth,image.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        const data=canvas.toDataURL('image/png');const blob=await(await fetch(data)).blob();
        if(blob.size>16*1024*1024)throw Error('处理后的图片超过 16 MB，请先缩小图片。');
        if(serial!==this.serial)return;
        // Stage locally first. No helper/network call or config mutation until Save.
        this.pending={blob,data};this.source=data;this.bg.image='';Object.assign(this.bg,{x:50,y:50,scale:1,crop:{x:0,y:0,width:1,height:1}});
        const decoded=await WallpaperBackground.load(data);if(serial!==this.serial)return;
        this.setImage(decoded);this.changed();this.status('图片已载入预览，保存后写入壁纸。'+(scale<1?'长边已缩小至 3072 像素。':''));
      }catch(e){this.message(e.message,true);}finally{this.uploading=false;this.$('bg-upload').value='';}
    }
    async commit(){
      if(this.uploading)throw Error('图片正在处理，请稍后保存。');
      if(!this.pending)return;
      const pending=this.pending;
      try{const result=await LocalConfig.call('background','POST',pending.blob);
        if(!/^backgrounds\/[a-f0-9]{32}\.png$/.test(result.src||''))throw Error('助手返回的图片路径无效。');
        if(this.pending===pending){this.bg.image=result.src;this.source=result.src;this.pending=null;}
      }catch(e){throw Error('背景图片保存失败，请重启新版 Start-Config.cmd 后重试。'+e.message);}
    }
    setImage(image){
      this.image=image;
      if(image){this.raw.width=image.naturalWidth;this.raw.height=image.naturalHeight;this.rawctx.drawImage(image,0,0);}
      this.syncControls();this.drawSource();
    }
    syncControls(){
      const $=this.$,bg=this.bg,has=!!this.image;
      $('bg-color').value=bg.color;$('bg-hex').value=bg.color;
      for(const k of ['x','y','scale']){const value=Math.round(bg[k]*(k==='scale'?100:1));$('bg-'+k).value=value;$('bg-'+k).disabled=!has;$('bg-'+k+'-value').textContent=value+'%';$('bg-'+k).style.setProperty('--fill',((value-Number($('bg-'+k).min))/(Number($('bg-'+k).max)-Number($('bg-'+k).min))*100)+'%');}
      for(const id of ['bg-remove','bg-pick','bg-crop-reset','bg-position-reset'])$(id).disabled=!has;
      document.querySelectorAll('[data-crop]').forEach(input=>{input.disabled=!has;input.value=Math.round(bg.crop[input.dataset.crop]*100);});
      $('bg-pick').setAttribute('aria-pressed',String(this.picking));$('bg-pick').textContent=this.picking?'点击原图取色…':'从图片取色';
      $('bg-image-help').textContent=this.picking?'点击下方原图，取该点的颜色作为背景底色。':'在下方原图上拖出裁切框；也可填写裁切百分比。';
      this.canvas.style.cursor=has?'crosshair':'default';$('bg-preview-drag').style.cursor=has?'grab':'default';
    }
    drawSource(){
      const c=this.canvas,ctx=this.ctx;ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#181818';ctx.fillRect(0,0,c.width,c.height);
      if(!this.image){ctx.fillStyle='#999';ctx.textAlign='center';ctx.font='18px Microsoft YaHei';ctx.fillText('上传图片后可裁切、取色',c.width/2,c.height/2);return;}
      const i=this.image,s=Math.min(c.width/i.naturalWidth,c.height/i.naturalHeight),w=i.naturalWidth*s,h=i.naturalHeight*s,x=(c.width-w)/2,y=(c.height-h)/2;this.imageRect={x,y,w,h};
      ctx.drawImage(i,x,y,w,h);const crop=this.bg.crop,cx=x+crop.x*w,cy=y+crop.y*h,cw=crop.width*w,ch=crop.height*h;
      ctx.fillStyle='rgba(0,0,0,.48)';ctx.beginPath();ctx.rect(x,y,w,h);ctx.rect(cx,cy,cw,ch);ctx.fill('evenodd');ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.strokeRect(cx,cy,cw,ch);ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(cx,cy,cw,ch);
    }
    point(e){const b=this.canvas.getBoundingClientRect(),r=this.imageRect,x=(e.clientX-b.left)*this.canvas.width/b.width,y=(e.clientY-b.top)*this.canvas.height/b.height;return{x:Math.max(0,Math.min(1,(x-r.x)/r.w)),y:Math.max(0,Math.min(1,(y-r.y)/r.h)),inside:x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h};}
    bindPointer(){
      let start=null;
      this.canvas.addEventListener('pointerdown',e=>{if(!this.image||this.$('bg-upload').disabled)return;const p=this.point(e);if(!p.inside)return;
        if(this.picking){const d=this.rawctx.getImageData(Math.min(this.raw.width-1,Math.floor(p.x*this.raw.width)),Math.min(this.raw.height-1,Math.floor(p.y*this.raw.height)),1,1).data;
          const base=this.bg.color.match(/[0-9a-f]{2}/ig).map(v=>parseInt(v,16));this.bg.color='#'+[0,1,2].map(k=>Math.round(d[k]*d[3]/255+base[k]*(1-d[3]/255)).toString(16).padStart(2,'0')).join('');this.picking=false;this.changed();return;}
        start=p;this.canvas.setPointerCapture(e.pointerId);
      });
      this.canvas.addEventListener('pointermove',e=>{if(!start)return;const p=this.point(e),w=Math.abs(p.x-start.x),h=Math.abs(p.y-start.y);if(w<.01||h<.01)return;this.bg.crop={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:w,height:h};this.changed();});
      for(const name of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(name,()=>start=null);
      const overlay=this.$('bg-preview-drag');let drag=null;
      overlay.addEventListener('pointerdown',e=>{if(!this.image||this.$('bg-upload').disabled)return;drag={x:e.clientX,y:e.clientY,bx:this.bg.x,by:this.bg.y};overlay.setPointerCapture(e.pointerId);});
      overlay.addEventListener('pointermove',e=>{if(!drag)return;const r=overlay.getBoundingClientRect();this.bg.x=BlackVinylConfig.clamp(drag.bx+(e.clientX-drag.x)/r.width*100,-100,200,50);this.bg.y=BlackVinylConfig.clamp(drag.by+(e.clientY-drag.y)/r.height*100,-100,200,50);this.changed();});
      for(const name of ['pointerup','pointercancel','lostpointercapture'])overlay.addEventListener(name,()=>drag=null);
      overlay.addEventListener('wheel',e=>{if(!this.image||this.$('bg-upload').disabled)return;e.preventDefault();this.bg.scale=BlackVinylConfig.clamp(this.bg.scale*(e.deltaY<0?1.05:1/1.05),.1,4,1);this.changed();},{passive:false});
    }
    changed(){this.syncControls();this.drawSource();this.send();}
    activate(){if(!this.frame.getAttribute('src'))this.frame.src='index.html?preview=background';this.resize();this.send();}
    resize(){
      const stage=this.$('bg-preview-stage'),available=stage.clientWidth;if(!available)return;
      const type=this.$('bg-orientation').value;let w=type==='portrait'?1600:1920,h=type==='portrait'?2560:1080;
      if(type==='screen'){w=screen.width;h=screen.height;}
      const ratio=Math.min(available/w,(innerWidth<=800?520:640)/h);stage.style.height=Math.round(h*ratio)+'px';stage.style.setProperty('--preview-width',Math.round(w*ratio)+'px');
      Object.assign(this.frame.style,{width:w+'px',height:h+'px',transform:`scale(${ratio})`});this.send();
    }
    send(){if(this.frame.contentWindow)this.frame.contentWindow.postMessage({type:'black-vinyl-background-preview',config:this.getDraft(),imageData:this.pending?this.pending.data:undefined},'*');}
  };
})();
