'use strict';
// B6-N: physical compatibility and opt-in member schedule qualification.
// Pure policy: no orders, allocation, payment or buyer contact details.
const exact=require('./exactDecimal');
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:400});
const positiveId=(v,label)=>{
 if(typeof v==='boolean'||v==null||!/^[1-9]\d*$/.test(String(v))||
    !Number.isSafeInteger(Number(v)))throw fail('INVALID_COHORT_ID',label+' must be positive.');
 return Number(v);
};
const normalizeUnit=x=>{
 const unit=String(x||'').trim().toLowerCase();
 if(!['kg','g','l','ml','bag','tin','carton','sack','bundle','pack'].includes(unit))
  throw fail('INVALID_COHORT_UNIT','Unsupported purchasing unit.');
 return unit;
};
const quantity=(value,unit)=>{
 try{
  const q=exact.toCanonical(value,4);
  if(!exact.exactDecimalGte(q,'0.0001',4)||q.split('.')[0].length>8)throw Error('range');
  if(['bag','tin','carton','sack','bundle','pack'].includes(unit)&&
      !/^\d+\.0000$/.test(q))throw Error('pack');
  return q;
 }catch{throw fail('INVALID_COHORT_QUANTITY','Quantities must be exact, positive, and packaged units whole.');}
};
const normRequirement=v=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
const isCompatibleSchedule=(a,b)=>{
 if(!a||!b)return false;
 const date=x=>x instanceof Date?x.toISOString().slice(0,10):String(x||'').slice(0,10);
 const time=x=>String(x||'').slice(0,5);
 return a.status==='ACTIVE'&&b.status==='ACTIVE'&&
  a.cadence===b.cadence&&
  a.timezone_name==='Asia/Karachi'&&b.timezone_name==='Asia/Karachi'&&
  time(a.local_run_time)===time(b.local_run_time)&&
  (a.cadence==='WEEKLY'
   ?Number(a.weekday_number)===Number(b.weekday_number)
   :Number(a.month_day)===Number(b.month_day)&&a.month_end_policy===b.month_end_policy)&&
  a.payment_policy==='EXPLICIT_PER_CYCLE'&&b.payment_policy==='EXPLICIT_PER_CYCLE'&&
  a.pricing_policy==='REQUOTE_EACH_CYCLE'&&b.pricing_policy==='REQUOTE_EACH_CYCLE'&&
  date(a.starts_on)<=date(b.ends_on||'9999-12-31')&&
  date(b.starts_on)<=date(a.ends_on||'9999-12-31');
};
const itemSignature=x=>[
 positiveId(x.family_id,'Family'),
 normalizeUnit(x.unit),
 normRequirement(x.requirements),
 Number(x.allow_substitutions)===1||x.allow_substitutions===true?'1':'0'
].join('|');
function previewRecurringCollective({organizerContract,members,minimumBuyers=2}){
 if(!organizerContract||organizerContract.status!=='ACTIVE')
  throw fail('ORGANIZER_CONTRACT_INACTIVE','Organizer recurring contract must be active.');
 if(!Number.isInteger(minimumBuyers)||minimumBuyers<2||minimumBuyers>1000)
  throw fail('INVALID_COHORT_MINIMUM','At least two independent businesses are required.');
 if(!Array.isArray(members)||members.length>1000)
  throw fail('INVALID_COHORT_MEMBERS','Membership snapshot must be an array.');
 const used=new Set(),productUnion=new Map(),buyers=[];
 for(const member of members){
  if(member.status!=='CONSENTED')continue;
  const buyer=positiveId(member.buyer_id,'Buyer');
  if(used.has(buyer))throw fail('DUPLICATE_COHORT_BUYER','Each business counted once.');
  used.add(buyer);
  if(!isCompatibleSchedule(organizerContract,member.contract))
   throw fail('INCOMPATIBLE_COHORT_SCHEDULE','Buyer contract schedule or payment policy differs.');
  if(member.cycle_status!=='SCHEDULED')
   continue; // skipped, paused and previous-cycle records never auto-contribute
  if(!Array.isArray(member.items)||!member.items.length||member.items.length>50)
   throw fail('INVALID_MEMBER_BASKET','Each consenting member needs 1–50 product lines.');
  const selected=new Set(),lines=[];
  for(const item of member.items){
   const signature=itemSignature(item);
   if(selected.has(signature))throw fail('DUPLICATE_COHORT_ITEM','Repeated family/unit/spec in one basket.');
   selected.add(signature);
   const unit=normalizeUnit(item.unit),q=quantity(item.quantity,unit);
   const family_id=positiveId(item.family_id,'Family');
   const base=productUnion.get(signature)||{
    family_id,unit,requirements:item.requirements||null,
    allow_substitutions:Number(item.allow_substitutions)===1||item.allow_substitutions===true,
    total_quantity:'0.0000',buyer_count:0
   };
   base.total_quantity=exact.exactDecimalSum([base.total_quantity,q],4);
   base.buyer_count++;
   productUnion.set(signature,base);
   lines.push({signature,quantity:q});
  }
  buyers.push({buyer_id:buyer,contract_id:positiveId(member.contract.id,'Contract'),
   lines,requires_cycle_join:true,payment_authorized:false});
 }
 if(buyers.length<minimumBuyers)
  throw fail('COHORT_BELOW_MINIMUM','Too few eligible buyers for this recurring cycle.');
 if(productUnion.size>50)
  throw fail('COHORT_TOO_MANY_PRODUCTS','Combined shopping list exceeds 50 lines.');
 return {qualifying_buyers:buyers.length,minimum_buyers:minimumBuyers,
  products:[...productUnion].map(([signature,value])=>({signature,...value})),
  buyers,creates_order:false,reserves_stock:false,
  charges_buyers:false,requires_new_cycle_consent:true};
}
module.exports={isCompatibleSchedule,itemSignature,previewRecurringCollective};
