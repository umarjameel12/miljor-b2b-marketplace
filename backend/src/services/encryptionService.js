// =============================================================================
// src/services/encryptionService.js
// MilJor Sensitive Data Protection: Authenticated AES-256-GCM Encryption at Rest
// Provides secure envelope encryption for sensitive banking and identity data
// =============================================================================
const crypto = require('crypto');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 12; // 96-bit standard nonce for AES-GCM
    this.tagLength = 16; // 128-bit authentication tag
  }

  /**
   * Retrieves the authoritative 32-byte (256-bit) encryption key
   */
  getEncryptionKey() {
    const rawKey = process.env.BANK_DATA_ENCRYPTION_KEY;

    if (rawKey && rawKey.trim().length > 0) {
      const cleanKey = rawKey.trim();
      // Hex key (64 hex characters)
      if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
        return Buffer.from(cleanKey, 'hex');
      }
      // Base64 key (44 characters)
      if (cleanKey.length === 44) {
        return Buffer.from(cleanKey, 'base64');
      }
      // Plain 32-byte string
      if (Buffer.byteLength(cleanKey, 'utf8') === 32) {
        return Buffer.from(cleanKey, 'utf8');
      }
      // Derive 32-byte key via SHA-256 if supplied string is arbitrary length
      return crypto.createHash('sha256').update(cleanKey, 'utf8').digest();
    }

    // In isolated test environments, provide a deterministic test key (32 bytes)
    if (process.env.NODE_ENV === 'test') {
      return crypto.createHash('sha256').update('miljor_test_bank_key_32_bytes').digest();
    }

    return null;
  }

  /**
   * Checks whether a value is stored in an encrypted envelope
   */
  isEncrypted(value) {
    return typeof value === 'string' && value.startsWith('v1:');
  }

  /**
   * Checks whether a value is unencrypted legacy plaintext
   */
  isLegacyPlaintext(value) {
    return typeof value === 'string' && value.length > 0 && !value.startsWith('v1:');
  }

  /**
   * Checks whether encryption at rest is configured in the current environment
   */
  isConfigured() {
    return this.getEncryptionKey() !== null;
  }

  /**
   * Encrypts plaintext data using AES-256-GCM with a unique nonce
   * Returns envelope: "v1:<hex-iv>:<hex-authTag>:<hex-ciphertext>"
   */
  encrypt(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') return null;

    const key = this.getEncryptionKey();
    if (!key) {
      const err = new Error('Sensitive data encryption key (BANK_DATA_ENCRYPTION_KEY) is not configured in environment');
      err.code = 'ENCRYPTION_KEY_NOT_CONFIGURED';
      throw err;
    }

    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
  }

  /**
   * Decrypts versioned ciphertext envelope.
   * Enforces fail-closed validation on malformed or tampered ciphertexts.
   * Normal runtime does NOT silently treat unencrypted legacy data as safely encrypted;
   * reading legacy plaintext requires explicit authorization ({ allowLegacy: true }).
   */
  decrypt(ciphertextEnvelope, options = {}) {
    if (!ciphertextEnvelope || typeof ciphertextEnvelope !== 'string') return null;

    // 1. Handle Unencrypted Legacy Data
    if (!ciphertextEnvelope.startsWith('v1:')) {
      if (options.allowLegacy === true) {
        return ciphertextEnvelope; // Explicitly authorized legacy read with preservation
      }
      const err = new Error('Unencrypted legacy banking data detected. Explicit authorization ({ allowLegacy: true }) is required to read legacy records.');
      err.code = 'UNENCRYPTED_LEGACY_DATA';
      throw err;
    }

    // 2. Validate Ciphertext Envelope Components (Fail Closed)
    const parts = ciphertextEnvelope.split(':');
    if (parts.length !== 4) {
      const err = new Error('Malformed encrypted ciphertext envelope');
      err.code = 'MALFORMED_CIPHERTEXT';
      throw err;
    }

    const [, hexIv, hexTag, hexCiphertext] = parts;

    // Verify IV length (12 bytes = 24 hex chars) and valid hex
    if (!hexIv || hexIv.length !== 24 || !/^[0-9a-fA-F]{24}$/.test(hexIv)) {
      const err = new Error('Malformed encrypted ciphertext envelope: invalid IV length or format');
      err.code = 'MALFORMED_CIPHERTEXT';
      throw err;
    }

    // Verify Auth Tag length (16 bytes = 32 hex chars) and valid hex
    if (!hexTag || hexTag.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hexTag)) {
      const err = new Error('Malformed encrypted ciphertext envelope: invalid auth tag length or format');
      err.code = 'MALFORMED_CIPHERTEXT';
      throw err;
    }

    // Verify Ciphertext non-empty and valid hex
    if (!hexCiphertext || hexCiphertext.length === 0 || !/^[0-9a-fA-F]+$/.test(hexCiphertext)) {
      const err = new Error('Malformed encrypted ciphertext envelope: invalid ciphertext payload');
      err.code = 'MALFORMED_CIPHERTEXT';
      throw err;
    }

    const key = this.getEncryptionKey();
    if (!key) {
      const err = new Error('Sensitive data encryption key (BANK_DATA_ENCRYPTION_KEY) is not configured in environment');
      err.code = 'ENCRYPTION_KEY_NOT_CONFIGURED';
      throw err;
    }

    try {
      const iv = Buffer.from(hexIv, 'hex');
      const authTag = Buffer.from(hexTag, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      let plaintext = decipher.update(hexCiphertext, 'hex', 'utf8');
      plaintext += decipher.final('utf8');

      return plaintext;
    } catch {
      const err = new Error('Cryptographic decryption failed: ciphertext corrupted or authentication tag mismatch');
      err.code = 'DECRYPTION_FAILED';
      throw err;
    }
  }
}

module.exports = new EncryptionService();
