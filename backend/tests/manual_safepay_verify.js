const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const safepayAdapter = require('../src/services/safepayAdapter');

async function testSafepay() {
  console.log('--- SAFEPAY CONFIG CHECK ---');
  console.log('SAFEPAY_ENV:', process.env.SAFEPAY_ENV);
  console.log('SAFEPAY_PUBLIC_KEY set:', Boolean(process.env.SAFEPAY_PUBLIC_KEY), 'length:', (process.env.SAFEPAY_PUBLIC_KEY || '').length);
  console.log('SAFEPAY_SECRET_KEY set:', Boolean(process.env.SAFEPAY_SECRET_KEY), 'length:', (process.env.SAFEPAY_SECRET_KEY || '').length);
  console.log('SAFEPAY_WEBHOOK_SECRET set:', Boolean(process.env.SAFEPAY_WEBHOOK_SECRET), 'length:', (process.env.SAFEPAY_WEBHOOK_SECRET || '').length);
  console.log('ALLOW_EXTERNAL_MONEY_MOVEMENT:', process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT);
  console.log('Sandbox Host:', safepayAdapter.sandboxApiHost);
  console.log('Checkout Base:', safepayAdapter.sandboxCheckoutBase);

  console.log('\n--- TESTING LIVE SANDBOX CONNECTIVITY & TRACKER CREATION ---');
  try {
    const trackerResult = await safepayAdapter.createTracker({
      amount: 1500.00,
      currency: 'PKR',
      orderCode: 'TEST-ORD-' + Date.now()
    });
    console.log('Tracker Created Successfully!');
    console.log('Tracker token format:', trackerResult.trackerToken ? trackerResult.trackerToken.slice(0, 10) + '...' : 'none');

    const checkoutUrl = safepayAdapter.constructCheckoutUrl({
      trackerToken: trackerResult.trackerToken,
      orderCode: 'TEST-ORD-' + Date.now(),
      redirectUrl: 'http://localhost:3000/payment/return',
      cancelUrl: 'http://localhost:3000/payment/cancelled'
    });
    console.log('Constructed Checkout URL prefix:', checkoutUrl.split('?')[0]);
    console.log('Checkout URL valid HTTPS:', /^https:\/\//.test(checkoutUrl));

    console.log('\n--- TESTING TRACKER LOOKUP ---');
    const lookupResult = await safepayAdapter.fetchTracker(trackerResult.trackerToken);
    console.log('Lookup Tracker Success!');
    console.log('Tracker data:', JSON.stringify(lookupResult?.data || lookupResult));

    console.log('\n--- TESTING WEBHOOK HMAC-SHA512 SIGNATURE VERIFICATION ---');
    const crypto = require('crypto');
    const testPayload = JSON.stringify({
      data: {
        token: trackerResult.trackerToken,
        amount: 1500,
        currency: 'PKR',
        state: 'TRACKER_ENDED'
      }
    });
    const rawBuffer = Buffer.from(testPayload, 'utf8');
    const validSig = crypto.createHmac('sha512', process.env.SAFEPAY_WEBHOOK_SECRET || process.env.SAFEPAY_SECRET_KEY).update(rawBuffer).digest('hex');
    const isValid = safepayAdapter.verifyWebhookSignature({ rawBody: rawBuffer, signature: validSig });
    const isInvalid = safepayAdapter.verifyWebhookSignature({ rawBody: rawBuffer, signature: 'bad_signature' });
    const isTampered = safepayAdapter.verifyWebhookSignature({ rawBody: Buffer.concat([rawBuffer, Buffer.from(' ')]), signature: validSig });

    console.log('Valid Signature Verified:', isValid);
    console.log('Invalid Signature Rejected:', !isInvalid);
    console.log('Tampered Raw Body Rejected:', !isTampered);
  } catch (err) {
    console.error('Safepay Sandbox API error:', err.message);
  }
}

testSafepay();
