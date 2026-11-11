'use strict';
// Read-only Safepay SANDBOX readiness preflight. NO provider requests, DB writes or money movement.
const fs = require('node:fs');
const path = require('node:path');

function configured(value) {
  return typeof value === 'string' && value.trim().length > 8 &&
    !/placeholder|your_|example|change_me|dummy|fake|test_only|^sec_sand_placeholder/i.test(value.trim());
}

function inspect(env, sources = {}) {
  const faults = [];
  const sandbox = env.SAFEPAY_ENV === 'sandbox';
  if (!sandbox) faults.push('SAFEPAY_ENV must explicitly equal sandbox');
  if (env.ALLOW_EXTERNAL_MONEY_MOVEMENT !== 'false') {
    faults.push('ALLOW_EXTERNAL_MONEY_MOVEMENT must explicitly equal false');
  }
  if (!['miljor_test_db', 'miljor_sandbox_db'].includes(env.DB_NAME)) {
    faults.push('DB_NAME must be disposable miljor_test_db or isolated miljor_sandbox_db');
  }
  for (const key of ['SAFEPAY_HOST', 'SAFEPAY_CHECKOUT_HOST']) {
    if (env[key] && !/^https:\/\/sandbox\.api\.getsafepay\.com\/?$/.test(env[key])) {
      faults.push(key + ' must be the approved Safepay sandbox hostname');
    }
  }
  const keys = ['SAFEPAY_PUBLIC_KEY','SAFEPAY_SECRET_KEY','SAFEPAY_WEBHOOK_SECRET'];
  const missing = keys.filter(key => !configured(env[key]));
  const adapter = sources.adapter || '';
  const provider = sources.provider || '';
  const settlement = sources.settlement || '';
  const checks = {
    sandbox_environment_isolated: faults.length === 0,
    credentials_present: missing.length === 0,
    sandbox_tracker_adapter_present: /sandbox\.api\.getsafepay\.com/.test(adapter) && /createTracker/.test(adapter),
    signed_webhook_verification_present: /verifyWebhookSignature/.test(adapter) && /timingSafeEqual/.test(adapter),
    refund_gateway_implemented: !/REFUND_PENDING_GATEWAY/.test(provider) && /initiateRefund/.test(provider),
    external_payout_disabled: /External refund and payout execution are strictly DISABLED/.test(settlement)
  };
  return {
    environment: 'sandbox',
    safe_to_attempt_provider_test: checks.sandbox_environment_isolated && checks.credentials_present,
    faults, missing_configuration: missing, checks,
    provider_checkout: checks.sandbox_environment_isolated && checks.credentials_present
      ? 'READY_FOR_AUTHORIZED_SANDBOX_ATTEMPT_NOT_YET_EXECUTED' : 'BLOCKED_NOT_EXECUTED',
    provider_refund: checks.refund_gateway_implemented
      ? 'REQUIRES_REAL_SANDBOX_REFUND_AND_WEBHOOK_EVIDENCE' : 'BLOCKED_GATEWAY_ADAPTER_NOT_IMPLEMENTED',
    provider_bank_payout: 'BLOCKED_NO_VERIFIED_SANDBOX_DISBURSEMENT_CONTRACT',
    real_funds_moved: false
  };
}

if (require.main === module) {
  const base = path.resolve(__dirname, '..');
  const get = filename => fs.readFileSync(path.join(base, filename), 'utf8');
  const status = inspect(process.env, {
    adapter: get('src/services/safepayAdapter.js'),
    provider: get('src/services/paymentProviderService.js'),
    settlement: get('src/services/financialSettlementService.js')
  });
  // Never output values of environment variables, keys or bank details.
  console.log(JSON.stringify(status, null, 2));
  if (process.argv.includes('--require-provider-ready') && !status.safe_to_attempt_provider_test) process.exitCode = 2;
  else if (status.faults.length) process.exitCode = 1;
}
module.exports = { configured, inspect };
