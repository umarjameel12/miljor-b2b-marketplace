'use strict';
// Factory keeps auth, DB configuration and server startup outside injected tests.
// Mount at /api/v1/ucp/recovery; no supplier or buyer can execute admin recovery.
function createRecoveryRouter(dependencies={}){
  const express=dependencies.express||require('express');
  const service=dependencies.service||require('../../services/ucpRegularRecoveryService');
  const auth=dependencies.auth||require('../../middlewares/authGuard');
  const guard=dependencies.idempotencyGuard||require('../../middlewares/idempotencyGuard');
  const router=express.Router();
  const handle=work=>async(req,res)=>{
    try{return res.json({success:true,data:await work(req)});}
    catch(error){const status=error.statusCode||500;return res.status(status).json({success:false,
      error:{code:status<500?error.code||'INVALID_RECOVERY_REQUEST':'RECOVERY_FAILED',
        message:status<500?error.code||'Invalid recovery request':'Recovery could not be completed. Review the exception queue.'}});}
  };
  const queryNumber=(value,fallback)=>{
    if(value===undefined)return fallback;
    if(typeof value!=='string'||!/^\d+$/.test(value))throw Object.assign(Error('INVALID_RECOVERY_QUERY'),{code:'INVALID_RECOVERY_QUERY',statusCode:400});
    return Number(value);
  };
  router.use(auth.protect);
  router.get('/exceptions',auth.authorizeStrict('ADMIN','SUPER_ADMIN'),handle(req=>service.listExceptions({actor:req.user,
    afterId:queryNumber(req.query.after_id,0),limit:queryNumber(req.query.limit,50)})));
  router.get('/pools/:poolId',auth.authorizeStrict('BUYER','SUPPLIER','ADMIN','SUPER_ADMIN'),
    handle(req=>service.getPoolRecovery({actor:req.user,poolId:req.params.poolId})));
  router.post('/pools/:poolId/recover',auth.authorizeStrict('ADMIN','SUPER_ADMIN'),guard.required,
    handle(req=>service.recover({actor:req.user,poolId:req.params.poolId,idempotencyKey:req.idempotency.key,input:req.body})));
  router.post('/pools/:poolId/proposals/:proposalId/consent',auth.authorizeStrict('BUYER'),guard.required,
    handle(req=>service.consent({actor:req.user,poolId:req.params.poolId,proposalId:req.params.proposalId,
      idempotencyKey:req.idempotency.key,input:req.body})));
  return router;
}
module.exports={createRecoveryRouter};
