
window.qaDisk={"version":1,"settings":{"infoScale":1,"playerScale":1,"listScale":1,"playerStyle":"line","volume":0.65,"waveGain":1,"repeat":"all","waveMode":"stereo","audioDisplay":"waveform"},"playlists":[],"activePlaylistId":null,"trackId":null,"collapsed":{"all":false,"current":false,"saved":false}};window.qaCalls=0;window.qaOffline=false;
window.qaPCM={available:true,left:Array(512).fill(.25),right:Array(512).fill(0)};
window.LocalConfig={read:async()=>structuredClone(qaDisk),call:async(route,method,body)=>{
 if(route==='audio-device')return {available:true,name:'耳机',isHeadphones:true};
 if(route==='audio-wave'){qaCalls++;if(qaOffline)throw Error('offline');return qaPCM;}
 if(route==='config'&&method==='POST'){qaDisk=JSON.parse(body);window.qaSaved=qaDisk;return {ok:true};}
 if(route==='display')return {settings:qaDisk.settings};return {};
}};