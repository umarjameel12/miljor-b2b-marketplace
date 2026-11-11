'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
function startServer(handler){
 return new Promise(resolve=>{
  const server=http.createServer(handler);
  server.listen(0,'127.0.0.1',()=>resolve({server,port:server.address().port}));
 });
}
async function main(){
 const api=await startServer((req,res)=>{res.statusCode=(req.url==='/health/ready'&&process.env.DEMO_TEST_FAIL_READY==='1')?503:200;res.end('{"ok":true}')});
 const ui=await startServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body>MilJor</body></html>')});
 const env={...process.env,DB_NAME:'miljor_test_db',DEMO_BACKEND_URL:'http://127.0.0.1:'+api.port,DEMO_FRONTEND_URL:'http://127.0.0.1:'+ui.port};
 try {
  // spawnSync would block HTTP servers in the parent event loop; spawn asynchronously instead.
  const {spawn}=require('node:child_process');
  const run=(more)=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[path.join(__dirname,'../scripts/demo_preflight.js')],{cwd:path.join(__dirname,'../..'),env:{...env,...more}});
   let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
   child.on('error',reject);child.on('close',code=>resolve({code,out}));
  });
  const ok=await run({});
  assert.equal(ok.code,0,ok.out);
  assert.match(ok.out,/PASS 12\/12/);
  const protectedDb=await run({DB_NAME:'miljor_db'});
  assert.notEqual(protectedDb.code,0);
  assert.match(protectedDb.out,/Approved demo database: Set DB_NAME explicitly/);
  const down=await run({DEMO_BACKEND_URL:'http:\/\/127.0.0.1:1'});
  assert.notEqual(down.code,0);
  assert.match(down.out,/Express liveness/);
  const remote=await run({DEMO_FRONTEND_URL:'https:\/\/example.com'});
  assert.notEqual(remote.code,0);
  assert.match(remote.out,/Remote URL requires/);
  console.log('PASS: localhost successful, protected DB rejected, backend failure fails closed, external URL rejected');
 } finally {await Promise.all([new Promise(r=>api.server.close(r)),new Promise(r=>ui.server.close(r))]);}
}
main().catch(err=>{console.error(err);process.exitCode=1});
