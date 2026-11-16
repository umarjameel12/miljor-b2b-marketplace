'use strict';
// Presence-only audit. Never load the original environment into process.env.
const fs=require('node:fs');
const ORIGINAL_ENV='C:/Users/Umar Jameel/OneDrive - Higher Education Commission/Documents/MilJor Project/backend/.env';
const SAFEPAY_KEYS=Object.freeze(['SAFEPAY_ENV','SAFEPAY_PUBLIC_KEY','SAFEPAY_SECRET_KEY','SAFEPAY_WEBHOOK_SECRET']);
const SMTP_KEYS=Object.freeze(['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASS','EMAIL_FROM','MAIL_FROM_EMAIL','MAIL_FROM_NAME','TRANSACTIONAL_EMAIL_MODE','EMAIL_MODE','MAILTRAP_API_TOKEN','MAILTRAP_INBOX_ID']);
const USER_SMS_SCOPE=Object.freeze({status:'EXCLUDED_USER_WAIVED',reason:'Explicit user instruction: SMS is not used; do not do SMS. This is an audit scope exclusion, not a global application setting.'});
// Historical export retained. Presence audit includes optional/defaulted settings;
// MISSING is not itself a claim that every listed key is mandatory.
const REQUIRED_KEYS=Object.freeze([...SAFEPAY_KEYS,...SMTP_KEYS]);
const prerequisites=Object.freeze([
  'Safepay: validate merchant sandbox credentials and configured sandbox mode separately; key presence, placeholders and synthetic HMAC events are not provider proof.',
  'Safepay: provider-origin tracker initialization and passport token creation must succeed for an existing owned immutable order; retain provider request/event correlation without secrets.',
  'Callback: register a publicly reachable HTTPS POST /api/v1/webhooks/safepay with the merchant sandbox and establish the same webhook signing secret at both ends.',
  'Callback: preserve untouched raw JSON bytes and validate HMAC-SHA512 via X-SFPY-SIGNATURE (or x-safepay-signature); optional sha512= prefix is accepted. No SHA256/timestamp-signature fallback.',
  'Callback: receive a genuine success event with a stable provider event identity and matching persisted tracker, exact captured order amount and explicit PKR currency. X-SFPY-EVENT-ID / X-SFPY-EVENT-TYPE / X-SFPY-TIMESTAMP are accepted metadata; timestamp alone is not proof or freshness enforcement.',
  'Callback compatibility: canonical callback/receipt evidence now supports payment.succeeded, payment:succeeded, payment.completed, payment:completed, payment.settled, payment:settled and payment.reconciled. The previous cross-path receipt mismatch is fixed; processed-event/order/amount/token identity and supplemental-purpose exclusion remain required.',
  'Evidence: correlate provider dashboard delivery/transaction evidence, server signature acceptance, one completed attempt, one paid payment and one processed event; verify duplicate redelivery creates no second payment. Authoritative server-to-server tracker reconciliation is an alternative verification path.',
  'SMTP: verify selected non-mock mode, reachable SMTP host/port, TLS configuration, SMTP_USER/SMTP_PASS authentication and verified sender (EMAIL_FROM or MAIL_FROM_EMAIL). Port defaults to 587; explicit SMTP_PORT/SMTP_SECURE presence is not mandatory in code.',
  'Email: Mailtrap sandbox captures and mock outbox records do not prove recipient delivery. Live Mailtrap additionally needs valid MAILTRAP_API_TOKEN and authorized live mode. Genuine delivery requires separately authorized controlled send, provider acceptance, durable outbox result and recipient evidence; no send performed here.',
  'Financial: actual provider custody, refunds, supplier payouts, bank settlement and production tax approval remain independently unverified. External execution remains DISABLED; this audit performs no network calls or messages.'
]);
function summarize(source){
  const parsed=require('dotenv').parse(source);
  return {keys:Object.fromEntries(REQUIRED_KEYS.map(key=>[key,typeof parsed[key]==='string'&&parsed[key].trim()!==''?'PRESENT':'MISSING'])),
    groups:{safepay:SAFEPAY_KEYS,smtp_and_email:SMTP_KEYS},user_sms_scope:USER_SMS_SCOPE,
    genuine_provider_verified:false,genuine_email_delivery_verified:false,
    required_user_inputs:['Controlled test email recipient and explicit authorization for a controlled send in a separate task.'],
    prerequisites};
}
function audit(){
  try{return {source:ORIGINAL_ENV,readable:true,...summarize(fs.readFileSync(ORIGINAL_ENV))};}
  catch{return {source:ORIGINAL_ENV,readable:false,keys:Object.fromEntries(REQUIRED_KEYS.map(key=>[key,'UNKNOWN'])),user_sms_scope:USER_SMS_SCOPE,genuine_provider_verified:false,blocker:'Original environment unavailable; no fallback environment was read.'};}
}
module.exports={summarize,audit,REQUIRED_KEYS,SAFEPAY_KEYS,SMTP_KEYS,USER_SMS_SCOPE};
if(require.main===module){const result=audit();console.log(JSON.stringify(result,null,2));if(!result.readable)process.exitCode=1;}
