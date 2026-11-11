const db = require('../config/db');
const exact = require('./exactDecimal');

class FeeService {
  // B6 exact-money calculation. Existing B4 callers remain unchanged.
  // The same accepted floor/cap and fee-slab schedule applies to the whole basket.
  async calculateBuyerFeeExact(subtotalAmount,connection=db) {
    const subtotal=exact.toCanonical(subtotalAmount,2);
    if(!exact.exactDecimalGte(subtotal,'0.01',2))
      throw new Error('Buyer subtotal must be positive');
    const [slabs]=await connection.query(
      `SELECT fee_percentage FROM buyer_fee_slabs
         WHERE ? BETWEEN min_order_amount AND max_order_amount
         LIMIT 1`,[subtotal]
    );
    const percent=exact.toCanonical(slabs[0]?.fee_percentage??'1.50',2);
    if(!exact.exactDecimalGte(percent,'0.00',2)||
       !exact.exactDecimalGte('100.00',percent,2))
      throw new Error('Configured buyer fee percent is invalid');
    const cents=BigInt(subtotal.replace('.',''));
    const basis=BigInt(percent.replace('.',''));
    let fee=(cents*basis+5000n)/10000n;
    if(!exact.exactDecimalGte(subtotal,'1000.00',2))fee=3000n;
    if(fee<3000n)fee=3000n;
    if(fee>30000n)fee=30000n;
    const buyerFee=(fee/100n).toString()+'.'+(fee%100n).toString().padStart(2,'0');
    return {percentage:percent,buyer_fee:buyerFee};
  }

  async calculateSupplierFeeExact(supplierId,subtotalAmount,connection=db) {
    const id=Number(supplierId);
    if(!Number.isSafeInteger(id)||id<1)throw new Error('Valid supplier required');
    const subtotal=exact.toCanonical(subtotalAmount,2);
    if(!exact.exactDecimalGte(subtotal,'0.01',2))throw new Error('Supplier subtotal must be positive');
    const [profiles]=await connection.query(
      'SELECT transaction_fee_percent FROM supplier_profiles WHERE supplier_id=?',[id]
    );
    // Never compute a supplier payout for a missing supplier profile.
    // A silent fallback here could award or settle money for an invalid supplier.
    if (profiles.length !== 1) {
      const err = new Error('Supplier profile is missing or ambiguous');
      err.code = 'SUPPLIER_PROFILE_REQUIRED';
      err.statusCode = 422;
      throw err;
    }
    if (profiles[0].transaction_fee_percent === null ||
        profiles[0].transaction_fee_percent === undefined ||
        String(profiles[0].transaction_fee_percent).trim() === '') {
      const err = new Error('Supplier commission percentage is not configured');
      err.code = 'SUPPLIER_COMMISSION_UNCONFIGURED';
      err.statusCode = 409;
      throw err;
    }
    const percent=exact.toCanonical(profiles[0].transaction_fee_percent,2);
    if(!exact.exactDecimalGte(percent,'0.00',2)||
       !exact.exactDecimalGte('100.00',percent,2))throw new Error('Supplier fee percent invalid');
    const cents=BigInt(subtotal.replace('.',''));
    const basis=BigInt(percent.replace('.',''));
    const feeCents=(cents*basis+5000n)/10000n;
    const netCents=cents-feeCents;
    const money=n=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
    return {fee_percent:percent,supplier_fee:money(feeCents),
      supplier_net_payout:money(netCents)};
  }
  // Compatibility interfaces call the same exact-money engine as new B6 awards.
  // Legacy response shape retained for B4 callers, without floating point arithmetic.
  async calculateBuyerFee(subtotalAmount) {
    const result = await this.calculateBuyerFeeExact(subtotalAmount);
    return {
      // Legacy API keeps the displayed percentage at zero where the flat
      // minimum applies; the authoritative fee amount remains decimal-exact.
      percentage: exact.exactDecimalGte(subtotalAmount, '1000.00', 2) ? Number(result.percentage) : 0,
      buyer_fee: result.buyer_fee
    };
  }

  async calculateSupplierFee(supplierId, subtotalAmount) {
    const result = await this.calculateSupplierFeeExact(supplierId, subtotalAmount);
    return {
      fee_percent: Number(result.fee_percent),
      supplier_fee: result.supplier_fee,
      supplier_net_payout: result.supplier_net_payout
    };
  }

}

module.exports = new FeeService();