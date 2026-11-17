'use strict';
const express=require('express');
const router=express.Router();
const {protect,authorizeStrict}=require('../../middlewares/authGuard');
const evidence=require('../../services/procurementDeliveryEvidenceService');
const base='/procurement/orders/:orderId/evidence';
const privateHeaders=(req,res,next)=>{res.set('Cache-Control','private, no-store');next();};
const errorResponse=(res,error)=>res.status(error.statusCode||500).json({success:false,error:{
  code:error.statusCode?error.code:'DELIVERY_EVIDENCE_UNAVAILABLE',
  message:error.statusCode?error.message:'Delivery proof is unavailable.'}});

// Mount at /api/v1. A parent JSON parser must also allow the ~1.4 MB base64 body.
router.post(base,protect,authorizeStrict('BUYER','SUPPLIER'),privateHeaders,
  express.json({limit:1450000,strict:true}),async(req,res)=>{
    try{
      const result=await evidence.upload({actor:req.user,orderId:req.params.orderId,input:req.body,
        idempotencyKey:req.get('X-Idempotency-Key')});
      res.status(result.is_replay?200:201).json({success:true,data:result});
    }catch(error){errorResponse(res,error);}
  });
router.get(base,protect,authorizeStrict('BUYER','SUPPLIER'),privateHeaders,async(req,res)=>{
  try{res.json({success:true,data:{proofs:await evidence.list({actor:req.user,orderId:req.params.orderId})}});}
  catch(error){errorResponse(res,error);}
});
router.get(base+'/:evidenceId',protect,authorizeStrict('BUYER','SUPPLIER'),privateHeaders,async(req,res)=>{
  try{
    const proof=await evidence.download({actor:req.user,orderId:req.params.orderId,evidenceId:req.params.evidenceId});
    res.set({'Content-Type':proof.mime_type,'Content-Length':String(proof.content_bytes.length),
      'Content-Disposition':`attachment; filename="${proof.filename}"`,
      'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'});
    res.send(proof.content_bytes);
  }catch(error){errorResponse(res,error);}
});
router.use((error,req,res,next)=>{
  if(error.type==='entity.too.large')return res.status(413).json({success:false,error:{code:'EVIDENCE_TOO_LARGE',message:'Proof request is too large.'}});
  if(error.type==='entity.parse.failed')return res.status(400).json({success:false,error:{code:'INVALID_EVIDENCE_JSON',message:'Invalid proof JSON.'}});
  next(error);
});
module.exports=router;
