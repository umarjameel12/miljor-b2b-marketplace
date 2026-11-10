// B5: Supplier-owned ready-stock Flash Pools. Independent from Regular Pool state machines.
const crypto = require('crypto');
const db = require('../config/db');
const money = require('./exactDecimal');
const entitlement = require('./subscriptionEntitlementService');

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
  return { ...row, remaining_seconds: Math.max(0, Math.floor((new Date(
    String(row.expiry_time).replace(' ', 'T') + (typeof row.expiry_time === 'string' && !/[zZ+-]\d\d:?\d\d$/.test(row.expiry_time) ? 'Z' : '')
  ).getTime() - Date.now()) / 1000)) };
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
    const condition=payload.condition_notes == null?'':String(payload.condition_notes).trim();
    if(condition.length>2000)throw fail('INVALID_CONDITION_NOTES','Condition details exceed the permitted size.');
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      await this._lockVerifiedSupplier(conn,supplierId);
      const {listing,spec}=await this._lockListing(conn,Number(payload.supplier_listing_id),supplierId);
      if(payload.supplier_sku_id && Number(payload.supplier_sku_id)!==Number(spec.supplier_sku_id))
        throw fail('FLASH_SKU_MISMATCH','SKU must match the linked published listing.',409);
      const [result]=await conn.query(
        `INSERT INTO flash_pools
          (flash_code,supplier_id,product_id,supplier_sku_id,supplier_listing_id,product_spec_id,
           total_stock,remaining_stock,discounted_unit_price,original_unit_price,min_quantity,
           max_quantity_per_buyer,selling_mode,clearance_reason,condition_notes,expiry_time,
           configured_duration_minutes,status,snapshot_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?)`,
        ['FL-'+crypto.randomBytes(10).toString('hex'),supplierId,spec.product_id,
         spec.supplier_sku_id,listing.id,spec.id,stock,stock,price,original,min,max,mode,
         reason,condition,padSqlDate(expiry),Math.ceil((expiry.getTime()-Date.now())/60000),
         JSON.stringify({sku_id:spec.supplier_sku_id,sku_title:spec.title,
           product_id:spec.product_id,pack_size:spec.pack_size,pack_unit:spec.pack_unit,
           purchasing_unit:spec.purchasing_unit,listing_id:listing.id,price_per_pack:price,
           original_price:original,selling_mode:mode,offer_stock:stock,condition_notes:condition})]
      );
      await conn.commit();
      return this.getSupplierOffer(supplierId,result.insertId);
    } catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async getSupplierOffer(supplierId,id) {
    const [rows]=await db.query('SELECT * FROM flash_pools WHERE id = ? AND supplier_id = ?',[id,supplierId]);
    if(!rows.length)throw fail('FLASH_NOT_FOUND','Flash offer not found.',404);
    return rows[0];
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
      if(new Date(offer.expiry_time).getTime()<=Date.now())throw fail('FLASH_EXPIRED','Flash expiry must still be in the future.',409);
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
        `UPDATE flash_pools SET status='ACTIVE',published_at=UTC_TIMESTAMP(),version_number=version_number+1 WHERE id=?`,[id]);
      await conn.commit();
      return this.getSupplierOffer(supplierId,id);
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async getActive(filter={}) {
    const params=[];
    let clause='';
    if(filter.category){clause=' AND p.category = ?';params.push(String(filter.category).slice(0,100));}
    const [rows]=await db.query(
      `SELECT fp.*,ps.title AS sku_title,ps.pack_size,ps.pack_unit,ps.purchasing_unit,
        u.business_name AS supplier_name,p.category,sl.listing_code
       FROM flash_pools fp
       JOIN supplier_listings sl ON sl.id=fp.supplier_listing_id AND sl.supplier_id=fp.supplier_id
       JOIN product_specifications ps ON ps.id=fp.product_spec_id AND ps.supplier_sku_id=fp.supplier_sku_id
       JOIN supplier_skus sku ON sku.id=fp.supplier_sku_id AND sku.status='PUBLISHED'
       JOIN supplier_products spd ON spd.id=sku.supplier_product_id AND spd.status='PUBLISHED'
       JOIN products p ON p.id=fp.product_id
       JOIN users u ON u.id=fp.supplier_id AND u.role='SUPPLIER'
       JOIN supplier_profiles sp ON sp.supplier_id=u.id
       WHERE fp.status='ACTIVE' AND fp.expiry_time>UTC_TIMESTAMP()
         AND fp.remaining_stock>0 AND fp.published_at IS NOT NULL
         AND sl.status='ACTIVE' AND ps.lifecycle_status='PUBLISHED'
         AND ps.is_active=1 AND ps.approval_status='APPROVED'
         AND u.verification_status='VERIFIED' AND u.is_verified=1
         AND sp.verification_status='VERIFIED'${clause}
       ORDER BY fp.expiry_time ASC`,params);
    return rows.map(rowSafe);
  }
  async requestHold(buyerId,flashId,payload={},key) {
    if(!key||typeof key!=='string'||key.length>120)throw fail('IDEMPOTENCY_REQUIRED','X-Idempotency-Key is required.');
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      const [offers]=await conn.query('SELECT * FROM flash_pools WHERE id=? FOR UPDATE',[flashId]);
      const offer=offers[0];
      if(!offer)throw fail('FLASH_NOT_FOUND','Flash offer not found.',404);
      const [prior]=await conn.query('SELECT * FROM flash_purchase_holds WHERE buyer_id=? AND idempotency_key=?',[buyerId,key]);
      if(prior.length) {
        if(Number(prior[0].flash_pool_id)!==Number(flashId) ||
          money.toCanonical(prior[0].quantity,2)!==money.toCanonical(payload.quantity,2))
          throw fail('IDEMPOTENCY_CONFLICT','This key belongs to a different purchase.',409);
        await conn.commit();return prior[0];
      }
      const [buyers]=await conn.query('SELECT role,verification_status,buyer_trust_status FROM users WHERE id=?',[buyerId]);
      if(!buyers.length||buyers[0].role!=='BUYER'||buyers[0].verification_status!=='VERIFIED' ||
        ['SUSPENDED','RESTRICTED'].includes(buyers[0].buyer_trust_status))
        throw fail('BUYER_INELIGIBLE','Verified B2B buyers only.',403);
      if(offer.status!=='ACTIVE'||new Date(offer.expiry_time).getTime()<=Date.now())
        throw fail('FLASH_CLOSED','Flash offer is no longer open.',409);
      const quantity=dec(payload.quantity);
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
      const amount=money.exactMultiplyRound(quantity,offer.discounted_unit_price,2);
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
          amount,'0.00','0.00',amount,address]
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
      await conn.commit();
      return {id:h.insertId,order_id:order.insertId,order_code:orderCode,
        quantity,locked_unit_price:offer.discounted_unit_price,total_amount:amount,
        checkout_endpoint:`/api/v1/orders/${order.insertId}/checkout`,hold_expires_in_seconds:900};
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
}
module.exports=new FlashPoolService();
