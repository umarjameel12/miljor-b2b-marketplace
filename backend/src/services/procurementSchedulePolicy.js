'use strict';

// B6-L/M deterministic Pakistani-local recurring procurement schedule policy.
// Planning only. Cycle creation NEVER authorizes Safepay or reserves inventory.
// Pakistan observes UTC+05:00 without daylight-saving clock switches.
const error=(code,message)=>Object.assign(new Error(message),{code,statusCode:400});
const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const TIME=/^(\d{2}):(\d{2})$/;
function parseDay(raw){
  if(typeof raw!=='string')throw error('INVALID_SCHEDULE_DATE','Use YYYY-MM-DD dates.');
  const m=DATE.exec(raw);
  if(!m)throw error('INVALID_SCHEDULE_DATE','Use YYYY-MM-DD dates.');
  const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const ms=Date.UTC(y,month-1,day);
  const d=new Date(ms);
  if(y<2000||y>2100||d.getUTCFullYear()!==y||
     d.getUTCMonth()!==month-1||d.getUTCDate()!==day)
    throw error('INVALID_SCHEDULE_DATE','This Gregorian calendar date does not exist.');
  return ms;
}
function localTime(raw){
  if(typeof raw!=='string')throw error('INVALID_SCHEDULE_TIME','Specify HH:mm in Pakistan time.');
  const m=TIME.exec(raw);
  if(!m || Number(m[1])>23 || Number(m[2])>59)
    throw error('INVALID_SCHEDULE_TIME','Specify a valid HH:mm Pakistan time.');
  return {hour:Number(m[1]),minute:Number(m[2])};
}
function normalizeSchedule(value){
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw error('INVALID_SCHEDULE','Schedule must be an object.');
  const cadence=value.cadence;
  if(!['WEEKLY','MONTHLY'].includes(cadence))
    throw error('INVALID_CADENCE','Choose WEEKLY or MONTHLY.');
  if(value.timezone_name!==undefined&&value.timezone_name!=='Asia/Karachi')
    throw error('INVALID_TIMEZONE','Lahore launch schedules must use Asia/Karachi.');
  if(value.payment_policy!==undefined&&value.payment_policy!=='EXPLICIT_PER_CYCLE')
    throw error('UNAUTHORIZED_RECURRING_CHARGE','Only explicit per-cycle buyer payment approval is supported.');
  if(value.pricing_policy!==undefined&&value.pricing_policy!=='REQUOTE_EACH_CYCLE')
    throw error('RECURRING_PRICE_POLICY_NOT_APPROVED','Each cycle requires an authoritative new supplier quote.');
  const start=parseDay(value.starts_on);
  const end=value.ends_on==null?null:parseDay(value.ends_on);
  if(end!==null&&end<start)throw error('INVALID_SCHEDULE_RANGE','Schedule end precedes start.');
  const time=localTime(value.local_run_time);
  let weekday=null,monthDay=null,endPolicy='LAST_DAY';
  if(cadence==='WEEKLY'){
    weekday=Number(value.weekday_number);
    if(!Number.isInteger(weekday)||weekday<0||weekday>6||value.month_day!=null)
      throw error('INVALID_WEEKDAY','WEEKLY requires weekday 0=Sunday through 6=Saturday.');
  }else{
    monthDay=Number(value.month_day);
    if(!Number.isInteger(monthDay)||monthDay<1||monthDay>31||value.weekday_number!=null)
      throw error('INVALID_MONTH_DAY','MONTHLY requires a calendar day 1–31.');
    endPolicy=value.month_end_policy||'LAST_DAY';
    if(!['LAST_DAY','SKIP_MONTH'].includes(endPolicy))
      throw error('INVALID_MONTH_END_POLICY','Choose LAST_DAY or SKIP_MONTH.');
  }
  return {
    cadence,weekday_number:weekday,month_day:monthDay,
    month_end_policy:endPolicy,
    timezone_name:'Asia/Karachi',
    local_run_time:String(time.hour).padStart(2,'0')+':'+String(time.minute).padStart(2,'0'),
    starts_on:value.starts_on,ends_on:value.ends_on||null,
    payment_policy:'EXPLICIT_PER_CYCLE',pricing_policy:'REQUOTE_EACH_CYCLE'
  };
}
function calendarDay(year,month,requested,policy){
  const max=new Date(Date.UTC(year,month,0)).getUTCDate();
  if(requested>max&&policy==='SKIP_MONTH')return null;
  return Math.min(max,requested);
}
/**
 * Returns the next up-to-limit independent scheduled occurrence descriptors.
 * `from` is ISO UTC instant. Each key is Pakistan local calendar YYYY-MM-DD.
 * Calling twice with same contract and from produces same keys and UTC instants.
 */
function nextCycles(schedule,{from=new Date().toISOString(),limit=6}={}){
  const normalized=normalizeSchedule(schedule);
  if(!Number.isInteger(limit)||limit<1||limit>24)throw error('INVALID_CYCLE_LIMIT','Limit 1–24 cycles.');
  const instant=Date.parse(from);
  if(!Number.isFinite(instant)||typeof from!=='string'||!/(Z|[+-]\d\d:\d\d)$/i.test(from))
    throw error('INVALID_CYCLE_ANCHOR','Cycle search needs an offset-aware timestamp.');
  const start=parseDay(normalized.starts_on);
  const end=normalized.ends_on==null?null:parseDay(normalized.ends_on);
  // Iterate local calendar dates in UTC arithmetic, then subtract the fixed
  // Asia/Karachi offset to derive the authoritative cycle UTC timestamp.
  const anchorLocalDate=Math.floor((instant+5*3600000)/86400000)*86400000;
  const first=Math.max(start,anchorLocalDate);
  const [hour,minute]=normalized.local_run_time.split(':').map(Number);
  const output=[];
  // Covers 24 months (or 731 days) max; avoids unbounded background loops.
  for(let offset=0;offset<731&&output.length<limit;offset++){
    const dayMs=first+offset*86400000;
    if(end!==null&&dayMs>end)break;
    const calendar=new Date(dayMs);
    let matches=false;
    if(normalized.cadence==='WEEKLY'){
      matches=calendar.getUTCDay()===normalized.weekday_number;
    }else{
      const year=calendar.getUTCFullYear(),month=calendar.getUTCMonth()+1;
      matches=calendar.getUTCDate()===
        calendarDay(year,month,normalized.month_day,normalized.month_end_policy);
    }
    if(!matches)continue;
    const dueMs=dayMs+(hour*60+minute)*60000-5*3600000;
    if(dueMs<instant)continue;
    const key=calendar.toISOString().slice(0,10);
    output.push({cycle_key:key,local_date:key,timezone_name:'Asia/Karachi',
      local_run_time:normalized.local_run_time,due_at_utc:new Date(dueMs).toISOString(),
      requires_explicit_buyer_payment:true,creates_payable_order:false});
  }
  return output;
}
module.exports={normalizeSchedule,nextCycles};
