// =============================================================================
// src/services/paymentProviderService.js
// MilJor Phase B0: Payment Provider Consolidation & Safety Engine
//
// ENFORCES:
// 1. SAFEPAY is the SOLE authorized active payment provider.
// 2. MOCK_GATEWAY is strictly disabled in operational workflows — no fake PAID state.
// 3. JAZZCASH and EASYPAISA are rejected with UNSUPPORTED_PAYMENT_PROVIDER.
// 4. Client-supplied verification references cannot bypass authoritative verification.
// =============================================================================

const PROVIDERS = {
  SAFEPAY: 'SAFEPAY'
};

class PaymentProviderService {
  get PROVIDERS() {
    return PROVIDERS;
  }

  isProviderSupported(provider) {
    const normalized = (provider || '').toUpperCase();
    return normalized === PROVIDERS.SAFEPAY;
  }

  // ---------------------------------------------------------------------------
  // initiatePayment — Creates payment session with active provider (SAFEPAY ONLY)
  // ---------------------------------------------------------------------------
  async initiatePayment({ provider, amount, orderId, buyerId, description }) {
    const normalizedProvider = (provider || '').toUpperCase();

    if (normalizedProvider !== PROVIDERS.SAFEPAY) {
      return {
        success: false,
        provider: normalizedProvider || 'UNKNOWN',
        status: 'UNSUPPORTED_PAYMENT_PROVIDER',
        message: `Payment provider '${provider}' is not supported. Safepay is the sole active payment provider for MilJor.`,
        raw: null
      };
    }

    // Safepay operational flow is handled through safepayCheckoutService
    return {
      success: true,
      provider: PROVIDERS.SAFEPAY,
      status: 'SAFEPAY_CHECKOUT_REQUIRED',
      message: 'Please initiate checkout via authoritative order endpoint: /api/v1/orders/:id/checkout',
      raw: null
    };
  }

  // ---------------------------------------------------------------------------
  // verifyPayment — Server-side payment verification (NEVER trusts client/mock)
  // ---------------------------------------------------------------------------
  async verifyPayment({ provider, transaction_ref, expected_amount }) {
    const normalizedProvider = (provider || '').toUpperCase();

    if (normalizedProvider === 'MOCK_GATEWAY' || (transaction_ref && String(transaction_ref).startsWith('MOCK-'))) {
      return {
        verified: false,
        status: 'UNSUPPORTED_PAYMENT_PROVIDER',
        amount_verified: false,
        message: 'Mock payment gateway is disabled in operational workflows. Simulated client references cannot verify payment.'
      };
    }

    if (normalizedProvider !== PROVIDERS.SAFEPAY) {
      return {
        verified: false,
        status: 'UNSUPPORTED_PAYMENT_PROVIDER',
        amount_verified: false,
        message: `Payment provider '${provider}' is not supported. Safepay is the sole active payment provider for MilJor.`
      };
    }

    // Safepay payments are verified authoritatively via cryptographic webhooks or safepayCheckoutService reconciliation
    return {
      verified: false,
      status: 'WEBHOOK_VERIFICATION_REQUIRED',
      amount_verified: false,
      message: 'Safepay payments require authoritative cryptographic webhook confirmation.'
    };
  }

  // ---------------------------------------------------------------------------
  // initiateRefund — Requests refund from provider (SAFEPAY ONLY)
  // ---------------------------------------------------------------------------
  async initiateRefund({ provider, transaction_ref, amount, reason }) {
    const normalizedProvider = (provider || '').toUpperCase();

    if (normalizedProvider === 'MOCK_GATEWAY') {
      return {
        success: false,
        status: 'UNSUPPORTED_PAYMENT_PROVIDER',
        message: 'Mock payment gateway cannot perform real financial refunds.'
      };
    }

    if (normalizedProvider !== PROVIDERS.SAFEPAY) {
      return {
        success: false,
        status: 'UNSUPPORTED_PAYMENT_PROVIDER',
        message: `Refund is not supported for payment provider '${provider}'.`
      };
    }

    // Safepay refund delegation
    return {
      success: false,
      status: 'REFUND_PENDING_GATEWAY',
      message: 'Safepay refunds require direct dashboard settlement or authorized gateway credentials.'
    };
  }
}

module.exports = new PaymentProviderService();
