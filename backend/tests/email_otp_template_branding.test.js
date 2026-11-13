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
    assert.match(result.html, /MJ_OTP_EMAIL_V5/);
    assert.match(result.html, /name="color-scheme" content="light dark"/);
    assert.match(result.html, /prefers-color-scheme:dark/);
    assert.match(result.html, /data-ogsc/);
    assert.match(result.html, /border-radius:12px/);
    assert.match(result.html, /box-shadow:/);
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
