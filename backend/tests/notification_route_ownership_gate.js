'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const routes=[];
const original=Module._load;
let call;
Module._load=function(request,parent,isMain){
  if(request==='express')return {Router:()=>({use(){},get(){},put(){},patch(path,handler){routes.push({path,handler});}})};
  if(request==='../../services/notificationService')return {markAsRead:async(userId,noticeId)=>{call={userId,noticeId};return userId===7&&noticeId==='19';}};
  if(request==='../../middlewares/authGuard')return {protect(){}};
  return original.call(this,request,parent,isMain);
};
require('../src/routes/v1/notificationRoutes');
Module._load=original;
(async()=>{
  let result;
  const response={status(){return this;},json(value){result=value;}};
  await routes.find(route=>route.path==='/:id/read').handler({user:{id:7},params:{id:'19'}},response);
  assert.deepEqual(call,{userId:7,noticeId:'19'});
  assert.equal(result.data.updated,true);
  console.log('PASS notification route passes authenticated owner before target notification ID');
})().catch(error=>{console.error(error);process.exitCode=1;});
