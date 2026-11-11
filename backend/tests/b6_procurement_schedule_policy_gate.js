'use strict';
const assert=require('node:assert/strict');
const {normalizeSchedule,nextCycles}=require('../src/services/procurementSchedulePolicy');
let total=0;const check=(name,condition)=>{assert.ok(condition,name);console.log('PASS '+(++total)+': '+name)};
const fails=(code,fn)=>assert.throws(fn,e=>e.code===code);
const weekly={cadence:'WEEKLY',weekday_number:1,local_run_time:'09:00',
  starts_on:'2026-11-01',timezone_name:'Asia/Karachi'};
const everyMonday=nextCycles(weekly,{from:'2026-11-08T00:00:00Z',limit:3});
check('Three Mondays generated',everyMonday.map(x=>x.local_date).join(',')===
'2026-11-09,2026-11-16,2026-11-23');
check('Pakistan 09:00 Monday is 04:00 UTC',
 everyMonday[0].due_at_utc==='2026-11-09T04:00:00.000Z');
check('Repeating schedule produces exact cycle keys',
 JSON.stringify(everyMonday)===JSON.stringify(nextCycles(weekly,
  {from:'2026-11-08T00:00:00Z',limit:3})));
const afterMonday=nextCycles(weekly,{from:'2026-11-09T05:00:00Z',limit:1});
check('Past current Monday not emitted',afterMonday[0].local_date==='2026-11-16');
const monthly={cadence:'MONTHLY',month_day:31,month_end_policy:'LAST_DAY',
  starts_on:'2026-01-01',local_run_time:'10:30'};
const months=nextCycles(monthly,{from:'2026-01-30T00:00:00Z',limit:3});
check('31st month end clamp in February',
 months.map(x=>x.local_date).join(',')==='2026-01-31,2026-02-28,2026-03-31');
const skip=nextCycles({...monthly,month_end_policy:'SKIP_MONTH'},
 {from:'2026-01-30T00:00:00Z',limit:3});
check('Monthly SKIP_MONTH omits February',
 skip.map(x=>x.local_date).join(',')==='2026-01-31,2026-03-31,2026-05-31');
const limited=nextCycles({...weekly,ends_on:'2026-11-16'},
 {from:'2026-11-01T00:00:00Z',limit:10});
check('End date bounds cycles',limited.length===3);
check('Cycle never preauthorizes charge',everyMonday.every(x=>
 x.requires_explicit_buyer_payment===true && x.creates_payable_order===false));
fails('UNAUTHORIZED_RECURRING_CHARGE',()=>normalizeSchedule({...weekly,
 payment_policy:'AUTOPAY'}));check('Autopay forbidden',true);
fails('RECURRING_PRICE_POLICY_NOT_APPROVED',()=>normalizeSchedule({...weekly,
 pricing_policy:'FIXED_WITHOUT_SUPPLIER_ACCEPTANCE'}));check('Unapproved price lock forbidden',true);
fails('INVALID_SCHEDULE_DATE',()=>normalizeSchedule({...weekly,
 starts_on:'2026-02-30'}));check('Impossible dates rejected',true);
fails('INVALID_WEEKDAY',()=>normalizeSchedule({...weekly,
 weekday_number:7}));check('Invalid weekday rejected',true);
fails('INVALID_MONTH_DAY',()=>normalizeSchedule({...monthly,
 month_day:32}));check('Invalid month-day rejected',true);
fails('INVALID_TIMEZONE',()=>normalizeSchedule({...weekly,
 timezone_name:'UTC'}));check('Unapproved timezone rejected',true);
fails('INVALID_SCHEDULE_RANGE',()=>normalizeSchedule({...weekly,
 ends_on:'2026-10-01'}));check('Reversed schedule rejected',true);
console.log('B6 RECURRING POLICY: '+total+'/'+total+' PASS (pure calendar only)');
