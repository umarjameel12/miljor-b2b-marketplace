// =============================================================================
// src/services/emailService.js
// MilJor Part 4E.10: Transactional Email, Durable Outbox & OTP Foundation
//
// Features:
// 1. Dual Transport: Real SMTP/Gmail vs In-Memory Mock Transport for Tests
// 2. Durable Database Outbox (transactional_email_outbox)
// 3. Cryptographically Secure OTP Generation & SHA-256 Hashing
// 4. Rate-Limiting & Single-Use Enforcement on OTPs
// 5. Safe HTML / Plaintext Templates with Strict Redaction in Logs
// =============================================================================

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../config/db');

class EmailService {
  constructor() {
    const defaultFrom = process.env.MAIL_FROM_EMAIL
      ? (process.env.MAIL_FROM_NAME ? `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_EMAIL}>` : process.env.MAIL_FROM_EMAIL)
      : 'MilJor Notifications <noreply@miljor.com>';
    this.emailFrom = process.env.EMAIL_FROM || defaultFrom;
    this.emailMode = (process.env.TRANSACTIONAL_EMAIL_MODE || process.env.EMAIL_MODE || (process.env.NODE_ENV === 'test' ? 'mock' : 'sandbox')).toLowerCase();
    this.smtpHost = process.env.SMTP_HOST || null;
    this.smtpPort = parseInt(process.env.SMTP_PORT, 10) || 587;
    this.smtpUser = process.env.SMTP_USER || null;
    this.smtpPass = process.env.SMTP_PASS || null;
    this.mailtrapApiToken = process.env.MAILTRAP_API_TOKEN || null;
    this.mailtrapInboxId = process.env.MAILTRAP_INBOX_ID || '4955793';

    // Secret validation (FIX 2): strictly require an explicitly provisioned 64-hex (32-byte) cryptographically random secret in production
    // Never generate an unsafe ephemeral or fallback secret in production. Never log secrets.
    if (process.env.NODE_ENV === 'production') {
      const secret = process.env.OTP_HMAC_SECRET;
      if (!secret || typeof secret !== 'string') {
        throw new Error(
          'FATAL: OTP_HMAC_SECRET environment variable is missing. ' +
          'A securely generated 256-bit random secret (64 hexadecimal characters) must be provisioned.'
        );
      }

      const trimmed = secret.trim();

      // Canonical format check: exactly 64 hexadecimal characters
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        throw new Error(
          'FATAL: OTP_HMAC_SECRET must be exactly 64 hexadecimal characters encoding a 32-byte cryptographically random key.'
        );
      }

      // Decoded byte length verification
      const buf = Buffer.from(trimmed, 'hex');
      if (buf.length !== 32) {
        throw new Error('FATAL: OTP_HMAC_SECRET decoded length must be exactly 32 bytes.');
      }

      // Reject known trivial or placeholder sequences
      const KNOWN_PLACEHOLDERS = [
        '0000000000000000000000000000000000000000000000000000000000000000',
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        '1234567890123456789012345678901234567890123456789012345678901234',
        'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
      ];
      if (KNOWN_PLACEHOLDERS.includes(trimmed.toLowerCase())) {
        throw new Error('FATAL: OTP_HMAC_SECRET cannot be a known trivial or placeholder value.');
      }

      this.otpHmacSecret = trimmed;
    } else {
      // Separate safe configuration for development and test environments
      this.otpHmacSecret = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET || 'miljor_dev_otp_hmac_secret_2026';
    }

    this.mockSentEmails = []; // Test inspectable buffer
    this._initTransporter();
  }

  _initTransporter() {
    if (this.emailMode === 'mock' || (process.env.NODE_ENV === 'test' && !process.env.FORCE_REAL_EMAIL)) {
      // Mock / Fake Transporter for testing and isolated test environments
      this.transporter = {
        sendMail: async (mailOptions) => {
          const messageId = `mock_msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          this.mockSentEmails.push({
            ...mailOptions,
            messageId,
            sentAt: new Date()
          });
          return {
            accepted: [mailOptions.to],
            rejected: [],
            messageId
          };
        }
      };
      this.isConfigured = false;
    } else if (this.emailMode === 'smtp' && this.smtpHost && this.smtpUser && this.smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpPort === 465,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPass
        },
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
      });
      this.isConfigured = true;
    } else if ((this.emailMode === 'sandbox' || this.emailMode === 'mailtrap') && this.mailtrapApiToken) {
      // Mailtrap Email Sandbox Transport
      this.transporter = {
        sendMail: async (mailOptions) => {
          return this._sendViaMailtrapApi({
            mailOptions,
            token: this.mailtrapApiToken,
            inboxId: this.mailtrapInboxId,
            isSandbox: true
          });
        }
      };
      this.isConfigured = true;
    } else if ((this.emailMode === 'live' || this.emailMode === 'mailtrap_live') && this.mailtrapApiToken) {
      // Mailtrap Email Sending Transport
      this.transporter = {
        sendMail: async (mailOptions) => {
          return this._sendViaMailtrapApi({
            mailOptions,
            token: this.mailtrapApiToken,
            isSandbox: false
          });
        }
      };
      this.isConfigured = true;
    } else {
      // Default to in-memory fallback
      this.transporter = {
        sendMail: async (mailOptions) => {
          const messageId = `mock_msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          this.mockSentEmails.push({
            ...mailOptions,
            messageId,
            sentAt: new Date()
          });
          return {
            accepted: [mailOptions.to],
            rejected: [],
            messageId
          };
        }
      };
      this.isConfigured = false;
    }
  }

  /**
   * Internal helper to dispatch emails directly via Mailtrap REST API
   * Supports Mailtrap Email Sandbox (inbox) and Mailtrap Email Sending (production/demo)
   */
  async _sendViaMailtrapApi({ mailOptions, token, inboxId = '4955793', isSandbox = true }) {
    const https = require('https');
    const fromEmail = (mailOptions.from && mailOptions.from.match(/<([^>]+)>/))
      ? mailOptions.from.match(/<([^>]+)>/)[1]
      : (mailOptions.from || 'hello@demomailtrap.co');
    const fromName = mailOptions.from
      ? mailOptions.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim()
      : 'MilJor';
    const toEmail = Array.isArray(mailOptions.to) ? mailOptions.to[0] : mailOptions.to;

    const payload = JSON.stringify({
      from: { email: fromEmail, name: fromName || 'MilJor' },
      to: [{ email: toEmail }],
      subject: mailOptions.subject,
      text: mailOptions.text,
      html: mailOptions.html
    });

    const path = isSandbox ? `/api/send/${inboxId}` : '/api/send';
    const hostname = isSandbox ? 'sandbox.api.mailtrap.io' : 'send.api.mailtrap.io';

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname,
        path,
        method: 'POST',
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              const messageId = (parsed.message_ids && parsed.message_ids[0])
                ? parsed.message_ids[0]
                : `mt_${Date.now()}`;
              resolve({
                accepted: [toEmail],
                rejected: [],
                messageId: String(messageId)
              });
            } catch (e) {
              resolve({ accepted: [toEmail], rejected: [], messageId: `mt_${Date.now()}` });
            }
          } else {
            reject(new Error(`Mailtrap API error (${res.statusCode}): ${data}`));
          }
        });
      });
      req.on('timeout', () => {
        req.destroy(new Error('Email provider connection timed out (10s threshold reached)'));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  /**
   * Escape untrusted text for safe HTML email rendering.
   * @param {string} str
   * @returns {string} Escaped string
   */
  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Mask email for safe logging (e.g. m***@example.com)
   * @param {string} email
   * @returns {string} Redacted email
   */
  _maskEmail(email) {
    if (!email || !email.includes('@')) return '***@***.***';
    const [user, domain] = email.split('@');
    const maskedUser = user.length <= 2 ? user[0] + '***' : user[0] + '***' + user[user.length - 1];
    return `${maskedUser}@${domain}`;
  }

  /**
   * Generate cryptographically secure 6-digit numeric OTP.
   * @returns {string} 6-digit OTP string
   */
  generateOtp() {
    return String(crypto.randomInt(100000, 1000000));
  }

  /**
   * Compute server-secret HMAC-SHA-256 for a 6-digit OTP with domain separation
   * and per-challenge context (user ID, normalized email, and challenge purpose).
   * Prevents offline brute-force precomputation attacks against low-entropy OTPs.
   *
   * @param {Object} params
   * @param {string} params.otp
   * @param {number} params.userId
   * @param {string} params.email
   * @param {string} params.purpose
   * @returns {string} Versioned HMAC string: "v2$<hex_digest>"
   */
  computeOtpHmac({ otp, userId, email, purpose }) {
    const cleanOtp = String(otp).trim();
    const cleanEmail = String(email || '').toLowerCase().trim();
    const cleanPurpose = String(purpose || 'REGISTRATION_VERIFY').trim();
    const message = `${userId}:${cleanEmail}:${cleanPurpose}:${cleanOtp}`;
    const digest = crypto.createHmac('sha256', this.otpHmacSecret).update(message).digest('hex');
    return `v2$${digest}`;
  }

  /**
   * Legacy plain SHA-256 OTP hashing (maintained for backward-compatibility with v1 challenges).
   * @param {string} otp
   * @returns {string} Hex hash
   */
  hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
  }

  /**
   * Shared, mobile-friendly transactional OTP design.
   * Email-client-safe tables and inline styles; no remote images or scripts.
   * This branded header lives inside the message, independent of Gmail avatars.
   */
  _renderOtpEmail({ name, otp, purpose }) {
    const escapedName = this._escapeHtml(name || 'there');
    const escapedOtp = this._escapeHtml(otp);
    const reset = purpose === 'PASSWORD_RESET';
    const title = reset ? 'Your reset code' : 'Your verification code';
    const note = reset
      ? 'Did not request this? You can ignore this email.'
      : 'Did not create an account? You can ignore this email.';

    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <title>${title} | MilJor</title>
  <style>
    :root { color-scheme:light only; supported-color-schemes:light; }
    @media only screen and (max-width:480px) {
      .mj-shell { padding:12px 10px !important; }
      .mj-inner { padding:24px 22px 20px !important; }
      .mj-title { font-size:24px !important; }
      .mj-otp { font-size:32px !important; letter-spacing:6px !important; }
    }
    @media (prefers-color-scheme:dark) {
      .mj-page { background-color:#f5f3ee !important; }
      .mj-card { background-color:#ffffff !important; }
      .mj-otp-box { background-color:#f9f6ef !important; }
      .mj-ink { color:#252520 !important; }
      .mj-muted { color:#68645b !important; }
      .mj-otp { color:#373028 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#252520;">
  <!-- MJ_OTP_EMAIL_V4 -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">A secure MilJor code valid for 10 minutes.</div>
  <table class="mj-page" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f5f3ee" style="background-color:#f5f3ee;border-collapse:collapse;">
    <tr><td class="mj-shell" align="center" style="padding:25px 12px;">
      <table class="mj-card" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff" style="max-width:450px;background-color:#ffffff;border-collapse:separate;border-spacing:0;border:1px solid #eae5d9;border-radius:16px;box-shadow:0 8px 28px rgba(51,42,29,0.07);">
        <tr><td height="4" bgcolor="#c8b276" style="height:4px;background-color:#c8b276;font-size:0;line-height:0;border-radius:16px 16px 0 0;">&nbsp;</td></tr>
        <tr><td class="mj-inner" style="padding:26px 32px 24px;">
          <p class="mj-ink" style="margin:0 0 30px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;line-height:1.2;letter-spacing:-0.35px;color:#252520;">MilJor<span style="color:#b89a5a;">.</span></p>
          <h1 class="mj-title mj-ink" style="margin:0 0 11px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:700;letter-spacing:-0.65px;line-height:1.18;color:#252520;">${title}</h1>
          <p class="mj-muted" style="margin:0 0 23px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#68645b;">Hi ${escapedName}, enter the code below to continue.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;">
            <tr><td class="mj-otp-box" align="center" bgcolor="#f9f6ef" style="padding:18px 5px;background-color:#f9f6ef;border:1px solid #e6dac2;border-radius:12px;box-shadow:0 3px 11px rgba(76,60,31,0.08);">
              <span class="mj-otp" style="font-family:Arial,Helvetica,sans-serif;font-size:36px;font-weight:700;letter-spacing:8px;line-height:1.2;color:#373028;">${escapedOtp}</span>
            </td></tr>
          </table>
          <p class="mj-muted" style="margin:12px 0 0;text-align:center;font-size:12px;line-height:1.4;color:#68645b;">Valid for <strong>10 minutes</strong> · Do not share</p>
          <p class="mj-muted" style="margin:25px 0 0;padding-top:14px;border-top:1px solid #eeeae3;font-size:11px;line-height:1.45;color:#68645b;">${note}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /**
   * Render pre-built email templates.
   */
  _renderTemplate(templateName, payload) {
    switch (templateName) {
      case 'REGISTRATION_OTP':
        return {
          subject: 'MilJor | Verify your email',
          text: `Hi ${payload.name || 'there'},\n\nYour MilJor email verification code is: ${payload.otp}\n\nThis code expires in 10 minutes. Do not share it.\n\nIf you did not create an account, ignore this email.\n\nMilJor — Secure business procurement`,
          html: this._renderOtpEmail({ name: payload.name, otp: payload.otp, purpose: 'REGISTRATION_OTP' })
        };

      case 'PASSWORD_RESET_OTP':
        return {
          subject: 'MilJor | Password reset code',
          text: `Hi ${payload.name || 'there'},\n\nYour MilJor password reset code is: ${payload.otp}\n\nThis code expires in 10 minutes. Do not share it.\n\nIf you did not request a password reset, ignore this email.\n\nMilJor — Secure business procurement`,
          html: this._renderOtpEmail({ name: payload.name, otp: payload.otp, purpose: 'PASSWORD_RESET' })
        };

      case 'SECURITY_ALERT':
        return {
          subject: 'MilJor Security Alert: Account Activity',
          text: `Hello ${payload.name || 'User'},\n\n${payload.message}\n\nIf this was you, no action is needed. Otherwise, please contact MilJor support immediately.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #2563eb;">MilJor Security Notification</h2>
              <p>Hello <strong>${this._escapeHtml(payload.name || 'User')}</strong>,</p>
              <p>${this._escapeHtml(payload.message)}</p>
              <p style="color: #6b7280; font-size: 14px;">Event recorded at: ${new Date().toISOString()}</p>
            </div>
          `
        };

      default:
        return {
          subject: payload.subject || 'MilJor Notification',
          text: payload.text || '',
          html: payload.html || `<p>${this._escapeHtml(payload.text || '')}</p>`
        };
    }
  }

  /**
   * Queue and dispatch a transactional email via the durable database outbox.
   *
   * @param {Object} params
   * @param {string} params.recipientEmail
   * @param {number} [params.recipientUserId]
   * @param {string} params.templateName
   * @param {Object} params.payload
   * @param {string} [params.idempotencyKey]
   * @returns {Promise<Object>} Outbox record with status
   */
  async queueAndSendEmail({ recipientEmail, recipientUserId = null, templateName, payload, idempotencyKey = null }) {
    if (!recipientEmail || !recipientEmail.includes('@')) {
      const err = new Error('Valid recipient email address is required');
      err.code = 'INVALID_RECIPIENT';
      err.statusCode = 400;
      throw err;
    }

    const { subject, text, html } = this._renderTemplate(templateName, payload);
    const key = idempotencyKey || `email_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    // 1. Insert into durable outbox
    const [outboxResult] = await db.query(
      `INSERT INTO transactional_email_outbox
        (recipient_email, recipient_user_id, template_name, subject, payload_json, status, idempotency_key)
       VALUES (?, ?, ?, ?, ?, 'QUEUED', ?)`,
      [recipientEmail, recipientUserId, templateName, subject, JSON.stringify(payload), key]
    );

    const outboxId = outboxResult.insertId;

    // 2. Dispatch via transporter (Outside long database transactions)
    try {
      const sendResult = await this.transporter.sendMail({
        from: this.emailFrom,
        to: recipientEmail,
        subject,
        text,
        html
      });

      const providerMessageId = sendResult.messageId || null;

      // Update outbox as PROVIDER_ACCEPTED
      await db.query(
        `UPDATE transactional_email_outbox
         SET status = 'PROVIDER_ACCEPTED',
             provider_message_id = ?,
             attempt_count = attempt_count + 1,
             last_attempted_at = NOW(),
             sent_at = NOW()
         WHERE id = ?`,
        [providerMessageId, outboxId]
      );

      return {
        outbox_id: outboxId,
        status: 'PROVIDER_ACCEPTED',
        message_id: providerMessageId,
        recipient: this._maskEmail(recipientEmail)
      };
    } catch (sendErr) {
      // Record failure in outbox
      await db.query(
        `UPDATE transactional_email_outbox
         SET status = 'FAILED',
             attempt_count = attempt_count + 1,
             last_error = ?,
             last_attempted_at = NOW()
         WHERE id = ?`,
        [sendErr.message, outboxId]
      );

      return {
        outbox_id: outboxId,
        status: 'FAILED',
        error: sendErr.message,
        recipient: this._maskEmail(recipientEmail)
      };
    }
  }

  /**
   * Create and dispatch an Email OTP verification challenge.
   *
   * @param {Object} params
   * @param {number} params.userId
   * @param {string} params.email
   * @param {string} [params.userName]
   * @param {string} [params.purpose='REGISTRATION_VERIFY']
   * @returns {Promise<Object>} { sent: boolean, expires_at: Date }
   */
  async createAndSendOtp({ userId, email, userName = 'User', purpose = 'REGISTRATION_VERIFY' }) {
    // 1. Rate Limiting Check: Prevent spamming OTP resend (< 60s cooldown)
    const [recent] = await db.query(
      `SELECT created_at FROM email_verifications 
       WHERE user_id = ? AND purpose = ? AND created_at > (NOW() - INTERVAL 60 SECOND)
       ORDER BY id DESC LIMIT 1`,
      [userId, purpose]
    );

    if (recent.length > 0) {
      const err = new Error('Please wait at least 60 seconds before requesting another verification code.');
      err.code = 'RATE_LIMITED';
      err.statusCode = 429;
      throw err;
    }

    // 2. Invalidate previous active unconsumed challenges for this user and purpose
    // Prevents multiple concurrent valid OTPs
    await db.query(
      `UPDATE email_verifications 
       SET consumed_at = NOW() 
       WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
      [userId, purpose]
    );

    // Cancel any stale queued outbox notifications for this user and template
    const templateName = purpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET_OTP' : 'REGISTRATION_OTP';
    await db.query(
      `UPDATE transactional_email_outbox 
       SET status = 'FAILED', last_error = 'SUPERSEDED_BY_NEWER_REQUEST' 
       WHERE recipient_user_id = ? AND template_name = ? AND status = 'QUEUED'`,
      [userId, templateName]
    );

    // 3. Generate secure OTP and server-secret HMAC-SHA-256 hash (v2)
    const rawOtp = this.generateOtp();
    const otpHmac = this.computeOtpHmac({ otp: rawOtp, userId, email, purpose });

    // 4. Insert into email_verifications (10 minute expiry)
    const [insertResult] = await db.query(
      `INSERT INTO email_verifications
        (user_id, email, otp_hash, purpose, expires_at)
       VALUES (?, ?, ?, ?, NOW() + INTERVAL 10 MINUTE)`,
      [userId, email, otpHmac, purpose]
    );
    const verificationId = insertResult.insertId;

    // 5. Queue and dispatch email notification
    try {
      const sendResult = await this.queueAndSendEmail({
        recipientEmail: email,
        recipientUserId: userId,
        templateName,
        payload: {
          name: userName,
          otp: rawOtp
        }
      });

      if (sendResult && sendResult.status === 'FAILED') {
        // Burn challenge immediately so phantom challenge is not left open
        await db.query(
          'UPDATE email_verifications SET consumed_at = NOW() WHERE id = ?',
          [verificationId]
        );
        const err = new Error('Failed to deliver verification email. Please try again later.');
        err.code = 'EMAIL_DELIVERY_FAILED';
        err.statusCode = 502;
        throw err;
      }
    } catch (sendErr) {
      // Invalidate the challenge if dispatch failed
      await db.query(
        'UPDATE email_verifications SET consumed_at = NOW() WHERE id = ?',
        [verificationId]
      );
      throw sendErr;
    }

    return {
      success: true,
      message: 'Verification code sent to your email address.',
      recipient: this._maskEmail(email),
      expires_in_minutes: 10
    };
  }

  /**
   * Verify an OTP string against a stored hash (v2 HMAC or v1 legacy SHA-256).
   * Uses crypto.timingSafeEqual to prevent timing side channels.
   *
   * @param {Object} params
   * @param {string} params.otp
   * @param {number} params.userId
   * @param {string} params.email
   * @param {string} params.purpose
   * @param {string} params.storedHash
   * @returns {boolean} True if matched
   */
  verifyOtpHmac({ otp, userId, email, purpose, storedHash }) {
    if (!storedHash || !otp) return false;
    const trimmedOtp = String(otp).trim();

    if (storedHash.startsWith('v2$')) {
      const expectedHmac = this.computeOtpHmac({
        otp: trimmedOtp,
        userId,
        email: email || '',
        purpose
      });
      const expectedBuf = Buffer.from(storedHash);
      const inputBuf = Buffer.from(expectedHmac);
      return expectedBuf.length === inputBuf.length && crypto.timingSafeEqual(expectedBuf, inputBuf);
    } else {
      const legacyExpected = this.hashOtp(trimmedOtp);
      const expectedBuf = Buffer.from(storedHash, 'hex');
      const inputBuf = Buffer.from(legacyExpected, 'hex');
      return expectedBuf.length === inputBuf.length && crypto.timingSafeEqual(expectedBuf, inputBuf);
    }
  }

  /**
   * Verify and consume an OTP.
   * Defeats race conditions through atomic single-use conditional updates.
   *
   * @param {Object} params
   * @param {number} params.userId
   * @param {string} params.otp
   * @param {string} [params.purpose='REGISTRATION_VERIFY']
   * @returns {Promise<boolean>} True if successfully verified
   */
  async verifyAndConsumeOtp({ userId, otp, purpose = 'REGISTRATION_VERIFY' }) {
    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
      const err = new Error('Valid 6-digit OTP is required');
      err.code = 'INVALID_OTP';
      err.statusCode = 400;
      throw err;
    }

    const trimmedOtp = otp.trim();

    // Fetch latest active unconsumed OTP for this user and purpose
    const [rows] = await db.query(
      `SELECT id, email, otp_hash, expires_at, attempts_count, (expires_at <= NOW()) AS is_expired 
       FROM email_verifications
       WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
       ORDER BY id DESC LIMIT 1`,
      [userId, purpose]
    );

    if (rows.length === 0) {
      const err = new Error('No active verification request found. Please request a new code.');
      err.code = 'OTP_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const record = rows[0];

    // Check expiration
    if (record.is_expired) {
      const err = new Error('Verification code has expired. Please request a new code.');
      err.code = 'OTP_EXPIRED';
      err.statusCode = 410;
      throw err;
    }

    // Check brute-force attempts limit (max 5)
    if (record.attempts_count >= 5) {
      // Mark consumed to burn the compromised challenge
      await db.query('UPDATE email_verifications SET consumed_at = NOW() WHERE id = ?', [record.id]);
      const err = new Error('Too many invalid attempts. Verification code invalidated. Please request a new code.');
      err.code = 'MAX_ATTEMPTS_EXCEEDED';
      err.statusCode = 429;
      throw err;
    }

    // Increment attempts
    await db.query('UPDATE email_verifications SET attempts_count = attempts_count + 1 WHERE id = ?', [record.id]);

    // Dual-hash verification: v2 HMAC vs v1 legacy SHA-256
    const hashesMatch = this.verifyOtpHmac({
      otp: trimmedOtp,
      userId,
      email: record.email || '',
      purpose,
      storedHash: record.otp_hash
    });

    if (!hashesMatch) {
      const err = new Error('Invalid verification code. Please check and try again.');
      err.code = 'INVALID_OTP';
      err.statusCode = 400;
      throw err;
    }

    // Atomic race-proof consumption: Only one concurrent execution can succeed
    const [updateResult] = await db.query(
      'UPDATE email_verifications SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL',
      [record.id]
    );

    if (updateResult.affectedRows === 0) {
      const err = new Error('Verification code has already been consumed.');
      err.code = 'OTP_ALREADY_CONSUMED';
      err.statusCode = 409;
      throw err;
    }

    return true;
  }

  /**
   * Process a batch of pending or retryable outbox messages.
   * Concurrency-safe: claims messages atomically before dispatching.
   *
   * @param {Object} [options]
   * @param {number} [options.limit=10]
   * @returns {Promise<Object>} { processed, succeeded, failed }
   */
  async processOutboxBatch({ limit = 10 } = {}) {
    const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));

    // Fetch batch of QUEUED or retryable FAILED (attempt_count < 3) messages
    const [messages] = await db.query(
      `SELECT id, recipient_email, recipient_user_id, template_name, subject, payload_json, attempt_count
       FROM transactional_email_outbox
       WHERE (status = 'QUEUED')
          OR (status = 'FAILED' AND attempt_count < 3 AND (last_attempted_at IS NULL OR last_attempted_at < (NOW() - INTERVAL 5 MINUTE)))
       ORDER BY id ASC
       LIMIT ?`,
      [safeLimit]
    );

    let succeeded = 0;
    let failed = 0;

    for (const msg of messages) {
      // Atomic claim to prevent concurrent worker duplicate sending
      const [claimResult] = await db.query(
        `UPDATE transactional_email_outbox
         SET attempt_count = attempt_count + 1,
             last_attempted_at = NOW()
         WHERE id = ? AND status IN ('QUEUED', 'FAILED')`,
        [msg.id]
      );

      if (claimResult.affectedRows === 0) continue; // Claimed by peer worker

      let payload = {};
      try {
        payload = typeof msg.payload_json === 'string' ? JSON.parse(msg.payload_json) : (msg.payload_json || {});
      } catch (e) {
        payload = {};
      }

      const { text, html } = this._renderTemplate(msg.template_name, payload);

      try {
        const sendResult = await this.transporter.sendMail({
          from: this.emailFrom,
          to: msg.recipient_email,
          subject: msg.subject,
          text,
          html
        });

        await db.query(
          `UPDATE transactional_email_outbox
           SET status = 'PROVIDER_ACCEPTED',
               provider_message_id = ?,
               sent_at = NOW(),
               last_error = NULL
           WHERE id = ?`,
          [sendResult.messageId || null, msg.id]
        );
        succeeded++;
      } catch (sendErr) {
        await db.query(
          `UPDATE transactional_email_outbox
           SET status = 'FAILED',
               last_error = ?
           WHERE id = ?`,
          [sendErr.message, msg.id]
        );
        failed++;
      }
    }

    return {
      processed: messages.length,
      succeeded,
      failed
    };
  }

  /**
   * Verify mail transport readiness and sandbox isolation.
   * Returns inspection metadata without leaking secret tokens.
   */
  verifyMailTransportConfiguration() {
    const isMock = this.emailMode === 'mock' || (process.env.NODE_ENV === 'test' && !process.env.FORCE_REAL_EMAIL);
    const isMailtrapSandbox = (this.emailMode === 'sandbox' || this.emailMode === 'mailtrap_sandbox');
    const isLiveMailtrap = (this.emailMode === 'live' || this.emailMode === 'mailtrap_live') && Boolean(this.mailtrapApiToken);
    const isSmtpConfigured = Boolean(this.smtpHost && this.smtpUser && this.smtpPass);

    const isAuthorizedForExternalDelivery = !isMock && !isMailtrapSandbox && (isLiveMailtrap || isSmtpConfigured);

    return {
      emailMode: this.emailMode,
      isConfigured: this.isConfigured,
      isSandbox: isMailtrapSandbox || isMock,
      isAuthorizedForExternalDelivery,
      fromAddress: this.emailFrom,
      missingProductionKeys: isAuthorizedForExternalDelivery ? [] : [
        ...(isSmtpConfigured ? [] : ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']),
        ...((this.mailtrapApiToken && !isMailtrapSandbox) ? [] : ['TRANSACTIONAL_EMAIL_MODE=live (or verified SMTP provider)'])
      ]
    };
  }

  /**
   * Sanitized serialization prevents inadvertent secret exposure in logs or JSON serialization
   */
  toJSON() {
    return {
      emailFrom: this.emailFrom,
      emailMode: this.emailMode,
      isConfigured: this.isConfigured,
      smtpHost: this.smtpHost,
      smtpPort: this.smtpPort
    };
  }
}

module.exports = new EmailService();
