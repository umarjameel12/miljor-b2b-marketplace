'use strict';
const defaults=Object.freeze({locale:'en',optional_email:true,optional_sms:false,muted_info:false,
  quiet_start:null,quiet_end:null,timezone_offset_minutes:300});
const time=value=>value==null?null:String(value).slice(0,5);
function normalizePreferences(row={}){
  return {locale:row.locale==='ur'?'ur':'en',optional_email:row.optional_email==null?true:Boolean(Number(row.optional_email)),
    optional_sms:Boolean(Number(row.optional_sms)),muted_info:Boolean(Number(row.muted_info)),
    quiet_start:time(row.quiet_start),quiet_end:time(row.quiet_end),
    timezone_offset_minutes:Number.isInteger(Number(row.timezone_offset_minutes))&&row.timezone_offset_minutes!=null?Number(row.timezone_offset_minutes):300};
}
function validatePreferences(input,previous=defaults){
  const fail=()=>{throw Object.assign(Error('Invalid notification preferences'),{statusCode:400});};
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(defaults,key)))fail();
  if(!['en','ur'].includes(input.locale)||typeof input.optional_email!=='boolean'||typeof input.optional_sms!=='boolean')fail();
  const result={...normalizePreferences(previous),...input};
  if(typeof result.muted_info!=='boolean'||!Number.isInteger(result.timezone_offset_minutes)||Math.abs(result.timezone_offset_minutes)>840)fail();
  if(![result.quiet_start,result.quiet_end].every(value=>value===null||typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)))fail();
  if((result.quiet_start===null)!==(result.quiet_end===null)||result.quiet_start!==null&&result.quiet_start===result.quiet_end)fail();
  return result;
}
function quietUntil(preference,now){
  if(!preference.quiet_start||!preference.quiet_end)return null;
  const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
  const local=(now.getUTCHours()*60+now.getUTCMinutes()+preference.timezone_offset_minutes+2880)%1440;
  const start=minutes(preference.quiet_start),end=minutes(preference.quiet_end);
  const quiet=start<end?local>=start&&local<end:local>=start||local<end;
  if(!quiet)return null;
  const result=new Date(now.getTime()+((end-local+1440)%1440)*60000);
  result.setUTCSeconds(0,0);return result;
}
function deliveryPlan({projection,preference={},now=new Date(),occurredAt=now,digestEnabled=false}){
  const prefs=normalizePreferences(preference),mandatory=Boolean(projection.mandatory);
  const routine=projection.routine===true;
  const muted=routine&&prefs.muted_info&&!mandatory;
  const configured=Number(projection.transient?process.env.NOTIFICATION_TRANSIENT_RETENTION_HOURS||24:process.env.NOTIFICATION_ROUTINE_RETENTION_HOURS||168);
  const hours=Number.isInteger(configured)&&configured>0&&configured<=8760?configured:projection.transient?24:168;
  const visibleUntil=(routine||projection.transient)&&!mandatory?new Date(new Date(occurredAt).getTime()+hours*3600000):null;
  const stale=Boolean(visibleUntil&&visibleUntil<=now);
  return {muted,stale,sendEmail:!muted&&!stale&&(mandatory||prefs.optional_email)&&Boolean(projection.email),
    digest:!muted&&!stale&&!mandatory&&routine&&prefs.optional_email&&digestEnabled,
    notBefore:mandatory?null:quietUntil(prefs,now),
    visibleUntil};
}
module.exports={defaults,normalizePreferences,validatePreferences,quietUntil,deliveryPlan};
