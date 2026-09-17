(function(){
  let connection=null, connecting=null;
  async function connect(){
    if(connection)return connection;
    if(connecting)return connecting;
    connecting=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='connection.js?t='+Date.now();
      script.onload=()=>{script.remove();connection=window.BlackVinylConnection;connection?resolve(connection):reject(Error('本机助手未启动。'));};
      script.onerror=()=>{script.remove();reject(Error('未找到本机助手连接文件。'));};document.head.append(script);
    });
    try{return await connecting;}finally{connecting=null;}
  }
  async function call(path,method='GET',body,extra={}){
    const c=await connect(), controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path==='music'||path==='background'||path.startsWith('bilibili/')?120000:3500);
    try{
      const response=await fetch(c.url+path,{method,body,signal:controller.signal,headers:{'X-BlackVinyl-Token':c.token,...extra},cache:'no-store'});
      if(!response.ok){const text=await response.text();let error=text;try{error=JSON.parse(text).error||text;}catch(_){}throw Error(error);}return await response.json();
    }catch(e){connection=null;throw e;}finally{clearTimeout(timer);}
  }
  async function read(){
    try{return await call('config');}catch(error){
      if(!document.getElementById('wallpaper'))throw error;
      return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='config-data.js?t='+Date.now();script.onload=()=>{script.remove();resolve(window.BlackVinylDiskConfig);};script.onerror=()=>{script.remove();reject(error);};document.head.append(script);});
    }
  }
  window.LocalConfig={call,read};
})();
