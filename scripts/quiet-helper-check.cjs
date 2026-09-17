const fs=require('fs'),assert=require('node:assert/strict'),vm=require('node:vm');
(async()=>{
 const state={window:{}};vm.runInNewContext(fs.readFileSync('connection.js','utf8'),state);
 const c=state.window.BlackVinylConnection;
 const call=async(path,method='GET')=>{const r=await fetch(c.url+path,{method,headers:{'X-BlackVinyl-Token':c.token}});assert.equal(r.status,200);return r.json();};
 const status=await call('status');assert.equal(status.quietStartup,true);
 assert.equal((await call('config')).version,1);
 // This exercises the real OS default-browser launch after quiet startup.
 assert.equal((await call('open','POST')).ok,true);
 assert.equal((await call('status')).pid,status.pid);
 const rejected=await fetch(c.url+'open',{method:'POST',headers:{'X-BlackVinyl-Token':'invalid'}});assert.equal(rejected.status,403);
 console.log('PASS quiet login mode; existing config readable; explicit open launches default browser; helper stays alive; invalid token rejected');
})().catch(error=>{console.error(error);process.exitCode=1;});
