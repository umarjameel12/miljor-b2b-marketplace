'use strict';
const router=require('express').Router();
const {protect,authorizeStrict}=require('../../middlewares/authGuard');
const reporting=require('../../services/procurementReportingService');

// Mount alongside procurementRoutes at /api/v1. Identity comes only from auth.
router.get('/procurement/reports/reliability',protect,authorizeStrict('BUYER','SUPPLIER'),async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    res.json({success:true,data:await reporting.getReport(req.user)});
  }catch(error){
    res.status(error.statusCode||500).json({success:false,error:{
      code:error.statusCode?error.code:'PROCUREMENT_REPORT_UNAVAILABLE',
      message:error.statusCode?error.message:'Unable to load procurement reporting.'}});
  }
});
module.exports=router;
