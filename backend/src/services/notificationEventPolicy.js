'use strict';
const definitions={
  DELIVERY_WINDOW_REQUESTED:['Delivery window requested; supplier confirmation pending','ترسیل کا وقت درخواست کیا گیا؛ سپلائر کی تصدیق باقی ہے','order'],
  DELIVERY_REATTEMPT_PROPOSED:['Review proposed delivery reattempt and fee','ترسیل کی نئی کوشش کے وقت اور فیس کا جائزہ لیں','order'],
  DELIVERY_ROUTE_CANCELLED:['Predispatch route cancelled; delivery requires reassignment','روانگی سے پہلے راستہ منسوخ؛ ترسیل دوبارہ مقرر کرنا ضروری ہے','order'],
  DELIVERY_CHOICE_RECORDED:['Delivery choice requires supplier confirmation','ترسیل کے انتخاب پر سپلائر کی منظوری درکار ہے','request'],
  REQUEST_CREATED:['Request created','درخواست بن گئی','request',false],
  REQUEST_PUBLISHED:['Request published','درخواست شائع ہو گئی','request'],
  SUPPLIER_MATCHED:['Supplier matched','سپلائر مل گیا','request',false],
  QUOTE_RECEIVED:['Quote received','قیمت کی پیشکش موصول ہوئی','request'],
  COUNTEROFFER_SUBMITTED:['Counteroffer submitted','جوابی پیشکش جمع ہو گئی','request'],
  SUPPLIER_ACCEPT:['Supplier accepted counteroffer','سپلائر نے جوابی پیشکش قبول کر لی','request'],
  SUPPLIER_REJECT:['Supplier rejected counteroffer','سپلائر نے جوابی پیشکش مسترد کر دی','request'],
  SUPPLIER_COUNTER_AGAIN:['Supplier sent another counteroffer','سپلائر نے نئی جوابی پیشکش بھیجی','request'],
  QUOTE_REVISED:['Quote revised','قیمت کی پیشکش تبدیل ہو گئی','request'],
  QUOTE_EXPIRED:['Quote expired','قیمت کی پیشکش کی مدت ختم ہو گئی','request'],
  TERMS_LOCKED:['Price and specifications locked','قیمت اور تفصیلات محفوظ ہو گئیں','request'],
  GROUP_INVITED:['Group invitation','گروپ میں شمولیت کی دعوت','group'],
  GROUP_CAPACITY_RESERVED:['Group capacity reserved for individual approval','انفرادی منظوری کے لیے گروپ کی گنجائش محفوظ ہے','group'],
  GROUP_CAPACITY_RELEASED:['Your group capacity released','گروپ میں آپ کی محفوظ گنجائش ختم ہو گئی','group'],
  GROUP_JOINED:['Buyer joined group','خریدار گروپ میں شامل ہو گیا','group',false],
  GROUP_LEFT:['Buyer left group','خریدار گروپ سے نکل گیا','group',false],
  GROUP_MINIMUM_REACHED:['Group minimum reached','گروپ کی کم از کم مقدار پوری ہو گئی','group'],
  GROUP_CUTOFF:['Group cutoff reached','گروپ کی آخری مہلت پوری ہو گئی','group'],
  PRICE_TIER_CHANGED:['Group price tier changed','گروپ کی قیمت کا درجہ تبدیل ہو گیا','group'],
  CONSENT_REQUIRED:['Your approval is required','آپ کی منظوری درکار ہے','request'],
  CYCLE_GENERATED:['Recurring cycle generated','اگلا دور بن گیا','recurring',false],
  CYCLE_CUTOFF_UPCOMING:['Recurring cutoff approaching','اگلے دور کی آخری مہلت قریب ہے','recurring'],
  CYCLE_QUANTITY_MODIFIED:['Cycle quantity updated','دور کی مقدار تبدیل ہو گئی','recurring'],
  CYCLE_DELIVERY_PREFERENCE_UPDATED:['Cycle delivery preference updated','دور کی ترسیل کی ترجیح تبدیل ہو گئی','recurring'],
  CYCLE_DRAFT_READY:['Cycle draft ready for review','دور کی درخواست جائزے کے لیے تیار ہے','recurring'],
  CYCLE_SKIPPED:['Cycle skipped','یہ دور چھوڑ دیا گیا','recurring'],
  RECURRING_PAUSED:['Recurring schedule paused','مسلسل خریداری روک دی گئی','recurring'],
  RECURRING_RESUMED:['Recurring schedule resumed','مسلسل خریداری بحال ہو گئی','recurring'],
  PAYMENT_APPROVAL_REQUIRED:['Payment approval required','ادائیگی کی منظوری درکار ہے','order'],
  DELIVERY_REMINDER:['Upcoming delivery','اگلی ترسیل کی یاددہانی','order'],
  CYCLE_MISSED:['Recurring cycle missed','خریداری کا دور مکمل نہیں ہوا','recurring'],
  CLUSTER_CREATED:['Delivery cluster created','ترسیل کا گروپ بن گیا','order'],
  ROUTE_ASSIGNED:['Delivery route assigned','ترسیل کا راستہ مقرر ہو گیا','order'],
  DISPATCH_SCHEDULED:['Dispatch scheduled','روانگی کا وقت مقرر ہو گیا','order'],
  OUT_FOR_DELIVERY:['Out for delivery','سامان ترسیل کے لیے روانہ ہے','order'],
  ETA_CHANGED:['Delivery estimate changed','ترسیل کا متوقع وقت تبدیل ہو گیا','order'],
  DELIVERY_DELAYED:['Delivery delayed','ترسیل میں تاخیر ہے','order'],
  DELIVERY_REPORTED:['Supplier reported delivery','سپلائر نے ترسیل کی اطلاع دی','order'],
  RECEIPT_CONFIRMED:['Buyer confirmed receipt','خریدار نے وصولی کی تصدیق کر دی','order'],
  PARTIAL_DELIVERY:['Partial delivery recorded','جزوی ترسیل درج ہو گئی','order'],
  DELIVERY_FAILED:['Delivery attempt failed','ترسیل کی کوشش ناکام رہی','order'],
  DELIVERY_RESCHEDULED:['Delivery rescheduled','ترسیل کا نیا وقت مقرر ہو گیا','order'],
  PROOF_UPLOADED:['Delivery proof uploaded','ترسیل کا ثبوت اپ لوڈ ہو گیا','order'],
  PAYMENT_PENDING:['Payment pending','ادائیگی زیر التوا ہے','order'],
  PAYMENT_INITIATED:['Payment initiated','ادائیگی شروع ہو گئی','order'],
  PAYMENT_VERIFIED:['Payment verified','ادائیگی کی تصدیق ہو گئی','order'],
  PAYMENT_FAILED:['Payment failed','ادائیگی ناکام ہو گئی','order'],
  REFUND_INITIATED:['Refund initiated','رقم کی واپسی شروع ہو گئی','order'],
  REFUND_COMPLETED:['Refund completed','رقم کی واپسی مکمل ہو گئی','order'],
  DISPUTE_OPENED:['Dispute opened','تنازع درج ہو گیا','order'],
  DISPUTE_RESOLVED:['Dispute resolved','تنازع حل ہو گیا','order'],
  SETTLEMENT_PENDING:['Settlement pending','سپلائر کی ادائیگی زیر التوا ہے','order'],
  SETTLEMENT_COMPLETED:['Settlement completed','سپلائر کی ادائیگی مکمل ہو گئی','order'],
  SUPPLIER_VERIFIED:['Supplier verified','سپلائر کی تصدیق ہو گئی','account'],
  APPROVAL_GRANTED:['Approval granted','منظوری مل گئی','account'],
  APPROVAL_REJECTED:['Approval rejected','منظوری مسترد ہو گئی','account'],
  SUSPICIOUS_ACTIVITY:['Suspicious activity detected','مشکوک سرگرمی کی نشاندہی ہوئی','account'],
  FINANCIAL_INCONSISTENCY:['Financial inconsistency detected','مالی حساب میں فرق کی نشاندہی ہوئی','account']
};
const mandatory=type=>/^(PAYMENT_|REFUND_|DISPUTE_|SETTLEMENT_|SUSPICIOUS_|FINANCIAL_)/.test(type);
function eventProjection({eventType,entityId,locale='en'}){
  const definition=definitions[eventType];
  if(!definition)throw Error('Unsupported notification event');
  if(!/^[1-9]\d*$/.test(String(entityId))||!Number.isSafeInteger(Number(entityId)))throw Error('Invalid notification entity');
  const [english,urdu,kind,important]=definition;
  const title=locale==='ur'?urdu:english;
  const message=locale==='ur'?'تصدیق شدہ تبدیلی دیکھنے کے لیے متعلقہ ریکارڈ کھولیں۔':'Open the relevant record to review this recorded change.';
  const deepLink=kind==='order'?'/orders':kind==='account'?'/profile':'/procurement';
  return {title,message,locale:locale==='ur'?'ur':'en',deepLink:deepLink+'?'+kind+'_id='+entityId,
    mandatory:mandatory(eventType),email:important!==false||mandatory(eventType)};
}
module.exports={eventProjection,eventTypes:Object.freeze(Object.keys(definitions)),mandatory};
