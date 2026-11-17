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
  // The currently deployed adapter calls legacy /order/v1/init with major PKR
  // units. Published Payments v3 docs use /order/payments/v3/ and minor units.
  // A production-shape financial test cannot proceed from credentials alone:
  // the operator must explicitly attest the currently enabled merchant contract.
  const contract = env.SAFEPAY_TRACKER_CONTRACT || '';
  const legacyContractConfirmed = contract === 'legacy-v1-major' &&
    env.SAFEPAY_LEGACY_CONTRACT_VERIFIED === 'true';
  const v3ContractSelected = contract === 'payments-v3-minor' &&
    env.SAFEPAY_V3_SANDBOX_ENABLED === 'true';
  const contractConfirmed = legacyContractConfirmed || v3ContractSelected;
  const adapter = sources.adapter || '';
  const v3Client = sources.v3Client || '';
  const v3Contract = sources.v3Contract || '';
  const provider = sources.provider || '';
  const settlement = sources.settlement || '';
  const checks = {
    sandbox_environment_isolated: faults.length === 0,
    credentials_present: missing.length === 0,
    selected_tracker_contract_explicitly_enabled: contractConfirmed,
    legacy_tracker_adapter_present: /sandbox\.api\.getsafepay\.com/.test(adapter) && /createTracker/.test(adapter),
    v3_hosted_checkout_and_reporter_present: /order\/payments\/v3/.test(v3Client) &&
      /client\/passport\/v1\/token/.test(v3Client) && /reporter\/api\/v1\/payments/.test(v3Client),
    v3_amount_and_webhook_contract_present: /toMinorPkr/.test(v3Contract) &&
      /normalizeSucceededWebhook/.test(v3Contract) && /payments-v3-minor/.test(v3Contract),
    signed_webhook_verification_present: /verifyWebhookSignature/.test(adapter) && /timingSafeEqual/.test(adapter),
    refund_gateway_implemented: !/REFUND_PENDING_GATEWAY/.test(provider) && /initiateRefund/.test(provider),
    external_payout_disabled: /External refund and payout execution are strictly DISABLED/.test(settlement)
  };
  return {
    environment: 'sandbox',
    safe_to_attempt_provider_test: checks.sandbox_environment_isolated && checks.credentials_present && contractConfirmed,
    faults, missing_configuration: missing, checks,
    tracker_contract: contract || 'UNDECLARED',
    tracker_contract_review: contractConfirmed
      ? (v3ContractSelected ? 'PAYMENTS_V3_MINOR_IMPLEMENTED_SANDBOX_ONLY_NOT_PROVIDER_CERTIFIED' : 'LEGACY_V1_MAJOR_OPERATOR_ATTESTED_NOT_PROVIDER_CERTIFIED')
      : 'BLOCKED_NO_EXPLICIT_TRACKER_CONTRACT_SELECTION',
    provider_checkout: checks.sandbox_environment_isolated && checks.credentials_present && contractConfirmed
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
    v3Client: get('src/services/safepayV3SandboxClient.js'),
    v3Contract: get('src/services/safepayV3ContractService.js'),
    provider: get('src/services/paymentProviderService.js'),
    settlement: get('src/services/financialSettlementService.js')
  });
  // Never output values of environment variables, keys or bank details.
  console.log(JSON.stringify(status, null, 2));
  if (process.argv.includes('--require-provider-ready') && !status.safe_to_attempt_provider_test) process.exitCode = 2;
  else if (status.faults.length) process.exitCode = 1;
}
module.exports = { configured, inspect };
