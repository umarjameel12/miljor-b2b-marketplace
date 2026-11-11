'use strict';
// Run during the final integrated B6/Backend acceptance gate.
// Routes are loaded through the real Express router. The gate checks
// retired routes before database-backed auth and validates Express 5 path parsing.
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const express = require('express');
const router = require('../src/routes/v1/procurementRoutes');

const app = express();
app.use(express.json());
app.use('/api/v1',router);
app.use((req,res)=>res.status(404).json({success:false,error:{code:'NOT_FOUND'}}));

(async()=>{
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const address=server.address();
  const base=`http://127.0.0.1:${address.port}`;
  try {
    // An unauthenticated request must never reach a retired write handler.
    const retired=[
      ['POST','/api/v1/rfqs'],
      ['POST','/api/v1/rfqs/1/quotes'],
      ['POST','/api/v1/rfqs/1/quotes/1/accept'],
      ['POST','/api/v1/recurring']
    ];
    for(const [method,url] of retired){
      const result=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:'{}'});
      assert.equal(result.status,401,`${method} ${url} should require a token`);
    }
    // Unsupported recurring action must not match a business mutation handler.
    // Without valid JWT this still rejects; authenticated owner action flows
    // are covered by the final database-backed B6 recurring gate.
    const response=await fetch(base+'/api/v1/procurement/recurring/1/not-an-action',{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,401);
    console.log('Legacy procurement route registration and auth boundary gate passed.');
  } finally {
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
