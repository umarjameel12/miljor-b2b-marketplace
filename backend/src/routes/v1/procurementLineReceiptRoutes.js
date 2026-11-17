'use strict';
// Mount alongside procurementRoutes at /api/v1. No server changes in this slice.
const router=require('express').Router();
const {protect,authorizeStrict}=require('../../middlewares/authGuard');
const idempotencyGuard=require('../../middlewares/idempotencyGuard');
const service=require('../../services/procurementLineReceiptService');
const respond=(action)=>async(req,res)=>{
 try{res.json({success:true,data:await action(req)});}
 catch(error){res.status(error.statusCode||500).json({success:false,error:{
  code:error.statusCode?error.code:'LINE_RECEIPT_FAILED',
  message:error.statusCode?error.message:'Unable to process line receipt'}});}
};
router.get('/procurement/orders/:orderId/line-receipts',protect,authorizeStrict('BUYER'),
 respond(req=>service.getBuyerReceipts({orderId:req.params.orderId,actor:req.user})));
router.post('/procurement/orders/:orderId/line-receipts',protect,authorizeStrict('BUYER'),idempotencyGuard.required,
 respond(req=>{
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(key=>!['lines','fee_policy'].includes(key)))
   throw Object.assign(new Error('Provide only line receipt evidence.'),{code:'INVALID_RECEIPT_LINES',statusCode:400});
  return service.recordBuyerReceipt({orderId:req.params.orderId,actor:req.user,lines:req.body.lines,feePolicy:req.body.fee_policy,
   idempotencyKey:req.get('X-Idempotency-Key')});
 }));
module.exports=router;
