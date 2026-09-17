(function(){'use strict';
  // Companion scripts carry image bytes as data URLs: file:// canvases stay readable,
  // including offline Wallpaper Engine sessions, without a running HTTP service.
  const cache=new Map();
  function load(source){
    if(!source)return Promise.resolve(null);
    if(cache.has(source))return cache.get(source);
    const pending=new Promise((resolve,reject)=>{
      const decode=url=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('背景图片无法读取'));img.src=url;};
      if(/^data:image\/png;base64,/.test(source)){decode(source);return;}
      if(!/^backgrounds\/[a-f0-9]{32}\.png$/.test(source)){reject(Error('背景图片路径无效'));return;}
      const script=document.createElement('script');script.src=source+'.js';
      script.onload=()=>{script.remove();const data=(window.BlackVinylBackgroundImages||{})[source];if(data)decode(data);else reject(Error('背景图片数据缺失'));};
      script.onerror=()=>{script.remove();reject(Error('背景图片文件缺失，请重新上传'));};document.head.append(script);
    });
    cache.set(source,pending);pending.catch(()=>cache.delete(source));
    // Keep only a few decoded uploads in memory while editing.
    if(cache.size>4)cache.delete(cache.keys().next().value);
    return pending;
  }
  function paint(ctx,w,h,bg,img){
    ctx.clearRect(0,0,w,h);ctx.fillStyle=bg.color;ctx.fillRect(0,0,w,h);
    if(!img)return;
    const c=bg.crop,sw=img.naturalWidth*c.width,sh=img.naturalHeight*c.height;
    const factor=Math.min(w/sw,h/sh)*bg.scale,dw=sw*factor,dh=sh*factor;
    ctx.drawImage(img,img.naturalWidth*c.x,img.naturalHeight*c.y,sw,sh,w*bg.x/100-dw/2,h*bg.y/100-dh/2,dw,dh);
  }
  const linear=v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);};
  class Background{
    constructor(root){
      this.root=root;this.canvas=document.createElement('canvas');this.canvas.id='wallpaper-background';this.canvas.setAttribute('aria-hidden','true');root.prepend(this.canvas);
      this.ctx=this.canvas.getContext('2d');this.sample=document.createElement('canvas');this.sc=this.sample.getContext('2d',{willReadFrequently:true});this.serial=0;this.bg=BlackVinylConfig.clone(BlackVinylConfig.defaults.background);this.img=null;
    }
    async set(bg,override){
      this.bg=bg;const source=override||bg.image;
      if(source===this.source){this.render();return;}
      const serial=++this.serial;
      this.source=source;this.img=null;this.render();
      try{const img=await load(source);if(serial!==this.serial)return;this.img=img;this.root.dataset.backgroundError='';this.render();}
      catch(e){if(serial!==this.serial)return;this.root.dataset.backgroundError=e.message;this.render();}
    }
    render(){
      const w=this.root.clientWidth,h=this.root.clientHeight,ratio=Math.min(1,2560/Math.max(w,h));
      this.canvas.width=Math.max(1,Math.round(w*ratio));this.canvas.height=Math.max(1,Math.round(h*ratio));paint(this.ctx,this.canvas.width,this.canvas.height,this.bg,this.img);
      const s=192/Math.max(w,h);this.sample.width=Math.max(1,Math.round(w*s));this.sample.height=Math.max(1,Math.round(h*s));paint(this.sc,this.sample.width,this.sample.height,this.bg,this.img);this.adapt();
    }
    adapt(){
      const rootRect=this.root.getBoundingClientRect(),sx=this.sample.width/rootRect.width,sy=this.sample.height/rootRect.height;
      const targets=['#information','#turntable','.track-caption','.progress','.transport','.volume-row','#playlist-region','#utility'];
      for(const selector of targets){
        const el=this.root.querySelector(selector);if(!el)continue;const r=el.getBoundingClientRect();
        const x=Math.max(0,Math.min(this.sample.width-1,Math.floor((r.left-rootRect.left)*sx))),y=Math.max(0,Math.min(this.sample.height-1,Math.floor((r.top-rootRect.top)*sy)));
        const w=Math.max(1,Math.min(this.sample.width-x,Math.ceil(r.width*sx))),h=Math.max(1,Math.min(this.sample.height-y,Math.ceil(r.height*sy)));
        const data=this.sc.getImageData(x,y,w,h).data;let light=0,dark=0;
        for(let i=0;i<data.length;i+=4){const lum=.2126*linear(data[i])+.7152*linear(data[i+1])+.0722*linear(data[i+2]);light+=Math.log(1.05/(lum+.05));dark+=Math.log((lum+.05)/.05);}
        el.dataset.ink=dark>light?'dark':'light';
        el.style.filter=(dark>light?'invert(1) ':'')+(this.img?'drop-shadow(0 0 1px #000)':'');
      }
    }
  }
  window.WallpaperBackground={load,paint,Background};
})();
