'use strict';
const {normalizeRequestDraft}=require('./procurementRequestPolicy');
const fail=()=>Object.assign(Error('Provide all existing cycle items, an exact revision and a supported delivery preference; prices and specifications cannot be changed here.'),{code:'INVALID_CYCLE_INPUTS',statusCode:400});
function normalizeCycleInputs(baseline,input){
 if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['expected_revision','items','delivery_preference'].includes(key))||
  !Number.isSafeInteger(input.expected_revision)||input.expected_revision<0||!Array.isArray(input.items)||input.items.length!==baseline.length)throw fail();
 const quantities=new Map();
 for(const item of input.items){
  if(!item||Object.keys(item).some(key=>!['template_item_id','quantity'].includes(key))||
   !/^[1-9]\d*$/.test(String(item.template_item_id))||!Number.isSafeInteger(Number(item.template_item_id))||quantities.has(Number(item.template_item_id)))throw fail();
  quantities.set(Number(item.template_item_id),item.quantity);
 }
 const normalized=normalizeRequestDraft({delivery_area:'Cycle request',items:baseline.map(item=>{
  const itemId=Number(item.template_item_id??item.id);if(!quantities.has(itemId))throw fail();
  return {...item,quantity:quantities.get(itemId),allow_substitutions:item.allow_substitutions===true||item.allow_substitutions===1};
 })}).items.map((item,index)=>({...item,template_item_id:Number(baseline[index].template_item_id??baseline[index].id),line_number:Number(baseline[index].line_number)}));
 let preference=null;
 if(input.delivery_preference!=null){
  const value=input.delivery_preference;
  if(Array.isArray(value)||Object.keys(value).some(key=>!['mode','address_id'].includes(key))||!['STANDARD_CLUSTERED','EXPRESS','PICKUP'].includes(value.mode))throw fail();
  if(value.mode==='PICKUP'){
   if(value.address_id!=null)throw fail();
   preference={mode:'PICKUP',address_id:null};
  }else{
   if(!/^[1-9]\d*$/.test(String(value.address_id))||!Number.isSafeInteger(Number(value.address_id)))throw fail();
   preference={mode:value.mode,address_id:Number(value.address_id)};
  }
 }
 return {expected_revision:input.expected_revision,items:normalized,delivery_preference:preference};
}
module.exports={normalizeCycleInputs};
