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
    assert.match(result.html, /MJ_OTP_EMAIL_V7/);
    assert.match(result.html, /name="color-scheme" content="light dark"/);
    assert.match(result.html, /prefers-color-scheme:dark/);
    assert.match(result.html, /data-ogsc/);
    assert.match(result.html, /border-radius:13px/);
    assert.match(result.html, /box-shadow:/);
    assert.match(result.html, /class="mj-accentbar" style="height:5px/);
    assert.match(result.html, /border-radius:17px 17px 0 0/);
    assert.match(result.html, /<tr><td style="padding:0;background-color:#fffdf8;border:0;border-radius:17px 17px 0 0;overflow:hidden;"><div class="mj-accentbar"/);
    assert.doesNotMatch(result.html, /padding:0 1px;background-color:#fffdf8;border:0/);
    assert.match(result.html, /border-radius:18px;box-shadow:/);
    assert.doesNotMatch(result.html, /class="mj-card"[^>]*overflow:hidden/);
    assert.match(result.html, /class="mj-footer"/);
    assert.match(result.html, /The footer is a separate full-width table row/);
    assert.match(result.html, /background-clip:padding-box/);
    assert.match(result.html, /Expires in <strong>10 minutes<\/strong> · Keep it private/);
    const footerIndex=result.html.indexOf('class="mj-footer"');
    const codeIndex=result.html.indexOf('class="mj-codebox"');
    assert.ok(footerIndex>codeIndex,'Footer must render after OTP in a separate row');
    assert.match(result.html.slice(footerIndex), /class="mj-rule"/);
    assert.match(result.html.slice(footerIndex), /You can ignore this email\./);
    assert.match(result.html, /<tr><td class="mj-rule" style="border-top:1px solid/);
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
