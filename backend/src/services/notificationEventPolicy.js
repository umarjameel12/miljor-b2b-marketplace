'use strict';
const definitions={
  REFUND_APPROVED_PENDING:['Refund approved; external execution pending','رقم کی واپسی منظور؛ بیرونی ادائیگی باقی ہے','order'],
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
  REFUND_ASSESSED:['Refund request recorded for review','واپسی کی درخواست جائزے کے لیے درج ہو گئی','order'],
  REFUND_APPROVED:['Refund obligation approved; provider execution pending','واپسی کی منظوری دی گئی، ادائیگی زیر التوا ہے','order'],
  REFUND_INITIATED:['Refund initiated','رقم کی واپسی شروع ہو گئی','order'],
  REFUND_COMPLETED:['Refund completed','رقم کی واپسی مکمل ہو گئی','order'],
  DISPUTE_OPENED:['Dispute opened','تنازع درج ہو گیا','order'],
  DISPUTE_RESPONSE_RECEIVED:['Supplier responded to your dispute','سپلائر نے آپ کے تنازع کا جواب دیا','order'],
  DISPUTE_RESOLVED:['Dispute resolved','تنازع حل ہو گیا','order'],
  SETTLEMENT_PENDING:['Settlement pending','سپلائر کی ادائیگی زیر التوا ہے','order'],
  SETTLEMENT_COMPLETED:['Settlement completed','سپلائر کی ادائیگی مکمل ہو گئی','order'],
  SUBSCRIPTION_ACTIVATED:['Paid subscription activated','ادا شدہ سبسکرپشن فعال ہو گئی','account'],
  SUBSCRIPTION_CHECKOUT_INITIATED:['Subscription checkout initiated; payment pending','سبسکرپشن کی ادائیگی شروع ہو گئی؛ تصدیق باقی ہے','account'],
  SUBSCRIPTION_PAYMENT_VERIFIED:['Subscription payment verified; awaiting activation review','سبسکرپشن کی ادائیگی کی تصدیق ہو گئی؛ منظوری باقی ہے','account'],
  SUBSCRIPTION_PAYMENT_FAILED:['Subscription payment failed or cancelled','سبسکرپشن کی ادائیگی ناکام یا منسوخ ہو گئی','account'],
  SUBSCRIPTION_ADMIN_REVIEW_REQUIRED:['Subscription activation requires admin approval','سبسکرپشن کی فعالیت کے لیے انتظامی منظوری درکار ہے','account'],
  SUBSCRIPTION_UPGRADE_COMPLETED:['Subscription upgrade activated','سبسکرپشن اپ گریڈ فعال ہو گیا','account'],
  SUBSCRIPTION_DOWNGRADE_SCHEDULED:['Your plan will change at the end of its paid period','آپ کا پلان ادا شدہ مدت ختم ہونے پر تبدیل ہوگا','account'],
  SUBSCRIPTION_DOWNGRADED:['Paid plan ended; Starter plan is now active','ادا شدہ پلان ختم ہو گیا؛ اسٹارٹر پلان فعال ہے','account'],
  SUBSCRIPTION_PLAN_CHANGE_SCHEDULED:['Paid plan change scheduled','ادا شدہ پلان کی تبدیلی مقرر ہو گئی','account'],
  SUBSCRIPTION_PLAN_CHANGE_PAYMENT_REQUIRED:['Payment required to activate your selected paid plan','منتخب ادا شدہ پلان فعال کرنے کے لیے ادائیگی درکار ہے','account'],
  SUBSCRIPTION_RENEWAL_APPROACHING:['Subscription renewal approaching','سبسکرپشن کی تجدید کی تاریخ قریب ہے','account'],
  SUBSCRIPTION_RENEWAL_FAILED:['Subscription renewal payment failed; grace period active','سبسکرپشن کی تجدید ناکام؛ مہلت کی مدت فعال ہے','account'],
  SUBSCRIPTION_EXPIRED:['Subscription expired; reverted to Starter capacity','سبسکرپشن کی مدت ختم ہو گئی؛ اسٹارٹر کی حد لاگو ہے','account'],
  SUBSCRIPTION_CANCELLATION_REQUESTED:['Subscription cancellation scheduled for period end','مدت کے اختتام پر سبسکرپشن منسوخ ہو جائے گی','account'],
  SUBSCRIPTION_CANCELLED:['Subscription cancelled','سبسکرپشن منسوخ ہو گئی','account'],
  SUPPLIER_VERIFIED:['Supplier verified','سپلائر کی تصدیق ہو گئی','account'],
  VERIFICATION_SUBMITTED:['Supplier verification submitted','سپلائر کی تصدیق کے لیے درخواست جمع ہو گئی','account'],
  VERIFICATION_APPROVED:['Supplier verification approved','سپلائر کی تصدیق منظور ہو گئی','account'],
  VERIFICATION_MORE_INFO_REQUIRED:['More verification information requested','تصدیق کے لیے مزید معلومات درکار ہیں','account'],
  VERIFICATION_REJECTED:['Supplier verification rejected','سپلائر کی تصدیق مسترد ہو گئی','account'],
  APPROVAL_GRANTED:['Approval granted','منظوری مل گئی','account'],
  APPROVAL_REJECTED:['Approval rejected','منظوری مسترد ہو گئی','account'],
  SUSPICIOUS_ACTIVITY:['Suspicious activity detected','مشکوک سرگرمی کی نشاندہی ہوئی','account'],
  FINANCIAL_INCONSISTENCY:['Financial inconsistency detected','مالی حساب میں فرق کی نشاندہی ہوئی','account']
};
const canonical=require('./ucpNotificationEventCatalog');
const urduActions={EMAIL_VERIFIED:'ای میل کی تصدیق ہو گئی',REGISTERED:'اکاؤنٹ بن گیا',VERIFICATION_SUBMITTED:'تصدیق کی درخواست جمع ہو گئی',VERIFICATION_APPROVED:'تصدیق منظور ہو گئی',
  VERIFICATION_INFO_REQUESTED:'مزید معلومات درکار ہیں',VERIFICATION_REJECTED:'تصدیق کی درخواست مسترد ہو گئی',SECURITY_ALERT:'اکاؤنٹ کی حفاظتی اطلاع',
  ACCOUNT_LOCKED:'اکاؤنٹ بند کر دیا گیا',ACCOUNT_UNLOCKED:'اکاؤنٹ بحال ہو گیا',SKU_SUBMITTED:'پیک کی تفصیلات جمع ہو گئیں',SKU_PUBLISHED:'پیک شائع ہو گیا',
  SKU_REJECTED:'پیک کی درخواست مسترد ہو گئی',SKU_PAUSED:'پیک کی فروخت روک دی گئی',SPEC_CHANGE_REQUESTED:'تفصیلات کی تبدیلی کی درخواست',SPEC_CHANGE_APPROVED:'تفصیلات کی تبدیلی منظور',
  STOCK_SHORTAGE:'اسٹاک کی کمی',SERVICE_AREA_CHANGED:'ترسیل کا علاقہ تبدیل ہو گیا',POOL_CREATED:'پول بن گیا',POOL_PUBLISHED:'پول شائع ہو گیا',
  RESERVATION_CREATED:'ریزرویشن بن گئی',RESERVATION_UPDATED:'ریزرویشن تبدیل ہو گئی',RESERVATION_CANCELLED:'ریزرویشن منسوخ ہو گئی',
  HOLD_CREATED:'خریداری کی مہلت شروع ہو گئی',HOLD_EXPIRING:'خریداری کی مہلت ختم ہونے والی ہے',HOLD_EXPIRED:'خریداری کی مہلت ختم ہو گئی',
  CONFIRMATION_REQUIRED:'آپ کی تصدیق درکار ہے',ORDER_CONFIRMED:'آرڈر کی تصدیق ہو گئی',PRICE_LOCKED:'طے شدہ قیمت محفوظ ہو گئی',
  TIER_CHANGED:'قیمت کا درجہ تبدیل ہو گیا',TIER_ACHIEVED:'بہتر قیمت کا درجہ مل گیا',TARGET_REACHED:'پول کا ہدف پورا ہو گیا',PROGRESS_MILESTONE:'پول کی پیش رفت',
  POOL_CLOSING:'پول بند ہونے والا ہے',POOL_CLOSED:'پول بند ہو گیا',POOL_EXPIRED:'پول کی مدت ختم ہو گئی',POOL_CANCELLED:'پول منسوخ ہو گیا',POOL_FAILED:'پول مکمل نہیں ہو سکا',
  STOCK_ALLOCATION_FAILED:'اسٹاک مختص نہیں ہو سکا',POOL_REQUEST_ACCEPTED:'پول کی درخواست قبول ہو گئی',POOL_REQUEST_REJECTED:'پول کی درخواست مسترد ہو گئی',
  CHECKOUT_CREATED:'ادائیگی کا مرحلہ شروع ہو گیا',CONFIRMED:'تصدیق ہو گئی',FAILED:'عمل مکمل نہیں ہو سکا',RECONCILED:'ادائیگی کی جانچ مکمل ہو گئی',
  INVOICE_ISSUED:'انوائس جاری ہو گئی',REFUND_REQUESTED:'رقم کی واپسی کی درخواست',REFUND_APPROVED:'رقم کی واپسی منظور',REFUND_REJECTED:'رقم کی واپسی مسترد',
  REFUND_INITIATED:'رقم کی واپسی شروع',REFUND_SUCCEEDED:'رقم واپس ہو گئی',REFUND_FAILED:'رقم کی واپسی میں رکاوٹ',SETTLEMENT_ELIGIBLE:'سپلائر کی ادائیگی جانچ کے لیے تیار',
  SETTLEMENT_INITIATED:'سپلائر کی ادائیگی شروع',SETTLEMENT_SUCCEEDED:'سپلائر کی ادائیگی مکمل',SETTLEMENT_FAILED:'سپلائر کی ادائیگی میں رکاوٹ',RECONCILIATION_EXCEPTION:'مالی جانچ میں مسئلہ',
  ASSIGNED:'آرڈر سپلائر کو مل گیا',ACCEPTED:'آرڈر قبول ہو گیا',REJECTED:'آرڈر مسترد ہو گیا',PACKING:'آرڈر تیار ہو رہا ہے',READY_FOR_DISPATCH:'آرڈر روانگی کے لیے تیار',
  READY_FOR_PICKUP:'آرڈر وصولی کے لیے تیار',PICKUP_CODE_ISSUED:'وصولی کا کوڈ جاری ہو گیا',PICKED_UP:'آرڈر وصول کر لیا گیا',DISPATCHED:'آرڈر روانہ ہو گیا',
  CLUSTER_FORMED:'ترسیل کا گروپ بن گیا',CLUSTER_CUTOFF:'ترسیل کے گروپ کی مہلت ختم',CLUSTER_REROUTED:'ترسیل کا راستہ تبدیل',ETA_CHANGED:'ترسیل کا متوقع وقت تبدیل',
  DELIVERY_ATTEMPTED:'ترسیل کی کوشش کی گئی',DELIVERY_FAILED:'ترسیل مکمل نہیں ہو سکی',SUPPLIER_MARKED_DELIVERED:'سپلائر نے ترسیل کی اطلاع دی',
  BUYER_CONFIRMATION_REQUIRED:'خریدار کی وصولی کی تصدیق درکار',BUYER_ACCEPTED:'خریدار نے وصولی کی تصدیق کر دی',PARTIAL_DELIVERY:'جزوی ترسیل درج ہو گئی',
  SHORTAGE_RECORDED:'کم مقدار کی اطلاع درج ہو گئی',SLA_BREACHED:'طے شدہ مہلت پوری نہیں ہوئی',OPENED:'تنازع درج ہو گیا',RESPONSE_SUBMITTED:'جواب جمع ہو گیا',
  EVIDENCE_REQUESTED:'مزید ثبوت درکار ہیں',RESOLVED:'تنازع حل ہو گیا',SECURITY_HOLD:'حفاظتی پابندی لگ گئی',MANUAL_RECONCILIATION_RESULT:'انتظامی جانچ کا نتیجہ',
  SERVICE_INCIDENT:'سروس میں رکاوٹ',SERVICE_RESTORED:'سروس بحال ہو گئی'};
const mandatory=type=>/^(PAYMENT[._]|REFUND_|DISPUTE[._]|SETTLEMENT_|SUBSCRIPTION_|VERIFICATION_|SUSPICIOUS_|FINANCIAL_)/.test(type)||
  canonical.definitions[type]?.priority==='CRITICAL';
function eventProjection({eventType,entityId,locale='en'}){
  let definition=definitions[eventType];
  if(!definition&&canonical.definitions[eventType]){
    const meta=canonical.definitions[eventType],name=eventType.split('.')[1];
    const english=name[0]+name.slice(1).toLowerCase().replaceAll('_',' ');
    const kind=meta.domain==='IDENTITY'?'account':meta.domain==='CATALOG'?'catalog':
      meta.domain==='UCP'&&!/ORDER_|HOLD_/.test(name)?'pool':'order';
    definition=[english,urduActions[name]||'کاروباری ریکارڈ میں تبدیلی',kind,meta.priority!=='INFO'];
  }
  if(!definition)throw Error('Unsupported notification event');
  if(!/^[1-9]\d*$/.test(String(entityId))||!Number.isSafeInteger(Number(entityId)))throw Error('Invalid notification entity');
  const [english,urdu,kind,important]=definition;
  const title=locale==='ur'?urdu:english;
  const message=locale==='ur'?'تصدیق شدہ تبدیلی دیکھنے کے لیے متعلقہ ریکارڈ کھولیں۔':'Open the relevant record to review this recorded change.';
  const deepLink=kind==='order'?'/orders':kind==='account'?'/profile':kind==='pool'?'/pools':kind==='catalog'?'/catalog':'/procurement';
  return {title,message,locale:locale==='ur'?'ur':'en',deepLink:deepLink+'?'+kind+'_id='+entityId,
    mandatory:mandatory(eventType),routine:important===false&&!mandatory(eventType),
    transient:/REMINDER|CUTOFF_UPCOMING|^UCP\.(HOLD_EXPIRING|POOL_CLOSING)$/.test(eventType),email:important!==false||mandatory(eventType)};
}
module.exports={eventProjection,eventTypes:Object.freeze([...Object.keys(definitions),...Object.keys(canonical.definitions)]),mandatory};
