// B5: Supplier-owned ready-stock Flash Pools. Independent from Regular Pool state machines.
const crypto = require('crypto');
const db = require('../config/db');
const money = require('./exactDecimal');
const entitlement = require('./subscriptionEntitlementService');
const feeService = require('./feeService');

const fail = (code, message, statusCode = 400) => {
  const e = new Error(message); e.code = code; e.statusCode = statusCode; return e;
};
const dec = (value, { positive = true } = {}) => {
  try {
    const s = money.toCanonical(value, 2);
    if (s.split('.')[0].replace('-', '').length > 10 ||
        !money.exactDecimalGte(s, positive ? '0.01' : '0.00', 2)) throw Error('invalid');
    return s;
  } catch { throw fail('INVALID_FLASH_DECIMAL', 'Use a valid quantity or PKR price with at most two decimal places.'); }
};
const goodDate = value => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw fail('INVALID_FLASH_EXPIRY', 'A valid future expiry timestamp is required.');
  // No fixed 12-hour business limit; allow vendor-defined future times within representable MySQL DATETIME.
  if (d.getTime() <= Date.now() + 60 * 1000 || d.getTime() > Date.UTC(9999, 11, 31))
    throw fail('INVALID_FLASH_EXPIRY', 'Flash sale must end more than one minute in the future.');
  return d;
};
const padSqlDate = date => date.toISOString().slice(0, 19).replace('T', ' ');
function validMode(raw) {
  if (!['MULTI_BUYER','WHOLE_LOT'].includes(raw)) throw fail('INVALID_SELLING_MODE', 'Select MULTI_BUYER or WHOLE_LOT.');
  return raw;
}
function rowSafe(row) {
  if (!row) return null;
  const deadline = row.expiry_at_utc ? Date.parse(row.expiry_at_utc) : NaN;
  return { ...row, remaining_seconds: Number.isFinite(deadline)
    ? Math.max(0, Math.floor((deadline - Date.now()) / 1000)) : null };
}
class FlashPoolService {
  async _lockVerifiedSupplier(conn, supplierId) {
    const [rows] = await conn.query(
      `SELECT u.role, u.verification_status, u.is_verified, sp.verification_status AS profile_verification
       FROM supplier_profiles sp JOIN users u ON u.id = sp.supplier_id
       WHERE u.id = ? FOR UPDATE`, [supplierId]);
    if (!rows.length || rows[0].role !== 'SUPPLIER' ||
        rows[0].verification_status !== 'VERIFIED' ||
        rows[0].profile_verification !== 'VERIFIED' ||
        Number(rows[0].is_verified) !== 1)
      throw fail('SUPPLIER_NOT_VERIFIED','Only a verified owning supplier can create or publish flash offers.',403);
  }
  async _lockListing(conn, listingId, supplierId) {
    const [rows] = await conn.query(
      'SELECT * FROM supplier_listings WHERE id = ? FOR UPDATE',[listingId]);
    const listing = rows[0];
    if (!listing || Number(listing.supplier_id) !== Number(supplierId)) throw fail('FLASH_LISTING_FORBIDDEN','Supplier listing not found or not owned.',403);
    if (listing.status !== 'ACTIVE') throw fail('FLASH_LISTING_INACTIVE','Only an ACTIVE commercial listing can back a flash sale.',409);
    const [physical] = await conn.query(
      `SELECT ps.*, sk.status AS sku_status, pr.status AS supplier_product_status,
        f.is_active AS family_active, f.approval_status AS family_approval,
        c.is_active AS category_active, c.approval_status AS category_approval
       FROM product_specifications ps
       JOIN supplier_skus sk ON sk.id = ps.supplier_sku_id
       JOIN supplier_products pr ON pr.id = sk.supplier_product_id
       JOIN catalog_product_families f ON f.id = ps.family_id
       JOIN catalog_categories c ON c.id = ps.category_id
       WHERE ps.id = ?`,[listing.product_spec_id]);
    const spec = physical[0];
    if (!spec || spec.supplier_id !== Number(supplierId) ||
        spec.lifecycle_status !== 'PUBLISHED' || spec.approval_status !== 'APPROVED' ||
        !spec.is_active || spec.sku_status !== 'PUBLISHED' ||
        spec.supplier_product_status !== 'PUBLISHED' ||
        !spec.family_active || spec.family_approval !== 'APPROVED' ||
        !spec.category_active || spec.category_approval !== 'APPROVED')
      throw fail('FLASH_SKU_INELIGIBLE','Flash offers require a published, approved supplier-owned physical SKU.',409);
    return {listing,spec};
  }
  async createDraft(supplierId,payload={}) {
    const mode=validMode(payload.selling_mode||'MULTI_BUYER');
    const stock=dec(payload.total_stock);
    const price=dec(payload.discounted_unit_price);
    const original=payload.original_unit_price == null || payload.original_unit_price === '' ? null : dec(payload.original_unit_price);
    if(original && !money.exactDecimalGte(original,price,2))
      throw fail('INVALID_DISCOUNT','Comparison price cannot be lower than the flash offer price.');
    const expiry=goodDate(payload.expiry_time);
    const min=mode==='WHOLE_LOT'?stock:dec(payload.min_quantity == null||payload.min_quantity===''?'1':payload.min_quantity);
    const max=mode==='WHOLE_LOT'?stock:dec(payload.max_quantity_per_buyer == null||payload.max_quantity_per_buyer===''?stock:payload.max_quantity_per_buyer);
    if (!money.exactDecimalGte(stock,min,2) || !money.exactDecimalGte(max,min,2) ||
        !money.exactDecimalGte(stock,max,2)) throw fail('INVALID_FLASH_QUANTITY','Minimum and per-buyer maximum must fit the offered stock.');
    if(!Number.isSafeInteger(Number(payload.supplier_listing_id)) || Number(payload.supplier_listing_id)<1)
      throw fail('FLASH_LISTING_REQUIRED','Choose your published commercial SKU listing.');
    const reason=String(payload.clearance_reason||'Ready stock clearance').trim();
    if(reason.length<3 || reason.length>255) throw fail('INVALID_CLEARANCE_REASON','Provide a truthful clearance reason.');
    const deliveryFee = dec(payload.delivery_fee ?? '0', {positive:false});
    const condition=payload.condition_notes == null?'':String(payload.condition_notes).trim();
    const bestBefore=payload.best_before_date==null||payload.best_before_date===''?null:String(payload.best_before_date);
    if(bestBefore && (!/^\\d{4}-\\d{2}-\\d{2}$/.test(bestBefore) ||
        Number.isNaN(Date.parse(bestBefore)) || Date.parse(bestBefore+'T23:59:59Z')<=Date.now()))
      throw fail('INVALID_BEST_BEFORE','Best-before date must be a valid future date; expired food cannot be listed.');
    if(/near[- ]?expir|best.before/i.test(reason) && !bestBefore)
      throw fail('BEST_BEFORE_REQUIRED','Expiry-related clearance requires a truthful best-before date.');
    if(condition.length>2000)throw fail('INVALID_CONDITION_NOTES','Condition details exceed the permitted size.');
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      await this._lockVerifiedSupplier(conn,supplierId);
      const {listing,spec}=await this._lockListing(conn,Number(payload.supplier_listing_id),supplierId);
      if(payload.supplier_sku_id && Number(payload.supplier_sku_id)!==Number(spec.supplier_sku_id))
        throw fail('FLASH_SKU_MISMATCH','SKU must match the linked published listing.',409);
      // A physical SKU is sold in its published purchasing unit. Never treat
      // fractional bags/tins/bundles as physically split purchasing packs.
      const loose=new Set(['kg','g','mg','l','litre','liter','ml']);
      if(!loose.has(String(spec.purchasing_unit||'').toLowerCase()) &&
          [stock,min,max].some(value=>!Number.isInteger(Number(value))))
        throw fail('FRACTIONAL_PHYSICAL_PACK','Supplier-defined purchasing packs must be whole units.',400);
      // B5: Never fabricate a struck-through market price. The comparison
      // is the supplier's actual active commercial listing price at draft time.
      if(original && !money.exactDecimalEquals(original,listing.base_unit_price,2))
        throw fail('FLASH_COMPARISON_PRICE_UNVERIFIED','Comparison price must equal the current published listing price.',409);
      if(!money.exactDecimalGte(listing.base_unit_price,price,2))
        throw fail('FLASH_PRICE_NOT_DISCOUNTED','Flash price cannot exceed the supplier’s normal listing price.',409);
      const listingUnit=String(listing.pricing_unit||'').trim().toLowerCase();
      const skuUnit=String(spec.purchasing_unit||'').trim().toLowerCase();
      if(!listingUnit || !skuUnit || listingUnit!==skuUnit)
        throw fail('FLASH_UNIT_MISMATCH','Flash quantities must use the listing physical purchasing unit.',409);
      const [result]=await conn.query(
        `INSERT INTO flash_pools
          (flash_code,supplier_id,product_id,supplier_sku_id,supplier_listing_id,product_spec_id,
           total_stock,remaining_stock,discounted_unit_price,original_unit_price,min_quantity,
           max_quantity_per_buyer,selling_mode,clearance_reason,condition_notes,expiry_time,
           configured_duration_minutes,delivery_fee,best_before_date,status,snapshot_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?)`,
        ['FL-'+crypto.randomBytes(10).toString('hex'),supplierId,spec.product_id,
         spec.supplier_sku_id,listing.id,spec.id,stock,stock,price,original,min,max,mode,
         reason,condition,padSqlDate(expiry),Math.ceil((expiry.getTime()-Date.now())/60000),deliveryFee,bestBefore,
         JSON.stringify({sku_id:spec.supplier_sku_id,sku_title:spec.title,
           product_id:spec.product_id,pack_size:spec.pack_size,pack_unit:spec.pack_unit,
           purchasing_unit:spec.purchasing_unit,listing_id:listing.id,price_per_pack:price,
           original_price:original,selling_mode:mode,offer_stock:stock,condition_notes:condition,delivery_fee:deliveryFee,best_before_date:bestBefore})]
      );
      await conn.commit();
      return this.getSupplierOffer(supplierId,result.insertId);
    } catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async updateDraft(supplierId,id,payload={}) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      await this._lockVerifiedSupplier(conn,supplierId);
      const [rows]=await conn.query(
        'SELECT * FROM flash_pools WHERE id=? AND supplier_id=? FOR UPDATE',[id,supplierId]);
      const offer=rows[0];
      if(!offer)throw fail('FLASH_NOT_FOUND','Supplier Flash offer not found.',404);
      if(offer.status!=='DRAFT')throw fail('FLASH_TERMS_LOCKED','Published or cancelled Flash offers cannot be edited.',409);
      const mode=validMode(payload.selling_mode||offer.selling_mode);
      const stock=dec(payload.total_stock??offer.total_stock);
      const price=dec(payload.discounted_unit_price??offer.discounted_unit_price);
      const original=payload.original_unit_price===null||payload.original_unit_price===''?null:
        dec(payload.original_unit_price??offer.original_unit_price??price);
      if(original&&!money.exactDecimalGte(original,price,2))
        throw fail('INVALID_DISCOUNT','Comparison price cannot be less than Flash price.');
      const min=mode==='WHOLE_LOT'?stock:dec(payload.min_quantity||offer.min_quantity||'1');
      const max=mode==='WHOLE_LOT'?stock:dec(payload.max_quantity_per_buyer||offer.max_quantity_per_buyer||stock);
      if(!money.exactDecimalGte(stock,min,2)||!money.exactDecimalGte(max,min,2)||
        !money.exactDecimalGte(stock,max,2))throw fail('INVALID_FLASH_QUANTITY','Minimum/maximum must fit the available Flash stock.');
      const duration=payload.duration_minutes===undefined?
        Number(offer.configured_duration_minutes):Number(payload.duration_minutes);
      if(!Number.isSafeInteger(duration)||duration<1)
        throw fail('INVALID_FLASH_DURATION','Enter a valid positive supplier-selected duration in whole minutes.');
      const reason=String(payload.clearance_reason??offer.clearance_reason).trim();
      const condition=String(payload.condition_notes??offer.condition_notes??'').trim();
      const deliveryFee=dec(payload.delivery_fee??offer.delivery_fee,{positive:false});
      const bestBefore=payload.best_before_date===undefined?offer.best_before_date:
        (payload.best_before_date||null);
      if(reason.length<3||reason.length>255||condition.length>2000)
        throw fail('INVALID_FLASH_DETAILS','Check clearance and condition details.');
      if(bestBefore) {
        const [[safe]]=await conn.query(
          'SELECT (DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE) < DATE_ADD(?,INTERVAL 1 DAY)) AS within_date',
          [duration,bestBefore]);
        if(!safe.within_date)throw fail('INVALID_BEST_BEFORE','Sale cannot extend beyond its stated best-before date.');
      }
      const {listing,spec}=await this._lockListing(conn,offer.supplier_listing_id,supplierId);
      if(original && !money.exactDecimalEquals(original,listing.base_unit_price,2))
        throw fail('FLASH_COMPARISON_PRICE_UNVERIFIED','Comparison price must reflect the published supplier listing.',409);
      if(!money.exactDecimalGte(listing.base_unit_price,price,2))
        throw fail('FLASH_PRICE_NOT_DISCOUNTED','Flash price cannot exceed the normal listing price.',409);
      const loose=new Set(['kg','g','mg','l','litre','liter','ml']);
      if(!loose.has(String(spec.purchasing_unit||'').toLowerCase()) &&
        [stock,min,max].some(x=>!Number.isInteger(Number(x))))
        throw fail('FRACTIONAL_PHYSICAL_PACK','Physical purchasing packs must be whole quantities.');
      const snapshot={sku_id:spec.supplier_sku_id,sku_title:spec.title,
        product_id:spec.product_id,pack_size:spec.pack_size,pack_unit:spec.pack_unit,
        purchasing_unit:spec.purchasing_unit,listing_id:listing.id,
        price_per_pack:price,original_price:original,selling_mode:mode,
        offer_stock:stock,condition_notes:condition,delivery_fee:deliveryFee,
        best_before_date:bestBefore};
      await conn.query(
        `UPDATE flash_pools SET total_stock=?,remaining_stock=?,discounted_unit_price=?,
         original_unit_price=?,min_quantity=?,max_quantity_per_buyer=?,selling_mode=?,
         clearance_reason=?,condition_notes=?,delivery_fee=?,best_before_date=?,
         configured_duration_minutes=?,snapshot_json=?,version_number=version_number+1
         WHERE id=? AND status='DRAFT'`,
         [stock,stock,price,original,min,max,mode,reason,condition,deliveryFee,
         bestBefore,duration,JSON.stringify(snapshot),id]);
      await conn.commit();
      return this.getSupplierOffer(supplierId,id);
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async cancelOffer(supplierId,id) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      await this._lockVerifiedSupplier(conn,supplierId);
      const [rows]=await conn.query(
        'SELECT * FROM flash_pools WHERE id=? AND supplier_id=? FOR UPDATE',[id,supplierId]);
      const offer=rows[0];
      if(!offer)throw fail('FLASH_NOT_FOUND','Supplier Flash offer not found.',404);
      if(offer.status==='CANCELLED'){await conn.commit();return {id,status:'CANCELLED'};}
      if(!['DRAFT','ACTIVE'].includes(offer.status))
        throw fail('FLASH_CANCELLATION_BLOCKED','Paid, expired or sold-out Flash offers require formal resolution.',409);
      if(offer.status==='ACTIVE' && (
        !money.exactDecimalEquals(offer.held_stock,'0',2) ||
        !money.exactDecimalEquals(offer.committed_stock,'0',2)))
        throw fail('FLASH_BUYER_OBLIGATIONS','Flash offer has outstanding buyer checkout/payment commitments.',409);
      if(offer.status==='ACTIVE')await conn.query(
        `UPDATE supplier_inventory_allocations SET status='RELEASED',allocated_qty=0
         WHERE allocation_type='FLASH_POOL' AND reference_id=? AND status='COMMITTED'`,[id]);
      await conn.query(
        "UPDATE flash_pools SET status='CANCELLED',version_number=version_number+1 WHERE id=?",[id]);
      await conn.commit();
      return {id,status:'CANCELLED'};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async getSupplierOffer(supplierId,id) {
    const [rows]=await db.query("SELECT *, DATE_FORMAT(expiry_time,'%Y-%m-%dT%H:%i:%sZ') AS expiry_at_utc FROM flash_pools WHERE id = ? AND supplier_id = ?",[id,supplierId]);
    if(!rows.length)throw fail('FLASH_NOT_FOUND','Flash offer not found.',404);
    return rowSafe(rows[0]);
  }
  async publish(supplierId,id) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      await this._lockVerifiedSupplier(conn,supplierId);
      const [offers]=await conn.query('SELECT * FROM flash_pools WHERE id=? AND supplier_id=? FOR UPDATE',[id,supplierId]);
      const offer=offers[0];
      if(!offer)throw fail('FLASH_NOT_FOUND','Flash offer not found.',404);
      if(offer.status!=='DRAFT')throw fail('FLASH_NOT_DRAFT','Only a draft Flash Pool may be published.',409);
      // The supplier-selected duration starts at actual publication, not at
      // draft save. A draft stored for a day does not lose a day of sale time.
      const durationMinutes=Number(offer.configured_duration_minutes);
      if(!Number.isSafeInteger(durationMinutes)||durationMinutes<2)
        throw fail('INVALID_FLASH_DURATION','Supplier sale duration must be at least two whole minutes.',400);
      if(offer.best_before_date) {
        const [[safeDate]]=await conn.query(
          'SELECT (DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE) < DATE_ADD(?,INTERVAL 1 DAY)) AS within_safe_date',
          [durationMinutes,offer.best_before_date]);
        if(!safeDate.within_safe_date)
          throw fail('FLASH_BEYOND_BEST_BEFORE','The chosen sale duration would continue past the stated best-before date.',409);
      }
      const {listing,spec}=await this._lockListing(conn,offer.supplier_listing_id,supplierId);
      if(Number(spec.supplier_sku_id)!==Number(offer.supplier_sku_id))
        throw fail('FLASH_SKU_MISMATCH','Linked SKU changed before publish.',409);
      await entitlement.assertCanPublishInFamily(supplierId,Number(spec.family_id),conn);
      // The shared inventory allocation ledger serializes regular and flash promises.
      const [allocations]=await conn.query(
        `SELECT unit,SUM(allocated_qty) AS qty FROM supplier_inventory_allocations
         WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED') GROUP BY unit`,
         [listing.id]);
      const unit=spec.purchasing_unit || listing.pricing_unit;
      if(allocations.some(a=>String(a.unit).toLowerCase()!==String(unit).toLowerCase()))
        throw fail('ALLOCATION_UNIT_MISMATCH','Existing allocation units must be reconciled before flash publication.',409);
      const total=money.exactDecimalSum(allocations.map(x=>x.qty).concat([offer.total_stock]),2);
      if(!money.exactDecimalGte(listing.available_stock,total,2))
        throw fail('INSUFFICIENT_STOCK','Supplier has already allocated part of the listed inventory.',409);
      await conn.query(
        `INSERT INTO supplier_inventory_allocations
        (supplier_listing_id,allocation_type,reference_id,allocated_qty,unit,status)
         VALUES (?,'FLASH_POOL',?,?,?,'COMMITTED')`,
        [listing.id,id,offer.total_stock,unit]
      );
      await conn.query(
        `UPDATE flash_pools SET status='ACTIVE',published_at=UTC_TIMESTAMP(),
           expiry_time=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE),
           snapshot_json=JSON_SET(snapshot_json,'$.configured_duration_minutes',?,
             '$.expiry_time',DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE),'%Y-%m-%dT%H:%i:%sZ')),
           version_number=version_number+1 WHERE id=?`,
        [durationMinutes,durationMinutes,durationMinutes,id]);
      await conn.commit();
      return this.getSupplierOffer(supplierId,id);
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async getActive(filter={}) {
    const params=[];
    let clause='';
    if(filter.category){clause=' AND p.category = ?';params.push(String(filter.category).slice(0,100));}
    const [rows]=await db.query(
      `SELECT fp.*,DATE_FORMAT(fp.expiry_time,'%Y-%m-%dT%H:%i:%sZ') AS expiry_at_utc,
        ps.title AS sku_title,ps.pack_size,ps.pack_unit,ps.purchasing_unit,
        u.business_name AS supplier_name,p.category,sl.listing_code
       FROM flash_pools fp
       JOIN supplier_listings sl ON sl.id=fp.supplier_listing_id AND sl.supplier_id=fp.supplier_id
       JOIN product_specifications ps ON ps.id=fp.product_spec_id AND ps.supplier_sku_id=fp.supplier_sku_id
       JOIN supplier_skus sku ON sku.id=fp.supplier_sku_id AND sku.status='PUBLISHED'
       JOIN supplier_products spd ON spd.id=sku.supplier_product_id AND spd.status='PUBLISHED'
       JOIN products p ON p.id=fp.product_id
       JOIN users u ON u.id=fp.supplier_id AND u.role='SUPPLIER'
       JOIN supplier_profiles sp ON sp.supplier_id=u.id
       JOIN catalog_product_families fam ON fam.id=ps.family_id
       JOIN catalog_categories cat ON cat.id=ps.category_id
       WHERE fp.status='ACTIVE' AND fp.expiry_time>UTC_TIMESTAMP()
         AND fp.remaining_stock>0 AND fp.published_at IS NOT NULL
         AND sl.status='ACTIVE' AND ps.lifecycle_status='PUBLISHED'
         AND ps.is_active=1 AND ps.approval_status='APPROVED'
         AND u.verification_status='VERIFIED' AND u.is_verified=1
         AND sp.verification_status='VERIFIED'
         AND fam.is_active=1 AND fam.approval_status='APPROVED'
         AND cat.is_active=1 AND cat.approval_status='APPROVED'${clause}
       ORDER BY fp.expiry_time ASC`,params);
    return rows.map(rowSafe);
  }
  async requestHold(buyerId,flashId,payload={},key) {
    if(!key||typeof key!=='string'||key.length>120)throw fail('IDEMPOTENCY_REQUIRED','X-Idempotency-Key is required.');
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      const [offers]=await conn.query('SELECT * FROM flash_pools WHERE id=? FOR UPDATE',[flashId]);
      if(!offers[0])throw fail('FLASH_NOT_FOUND','Flash offer not found.',404);
      await this.reclaimExpiredUninitiatedHolds(flashId,conn);
      const [refreshed]=await conn.query('SELECT * FROM flash_pools WHERE id=?',[flashId]);
      const offer=refreshed[0];
      const [prior]=await conn.query('SELECT * FROM flash_purchase_holds WHERE buyer_id=? AND idempotency_key=?',[buyerId,key]);
      if(prior.length) {
        if(Number(prior[0].flash_pool_id)!==Number(flashId) ||
          money.toCanonical(prior[0].quantity,2)!==money.toCanonical(payload.quantity,2))
          throw fail('IDEMPOTENCY_CONFLICT','This key belongs to a different purchase.',409);
        await conn.commit();
        return {id:prior[0].id,order_id:prior[0].order_id,quantity:prior[0].quantity,
          locked_unit_price:prior[0].locked_unit_price,status:prior[0].status,
          checkout_endpoint:`/api/v1/orders/${prior[0].order_id}/checkout`};
      }
      // B5: Publication checks are not sufficient; eligibility can change
      // before a buyer attempts checkout. Recheck current supplier, listing,
      // SKU, product, family and category before accepting any buyer money.
      const [eligible]=await conn.query(
        `SELECT sl.status AS listing_status,sl.supplier_id,
          u.role AS supplier_role,u.verification_status AS supplier_status,
          u.is_verified,sp.verification_status AS profile_status,
          ps.lifecycle_status,ps.approval_status,ps.is_active,
          sk.status AS sku_status,pr.status AS product_status,
          fam.is_active AS family_active,fam.approval_status AS family_status,
          cat.is_active AS category_active,cat.approval_status AS category_status
         FROM supplier_listings sl
         JOIN users u ON u.id=sl.supplier_id
         JOIN supplier_profiles sp ON sp.supplier_id=u.id
         JOIN product_specifications ps ON ps.id=sl.product_spec_id
         JOIN supplier_skus sk ON sk.id=ps.supplier_sku_id
         JOIN supplier_products pr ON pr.id=sk.supplier_product_id
         JOIN catalog_product_families fam ON fam.id=ps.family_id
         JOIN catalog_categories cat ON cat.id=ps.category_id
         WHERE sl.id=?`,[offer.supplier_listing_id]);
      const e=eligible[0];
      if(!e||Number(e.supplier_id)!==Number(offer.supplier_id)||
        e.listing_status!=='ACTIVE'||e.supplier_role!=='SUPPLIER'||
        e.supplier_status!=='VERIFIED'||Number(e.is_verified)!==1||
        e.profile_status!=='VERIFIED'||e.lifecycle_status!=='PUBLISHED'||
        e.approval_status!=='APPROVED'||!e.is_active||
        e.sku_status!=='PUBLISHED'||e.product_status!=='PUBLISHED'||
        !e.family_active||e.family_status!=='APPROVED'||
        !e.category_active||e.category_status!=='APPROVED')
        throw fail('FLASH_ELIGIBILITY_REVOKED','Supplier or physical SKU is no longer eligible for Flash checkout.',409);
      const [buyers]=await conn.query('SELECT role,verification_status,buyer_trust_status FROM users WHERE id=?',[buyerId]);
      if(!buyers.length||buyers[0].role!=='BUYER'||buyers[0].verification_status!=='VERIFIED' ||
        ['SUSPENDED','RESTRICTED'].includes(buyers[0].buyer_trust_status))
        throw fail('BUYER_INELIGIBLE','Verified B2B buyers only.',403);
      const [[openClock]] = await conn.query('SELECT (? > UTC_TIMESTAMP()) AS is_open',[offer.expiry_time]);
      if(offer.status!=='ACTIVE'||!openClock.is_open)
        throw fail('FLASH_CLOSED','Flash offer is no longer open.',409);
      const quantity=dec(payload.quantity);
      // Physical purchasing packs are indivisible; mass/volume listings can use
      // their explicitly configured valid fractional increments.
      const [specs]=await conn.query(
        'SELECT purchasing_unit,pack_unit FROM product_specifications WHERE id=? AND supplier_sku_id=?',
        [offer.product_spec_id,offer.supplier_sku_id]);
      const purchasing = String(specs[0]?.purchasing_unit||'').toLowerCase();
      const looseUnits = new Set(['kg','g','mg','l','litre','liter','ml']);
      if (!looseUnits.has(purchasing) && !Number.isInteger(Number(quantity)))
        throw fail('FRACTIONAL_PHYSICAL_PACK','Whole physical packs cannot be purchased in fractional quantities.',409);
      if(offer.selling_mode==='WHOLE_LOT') {
        if(money.toCanonical(quantity,2)!==money.toCanonical(offer.total_stock,2))
          throw fail('WHOLE_LOT_REQUIRED','This offer must be purchased as a single complete lot.',409);
        if(money.toCanonical(offer.remaining_stock,2)!==money.toCanonical(offer.total_stock,2))
          throw fail('WHOLE_LOT_HELD','The entire lot is already on hold or sold.',409);
      } else if(!money.exactDecimalGte(quantity,offer.min_quantity,2) ||
         !money.exactDecimalGte(offer.max_quantity_per_buyer,quantity,2)) {
        throw fail('FLASH_QUANTITY_OUT_OF_RANGE','Quantity must satisfy supplier minimum and maximum.',409);
      }
      if(!money.exactDecimalGte(offer.remaining_stock,quantity,2))
        throw fail('FLASH_OUT_OF_STOCK','Not enough stock remains.',409);
      const [existingBuyerHolds]=await conn.query(
        `SELECT COALESCE(SUM(quantity),0) AS already_bought FROM flash_purchase_holds
         WHERE flash_pool_id=? AND buyer_id=? AND status IN ('HELD','PAYMENT_PENDING','PAID')`,
        [flashId,buyerId]);
      const cumulative=money.exactDecimalSum([existingBuyerHolds[0].already_bought,quantity],2);
      if(!money.exactDecimalGte(offer.max_quantity_per_buyer,cumulative,2))
        throw fail('BUYER_FLASH_MAX_EXCEEDED','This buyer has reached the supplier-defined total purchase limit.',409);
      const subtotal = money.exactMultiplyRound(quantity,offer.discounted_unit_price,2);
      const buyerFeeModel = await feeService.calculateBuyerFee(subtotal);
      const buyerFee = dec(buyerFeeModel.buyer_fee,{positive:false});
      const deliveryFee = dec(offer.delivery_fee||'0',{positive:false});
      const amount = money.exactDecimalSum([subtotal,buyerFee,deliveryFee],2);
      const orderCode='FL'+crypto.randomBytes(9).toString('hex');
      const address=typeof payload.delivery_address==='string'?payload.delivery_address.trim():'';
      if(address.length<8||address.length>1000)throw fail('DELIVERY_ADDRESS_REQUIRED','Provide a valid buyer delivery address.');
      // Order is persisted BEFORE the existing Safepay checkout endpoint can be called.
      const [order]=await conn.query(
        `INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,
          subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,currency,
          delivery_type,delivery_address,payment_status,order_status)
        VALUES (?,?,?,?,?,?,?,?,?,'PKR','DOORSTEP',?,'AWAITING_PAYMENT','AWAITING_PAYMENT')`,
        [orderCode,buyerId,offer.supplier_id,quantity,offer.discounted_unit_price,
          subtotal,deliveryFee,buyerFee,amount,address]
      );
      const [h]=await conn.query(
        `INSERT INTO flash_purchase_holds
         (flash_pool_id,buyer_id,quantity,locked_unit_price,status,expires_at,order_id,idempotency_key)
         VALUES (?,?,?,?,'HELD',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),?,?)`,
        [flashId,buyerId,quantity,offer.discounted_unit_price,order.insertId,key]
      );
      await conn.query(
        `UPDATE flash_pools SET remaining_stock=remaining_stock-?,held_stock=held_stock+?,
           version_number=version_number+1 WHERE id=?`,[quantity,quantity,flashId]
      );
      const [[holdClock]]=await conn.query(
        "SELECT DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%sZ') AS hold_expires_at FROM flash_purchase_holds WHERE id=?",
        [h.insertId]);
      await conn.commit();
      return {id:h.insertId,order_id:order.insertId,order_code:orderCode,
        hold_expires_at:holdClock.hold_expires_at,
        quantity,locked_unit_price:offer.discounted_unit_price,subtotal_amount:subtotal,
        buyer_platform_fee:buyerFee,delivery_fee:deliveryFee,total_amount:amount,
        checkout_endpoint:`/api/v1/orders/${order.insertId}/checkout`,hold_expires_in_seconds:900};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  // B5: Mark checkout as in-progress BEFORE contacting Safepay. Expiry
  // cleanup may release only still-HELD orders, never this payment-in-flight
  // state. The Flash pool is the transaction's first locked row.
  async claimCheckout(orderId,buyerId) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      const [links]=await conn.query('SELECT flash_pool_id FROM flash_purchase_holds WHERE order_id=?',[orderId]);
      if(!links.length){await conn.commit();return {flash_order:false};}
      const flashId=links[0].flash_pool_id;
      await conn.query('SELECT id FROM flash_pools WHERE id=? FOR UPDATE',[flashId]);
      const [holds]=await conn.query(
        'SELECT * FROM flash_purchase_holds WHERE order_id=? AND buyer_id=? FOR UPDATE',[orderId,buyerId]);
      if(!holds.length)throw fail('FLASH_HOLD_FORBIDDEN','Buyer does not own this Flash order.',403);
      const hold=holds[0];
      const [orders]=await conn.query('SELECT order_status,payment_status FROM orders WHERE id=?',[orderId]);
      if(!orders.length || !['AWAITING_PAYMENT','PAID'].includes(orders[0].order_status))
        throw fail('FLASH_ORDER_CLOSED','Order is not eligible for Flash checkout.',409);
      if(hold.status==='PAID'){await conn.commit();return {flash_order:true,paid:true};}
      if(!['HELD','PAYMENT_PENDING'].includes(hold.status))
        throw fail('FLASH_HOLD_CLOSED','Flash hold is no longer eligible for checkout.',409);
      if(hold.status==='HELD'){
        const [[clock]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) AS valid_hold',[hold.expires_at]);
        if(!clock.valid_hold)throw fail('FLASH_HOLD_EXPIRED','Flash checkout hold expired.',409);
        await conn.query(
          "UPDATE flash_purchase_holds SET status='PAYMENT_PENDING' WHERE id=?",[hold.id]);
      }
      await conn.commit();
      return {flash_order:true,hold_id:hold.id};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  // Called before each new buyer allocation (and may be called by an external
  // maintenance scheduler). Only untouched/uninitiated HELD orders can expire.
  // An initiated Safepay checkout remains locked until provider reconciliation.
  async reclaimExpiredUninitiatedHolds(flashId,clientConnection=null) {
    const conn=clientConnection || await db.getConnection();
    const owns=!clientConnection;
    try {
      if(owns)await conn.beginTransaction();
      // Caller may already hold the Flash parent row. Lock order is always
      // flash_pools -> holds -> orders.
      await conn.query('SELECT id FROM flash_pools WHERE id=? FOR UPDATE',[flashId]);
      const [expired]=await conn.query(
        `SELECT h.id,h.quantity,h.order_id
         FROM flash_purchase_holds h
         WHERE h.flash_pool_id=? AND h.status='HELD' AND h.expires_at<=UTC_TIMESTAMP()
         ORDER BY h.id ASC FOR UPDATE`,[flashId]);
      let released=0;
      for(const hold of expired){
        const [orders]=await conn.query('SELECT payment_status,order_status FROM orders WHERE id=? FOR UPDATE',[hold.order_id]);
        if(!orders.length || orders[0].payment_status!=='AWAITING_PAYMENT' ||
          orders[0].order_status!=='AWAITING_PAYMENT')continue;
        const [attempts]=await conn.query('SELECT id FROM payment_attempts WHERE order_id=? LIMIT 1',[hold.order_id]);
        if(attempts.length)continue;
        await conn.query(
          "UPDATE flash_purchase_holds SET status='EXPIRED' WHERE id=? AND status='HELD'",[hold.id]);
        await conn.query(
          "UPDATE orders SET order_status='CANCELLED',payment_status='PAYMENT_FAILED' WHERE id=?",[hold.order_id]);
        const [updated]=await conn.query(
          `UPDATE flash_pools
           SET remaining_stock=remaining_stock+?,held_stock=held_stock-?,
           status=CASE WHEN status='SOLD_OUT' AND expiry_time>UTC_TIMESTAMP() THEN 'ACTIVE' ELSE status END,
           version_number=version_number+1
           WHERE id=? AND held_stock>=?`,[hold.quantity,hold.quantity,flashId,hold.quantity]);
        if(updated.affectedRows!==1)throw fail('FLASH_STOCK_DRIFT','Expired hold exceeds authoritative held stock.',409);
        released++;
      }
      if(owns)await conn.commit();
      return {released};
    }catch(e){if(owns)await conn.rollback();throw e;}finally{if(owns)conn.release();}
  }

  // Reconcile ONLY confirmed server-side payment status; no browser callback
  // can mark a hold as PAID. This method is safe to retry after webhooks/crashes.
  async reconcilePaidOrder(orderId) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      const [references]=await conn.query(
        'SELECT flash_pool_id FROM flash_purchase_holds WHERE order_id=?',[orderId]);
      if(!references.length){await conn.commit();return {flash_order:false};}
      const flashId=references[0].flash_pool_id;
      const [pools]=await conn.query('SELECT * FROM flash_pools WHERE id=? FOR UPDATE',[flashId]);
      if(!pools.length)throw fail('FLASH_NOT_FOUND','Flash purchase pool missing.',409);
      const [holds]=await conn.query(
        'SELECT * FROM flash_purchase_holds WHERE order_id=? FOR UPDATE',[orderId]);
      const hold=holds[0];
      const [orders]=await conn.query('SELECT payment_status,order_status FROM orders WHERE id=?',[orderId]);
      const [payments]=await conn.query(
        "SELECT id FROM payments WHERE order_id=? AND status='PAID' LIMIT 1",[orderId]);
      if(!orders.length || orders[0].payment_status!=='PAID' ||
          !['PAID','SUPPLIER_CONFIRMED','PROCESSING','OUT_FOR_DELIVERY','DELIVERED','COMPLETED'].includes(orders[0].order_status) ||
          !payments.length)
        throw fail('PAYMENT_NOT_VERIFIED','Verified Safepay payment evidence is required.',409);
      if(hold.status!=='PAID'){
        if(!['HELD','PAYMENT_PENDING'].includes(hold.status))
          throw fail('FLASH_HOLD_CONFLICT','Paid order has an incompatible hold lifecycle.',409);
        await conn.query(
          "UPDATE flash_purchase_holds SET status='PAID' WHERE id=?",[hold.id]);
        const [updated]=await conn.query(
          `UPDATE flash_pools SET held_stock=held_stock-?,committed_stock=committed_stock+?,
          status=CASE WHEN remaining_stock=0 AND status='ACTIVE' THEN 'SOLD_OUT' ELSE status END,
          version_number=version_number+1 WHERE id=? AND held_stock>=?`,
          [hold.quantity,hold.quantity,flashId,hold.quantity]);
        if(updated.affectedRows!==1)throw fail('FLASH_STOCK_DRIFT','Paid hold exceeds authoritative held stock.',409);
      }
      await conn.commit();
      return {flash_order:true,hold_status:'PAID',flash_pool_id:flashId};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async getHoldForBuyer(buyerId,holdId) {
    const [rows]=await db.query(
      `SELECT h.id,h.flash_pool_id,h.quantity,h.locked_unit_price,h.status,
         DATE_FORMAT(h.expires_at,'%Y-%m-%dT%H:%i:%sZ') AS hold_expires_at,
         h.order_id,o.order_status,o.payment_status,o.total_amount,o.order_code
       FROM flash_purchase_holds h JOIN orders o ON o.id=h.order_id
       WHERE h.id=? AND h.buyer_id=?`,[holdId,buyerId]);
    if(!rows.length)throw fail('FLASH_HOLD_NOT_FOUND','Purchase hold not found.',404);
    if(rows[0].payment_status==='PAID') {
      await this.reconcilePaidOrder(rows[0].order_id);
      rows[0].status='PAID';
    }
    return rows[0];
  }

  async closeExpiredOffer(supplierId,id) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      await this._lockVerifiedSupplier(conn,supplierId);
      const [rows]=await conn.query(
        'SELECT * FROM flash_pools WHERE id=? AND supplier_id=? FOR UPDATE',[id,supplierId]);
      let pool=rows[0];
      if(!pool)throw fail('FLASH_NOT_FOUND','Flash Pool not found.',404);
      await this.reclaimExpiredUninitiatedHolds(id,conn);
      const [fresh]=await conn.query('SELECT * FROM flash_pools WHERE id=?',[id]);
      pool=fresh[0];
      if(pool.status==='EXPIRED'){await conn.commit();return {id,status:'EXPIRED'};}
      if(!['ACTIVE','SOLD_OUT'].includes(pool.status))
        throw fail('FLASH_INVALID_STATUS','Only published offers can expire.',409);
      const [[clock]]=await conn.query('SELECT (? <= UTC_TIMESTAMP()) AS expired',[pool.expiry_time]);
      if(!clock.expired)throw fail('FLASH_NOT_EXPIRED','Supplier expiry deadline has not been reached.',409);
      // Never release holds with unresolved payment or stock committed to paid buyers.
      const outstanding=money.exactDecimalSum([pool.held_stock,pool.committed_stock],2);
      if(money.exactDecimalGte(outstanding,'0.01',2)) {
        await conn.query(
          `UPDATE supplier_inventory_allocations SET allocated_qty=?,status='COMMITTED'
           WHERE allocation_type='FLASH_POOL' AND reference_id=? AND status='COMMITTED'`,
          [outstanding,id]);
      } else {
        await conn.query(
          `UPDATE supplier_inventory_allocations SET allocated_qty=0,status='RELEASED'
           WHERE allocation_type='FLASH_POOL' AND reference_id=? AND status='COMMITTED'`,[id]);
      }
      await conn.query(
        "UPDATE flash_pools SET status='EXPIRED',version_number=version_number+1 WHERE id=?",[id]);
      await conn.commit();
      return {id,status:'EXPIRED',preserved_unsettled_quantity:outstanding};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

}
module.exports=new FlashPoolService();
