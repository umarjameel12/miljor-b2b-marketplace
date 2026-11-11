'use strict';
// Public read-only buyer marketplace, without B6 RFQ/collective or payment actions.
const express=require('express');
const router=express.Router();
router.get('/pool-discovery',async(req,res)=>{
  try{
    const data=await require('../../services/unifiedPoolDiscoveryService').list(req.query||{});
    res.status(200).json({success:true,data});
  }catch(error){
    const status=error.statusCode||500;
    res.status(status).json({success:false,error:{
      code:status<500?error.code:'POOL_DISCOVERY_UNAVAILABLE',
      message:status<500?error.message:'Unable to load pools'
    }});
  }
});
module.exports=router;
