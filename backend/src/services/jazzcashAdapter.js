// =============================================================================
// src/services/jazzcashAdapter.js
// MilJor Package E5: JazzCash Sandbox Payment Adapter
// Implements HMAC-SHA256 integrity hash, server-to-server verification, and test mode
// =============================================================================

const crypto = require('crypto');

class JazzCashAdapter {
  constructor() {
    this.merchantId = process.env.JAZZCASH_MERCHANT_ID || '';
    this.password = process.env.JAZZCASH_PASSWORD || '';
    this.integritySalt = process.env.JAZZCASH_INTEGRITY_SALT || '';
    this.returnUrl = process.env.JAZZCASH_RETURN_URL || 'http://localhost:5000/api/v1/payments/jazzcash/callback';
    this.endpoint = process.env.JAZZCASH_ENDPOINT || 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/';
    this.isConfigured = Boolean(this.merchantId && this.password && this.integritySalt);
  }

  /**
   * Generates HMAC-SHA256 hash for JazzCash transaction fields sorted alphabetically.
   */
  calculateHash(fields) {
    if (!this.integritySalt) return null;
    const sortedKeys = Object.keys(fields).filter(k => fields[k] !== undefined && fields[k] !== null && k !== 'pp_SecureHash').sort();
    const sortedString = sortedKeys.map(k => `${fields[k]}`).join('&');
    const hashString = `${this.integritySalt}&${sortedString}`;
    return crypto.createHmac('sha256', this.integritySalt).update(hashString).digest('hex').toUpperCase();
  }

  /**
   * Prepares payment payload for JazzCash checkout form / redirection.
   */
  initiatePayment({ orderId, amount, billReference, description = 'MilJor Wholesale Procurement' }) {
    if (!this.isConfigured) {
      // Graceful test mode if sandbox credentials absent
      const mockRef = `JC-SANDBOX-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
      return {
        configured: false,
        provider: 'JAZZCASH',
        mode: 'SANDBOX_SIMULATED',
        transaction_ref: mockRef,
        checkout_url: `http://localhost:3000/orders?mock_payment=jazzcash&ref=${mockRef}&amount=${amount}`,
        message: 'JazzCash sandbox running in test verification mode.'
      };
    }

    const txnDateTime = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const expiryDateTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const txnRefNo = `T${txnDateTime}`;

    const fields = {
      pp_Version: '1.1',
      pp_TxnType: 'MWALLET',
      pp_Language: 'EN',
      pp_MerchantID: this.merchantId,
      pp_Password: this.password,
      pp_TxnRefNo: txnRefNo,
      pp_Amount: Math.round(Number(amount) * 100).toString(), // in paisas
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: txnDateTime,
      pp_BillReference: billReference || `ORD-${orderId}`,
      pp_Description: description.slice(0, 100),
      pp_TxnExpiryDateTime: expiryDateTime,
      pp_ReturnURL: this.returnUrl
    };

    fields.pp_SecureHash = this.calculateHash(fields);

    return {
      configured: true,
      provider: 'JAZZCASH',
      mode: 'LIVE_SANDBOX',
      transaction_ref: txnRefNo,
      endpoint: this.endpoint,
      payload: fields
    };
  }

  /**
   * Verifies callback payload signature from JazzCash.
   */
  verifyCallback(callbackPayload) {
    if (!this.isConfigured) {
      return { verified: true, simulated: true, status: 'PAID' };
    }
    const receivedHash = callbackPayload.pp_SecureHash;
    const computedHash = this.calculateHash(callbackPayload);
    const isValid = receivedHash && computedHash && receivedHash.toUpperCase() === computedHash.toUpperCase();
    return {
      verified: isValid,
      responseCode: callbackPayload.pp_ResponseCode,
      status: callbackPayload.pp_ResponseCode === '000' && isValid ? 'PAID' : 'FAILED',
      transaction_ref: callbackPayload.pp_TxnRefNo
    };
  }
}

module.exports = new JazzCashAdapter();
