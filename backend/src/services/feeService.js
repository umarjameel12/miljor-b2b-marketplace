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
    const percent=exact.toCanonical(profiles[0]?.transaction_fee_percent??'2.50',2);
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
  // Calculate dynamic slab-based Buyer Marketplace Fee
  async calculateBuyerFee(subtotalAmount) {
    const amount = parseFloat(subtotalAmount);

    if (amount < 1000) {
      // Below min slab fee rule
      return { percentage: 0, buyer_fee: 30.00 }; // Min fee cap
    }

    const [slabs] = await db.query(
      `SELECT * FROM buyer_fee_slabs 
       WHERE ? BETWEEN min_order_amount AND max_order_amount LIMIT 1`,
      [amount]
    );

    let feePercentage = 1.50; // Fallback default
    if (slabs.length > 0) {
      feePercentage = parseFloat(slabs[0].fee_percentage);
    }

    let calculatedFee = (amount * (feePercentage / 100)).toFixed(2);
    calculatedFee = Math.max(30.00, Math.min(300.00, parseFloat(calculatedFee))); // Min Rs. 30, Max Rs. 300 cap

    return {
      percentage: feePercentage,
      buyer_fee: calculatedFee.toFixed(2)
    };
  }

  // Calculate Supplier Transaction Fee based on Plan (Starter 2.5%, Growth 1.5%, Business 1.0%)
  async calculateSupplierFee(supplierId, subtotalAmount) {
    const amount = parseFloat(subtotalAmount);

    const [profiles] = await db.query(
      `SELECT transaction_fee_percent FROM supplier_profiles WHERE supplier_id = ?`,
      [supplierId]
    );

    const feePercent = profiles.length > 0 ? parseFloat(profiles[0].transaction_fee_percent) : 2.50;
    const supplierFee = (amount * (feePercent / 100)).toFixed(2);
    const supplierNetPayout = (amount - parseFloat(supplierFee)).toFixed(2);

    return {
      fee_percent: feePercent,
      supplier_fee: supplierFee,
      supplier_net_payout: supplierNetPayout
    };
  }
}

module.exports = new FeeService();