'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.NODE_ENV = 'test';
process.env.TRANSACTIONAL_EMAIL_MODE = 'mock';
const email = require('../src/services/emailService');

for (const [type,heading] of [
  ['REGISTRATION_OTP','Your verification code'],
  ['PASSWORD_RESET_OTP','Your reset code'],
]) {
  test(type + ' renders branded responsive email and correct code', () => {
    const result = email._renderTemplate(type, { name: 'MilJor Buyer', otp: '123456' });
    assert.ok(result.subject.startsWith('MilJor |'));
    assert.ok(result.html.includes(heading));
    assert.ok(result.html.includes('123456'));
    assert.ok(result.text.includes('123456'));
    assert.match(result.html, /#c8b276/i);
    assert.match(result.html, /<table role="presentation"/);
    assert.match(result.html, /<meta name="viewport"/);
    assert.match(result.html, /Expires in <strong[^>]*>10 minutes/);
    assert.match(result.html, /MJ_OTP_EMAIL_V6/);
    assert.match(result.html, /name="color-scheme" content="light dark"/);
    assert.match(result.html, /prefers-color-scheme:dark/);
    assert.match(result.html, /data-ogsc/);
    assert.match(result.html, /border-radius:13px/);
    assert.match(result.html, /box-shadow:/);
    assert.match(result.html, /class="mj-accentbar" style="height:5px/);
    assert.match(result.html, /border-radius:16px 16px 0 0/);
    assert.match(result.html, /border-radius:18px;overflow:hidden/);
    assert.match(result.html, /background-clip:padding-box/);
    assert.match(result.html, /Expires in <strong>10 minutes<\/strong> · Keep it private/);
    assert.match(result.html, /class="mj-copy mj-rule"/);
    if(type==='PASSWORD_RESET_OTP'){
      assert.match(result.html, /Not your request\? You can ignore this email\./);
    } else {
      assert.match(result.html, /Did not sign up\? You can ignore this email\./);
    }
    assert.match(result.html, /background-color:#f5f2eb/);
    assert.match(result.html, /background-color:#fffdf8/);
    assert.match(result.html, /background-color:#171917 !important/);
    assert.match(result.html, /background-color:#252722 !important/);
    assert.match(result.html, /background-color:#32332c !important/);
    assert.doesNotMatch(result.html, /enter this code to continue/i);
    if (type === 'PASSWORD_RESET_OTP') {
      assert.match(result.html, /Use this one-time code to reset your MilJor password\./);
    } else {
      assert.match(result.html, /Use this one-time code to verify your MilJor email address\./);
    }
    assert.doesNotMatch(result.html, /PASSWORD RESET|EMAIL VERIFICATION|SMART BUSINESS PROCUREMENT/);
    assert.doesNotMatch(result.html, /<script|<iframe|<img/i);
    assert.doesNotMatch(result.html, /https?:\/\//);
  });
  test(type + ' escapes untrusted recipient HTML', () => {
    const result = email._renderTemplate(type, {
      name: '<img src=x onerror=alert(1)>',
      otp: '<123456>',
    });
    assert.ok(result.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(result.html.includes('&lt;123456&gt;'));
    assert.doesNotMatch(result.html, /<img|<123456>/);
  });
}
