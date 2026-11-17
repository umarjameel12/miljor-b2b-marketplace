'use strict';
const exact=require('./exactDecimal');
const fail=(code,message)=>Object.assign(Error(message),{code,statusCode:409});
const canonical=(value,scale=4)=>{const result=exact.toCanonical(value,scale);if(!exact.exactDecimalGte(result,'0',scale))throw fail('INVALID_DELIVERY_AMOUNT','Nonnegative exact amounts required');return result;};
const int=value=>BigInt(canonical(value).replace('.',''));
const fixed=value=>(value/10000n).toString()+'.'+(value%10000n).toString().padStart(4,'0');
function normalizeWindow(value){
 const m=/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(value||'');
 if(!m)throw fail('INVALID_DELIVERY_WINDOW','Use HH:mm-HH:mm Pakistan time');
 const start=Number(m[1])*60+Number(m[2]),end=Number(m[3])*60+Number(m[4]);
 if(start>=end)throw fail('INVALID_DELIVERY_WINDOW','End must follow start on the same day');
 return {start,end};
}
const time=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
function measureLines(lines){
 if(!Array.isArray(lines)||!lines.length)throw fail('ROUTE_PHYSICAL_DATA_REQUIRED','Immutable order lines required');
 let weight=0n,volume=0n;
 for(const line of lines){
  const purchase=String(line.purchasing_unit).toLowerCase(),loose=['kg','g','l','ml'].includes(purchase);
  const unit=loose?purchase:String(line.pack_unit||'').toLowerCase();
  if(!['kg','g','l','ml'].includes(unit))throw fail('ROUTE_PHYSICAL_UNIT_UNKNOWN','Known mass or volume units required; unknown packs cannot be grouped');
  const quantity=int(line.quantity),pack=loose?10000n:int(line.pack_size);
  if(quantity<=0n||pack<=0n)throw fail('ROUTE_PHYSICAL_DATA_REQUIRED','Positive physical quantities required');
  const denominator=10000n*(['g','ml'].includes(unit)?1000n:1n);
  const measured=(quantity*pack+denominator-1n)/denominator; // conservative ceiling
  if(['kg','g'].includes(unit))weight+=measured;else volume+=measured;
 }
 return {weight_kg:fixed(weight),volume_l:fixed(volume)};
}
function compatibleRun(choices,measures,input){
 if(!Array.isArray(choices)||!choices.length||choices.length>50||choices.length!==measures.length)throw fail('INVALID_ROUTE_STOPS','Choose 1–50 distinct paid orders');
 const first=choices[0],day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
 if(!['STANDARD_CLUSTERED','EXPRESS','INDIVIDUAL'].includes(first.mode)||(['EXPRESS','INDIVIDUAL'].includes(first.mode)&&choices.length!==1))throw fail('ROUTE_MODE_INCOMPATIBLE','Express and individual deliveries have independent runs');
 let start=0,end=1440;
 const orders=new Set();
 for(const choice of choices){
  if(orders.has(Number(choice.order_id)))throw fail('DUPLICATE_ROUTE_ORDER','Order can appear only once');orders.add(Number(choice.order_id));
  if(Number(choice.supplier_id)!==Number(first.supplier_id)||Number(choice.cluster_id)!==Number(first.cluster_id)||day(choice.delivery_day)!==day(first.delivery_day)||choice.mode!==first.mode||choice.handling_class!==first.handling_class||!['AMBIENT','CHILLED','FROZEN'].includes(choice.handling_class))throw fail('ROUTE_INCOMPATIBLE','Supplier, verified cluster, day, mode and handling must match');
  const window=normalizeWindow(choice.delivery_window);start=Math.max(start,window.start);end=Math.min(end,window.end);
 }
 if(start>=end)throw fail('ROUTE_WINDOWS_INCOMPATIBLE','Buyer-approved delivery windows do not intersect');
 const weight=exact.exactDecimalSum(measures.map(value=>value.weight_kg),4),volume=exact.exactDecimalSum(measures.map(value=>value.volume_l),4);
 if(!exact.exactDecimalGte(canonical(input.max_weight_kg),weight,4)||!exact.exactDecimalGte(canonical(input.max_volume_l),volume,4))throw fail('ROUTE_CAPACITY_EXCEEDED','Declared vehicle mass/volume capacity exceeded');
 const fees=exact.exactDecimalSum(choices.map(choice=>canonical(choice.locked_delivery_fee,2)),2),cost=canonical(input.planned_cost_pkr,2);
 if(!exact.exactDecimalGte(fees,cost,2)||(choices.length>1&&exact.exactDecimalEquals(fees,cost,2)))throw fail('ROUTE_COST_NOT_CHEAPER','A clustered run requires a lower comparable supplier-declared cost; locked buyer fees cannot be increased');
 const cents=BigInt(cost.replace('.','')),n=BigInt(choices.length);
 const allocations=[...choices].sort((a,b)=>Number(a.order_id)-Number(b.order_id)).map((choice,index)=>{const share=cents/n+(BigInt(index)<cents%n?1n:0n);return {order_id:Number(choice.order_id),cost_share:(share/100n).toString()+'.'+(share%100n).toString().padStart(2,'0')};});
 return {delivery_window:time(start)+'-'+time(end),weight_kg:weight,volume_l:volume,locked_fee_total:fees,planned_cost_pkr:cost,cost_basis:'SUPPLIER_DECLARED_NOT_PROVIDER_EXPENSE',allocations,buyer_savings:null,locked_buyer_fees_unchanged:true};
}
module.exports={compatibleRun,measureLines,normalizeWindow};
