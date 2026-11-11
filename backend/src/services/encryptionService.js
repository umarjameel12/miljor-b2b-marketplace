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
   * Parses and validates a 256-bit (32-byte) key string.
   * For non-test environments, requires high-entropy 256-bit key material:
   *   - 64-character hex string (32 bytes)
   *   - 44-character base64 string decoding to 32 bytes
   *   - Exact 32-byte UTF-8 key material with sufficient character diversity
   * Arbitrary-length passphrases are rejected for new encryption unless legacy derivation is explicitly requested for decryption.
   */
  _parseKeyMaterial(rawKey, { allowLegacyPassphraseDerivation = false } = {}) {
    if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      return null;
    }

    const cleanKey = rawKey.trim();

    // 1. Hex key (64 hex characters = 32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
      const buf = Buffer.from(cleanKey, 'hex');
      const uniqueBytes = new Set(buf).size;
      if (uniqueBytes < 8) {
        const err = new Error('Encryption key material has insufficient entropy (trivial repeating pattern)');
        err.code = 'WEAK_ENCRYPTION_KEY';
        throw err;
      }
      return buf;
    }

    // 2. Base64 key (44 characters ending with '=' encoding 32 bytes)
    if (/^[A-Za-z0-9+/]{43}=$/.test(cleanKey)) {
      const buf = Buffer.from(cleanKey, 'base64');
      if (buf.length === 32) {
        const uniqueBytes = new Set(buf).size;
        if (uniqueBytes < 8) {
          const err = new Error('Encryption key material has insufficient entropy (trivial repeating pattern)');
          err.code = 'WEAK_ENCRYPTION_KEY';
          throw err;
        }
        return buf;
      }
    }

    // 3. Exact 32-byte raw UTF-8 string with high entropy
    if (Buffer.byteLength(cleanKey, 'utf8') === 32) {
      const buf = Buffer.from(cleanKey, 'utf8');
      const uniqueBytes = new Set(buf).size;
      if (uniqueBytes < 8) {
        const err = new Error('Encryption key material has insufficient entropy (trivial repeating pattern)');
        err.code = 'WEAK_ENCRYPTION_KEY';
        throw err;
      }
      return buf;
    }

    // 4. Backward compatibility for decrypting previously encrypted records ONLY when explicitly enabled
    if (allowLegacyPassphraseDerivation) {
      return crypto.createHash('sha256').update(cleanKey, 'utf8').digest();
    }

    const err = new Error(
      'Invalid BANK_DATA_ENCRYPTION_KEY format. Non-test environments require high-entropy 256-bit key material (64-char hex, 44-char base64, or 32-byte key); arbitrary passphrases are prohibited.'
    );
    err.code = 'WEAK_ENCRYPTION_KEY';
    throw err;
  }

  /**
   * Retrieves the authoritative 32-byte (256-bit) encryption key for active encryption
   */
  getEncryptionKey() {
    const rawKey = process.env.BANK_DATA_ENCRYPTION_KEY;

    if (rawKey && rawKey.trim().length > 0) {
      return this._parseKeyMaterial(rawKey, { allowLegacyPassphraseDerivation: false });
    }

    // In isolated test environments ONLY when no custom key is supplied, provide deterministic 32-byte key
    if (process.env.NODE_ENV === 'test') {
      return crypto.createHash('sha256').update('miljor_test_bank_key_32_bytes').digest();
    }

    // In local development, provide a fallback key derived from JWT_SECRET or dev seed so unconfigured dev setups don't crash
    if (process.env.NODE_ENV === 'development') {
      const devSeed = process.env.JWT_SECRET || 'miljor_dev_bank_encryption_seed_2026';
      return crypto.createHash('sha256').update(devSeed).digest();
    }

    return null;
  }

  /**
   * Retrieves candidate 32-byte keys for decryption (supports primary key + legacy rotation/derivation fallback)
   */
  getDecryptionCandidateKeys() {
    const candidates = [];
    const rawKey = process.env.BANK_DATA_ENCRYPTION_KEY;

    if (rawKey && rawKey.trim().length > 0) {
      try {
        const strictKey = this._parseKeyMaterial(rawKey, { allowLegacyPassphraseDerivation: false });
        if (strictKey) candidates.push(strictKey);
      } catch (err) {
        if (process.env.ALLOW_LEGACY_KEY_DERIVATION === 'true') {
          const derived = this._parseKeyMaterial(rawKey, { allowLegacyPassphraseDerivation: true });
          if (derived) candidates.push(derived);
        } else {
          throw err;
        }
      }
    } else if (process.env.NODE_ENV === 'test') {
      candidates.push(crypto.createHash('sha256').update('miljor_test_bank_key_32_bytes').digest());
    } else if (process.env.NODE_ENV === 'development') {
      const devSeed = process.env.JWT_SECRET || 'miljor_dev_bank_encryption_seed_2026';
      candidates.push(crypto.createHash('sha256').update(devSeed).digest());
    }

    // Optional legacy key for non-destructive key rotation reads
    const legacyRawKey = process.env.BANK_DATA_LEGACY_ENCRYPTION_KEY;
    if (legacyRawKey && legacyRawKey.trim().length > 0) {
      const legacyBuf = this._parseKeyMaterial(legacyRawKey, { allowLegacyPassphraseDerivation: true });
      if (legacyBuf) candidates.push(legacyBuf);
    }

    return candidates;
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
   * Checks whether encryption at rest is configured with valid key material in the current environment
   */
  isConfigured() {
    try {
      return this.getEncryptionKey() !== null;
    } catch {
      return false;
    }
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

    const candidateKeys = this.getDecryptionCandidateKeys();
    if (!candidateKeys || candidateKeys.length === 0) {
      const err = new Error('Sensitive data encryption key (BANK_DATA_ENCRYPTION_KEY) is not configured in environment');
      err.code = 'ENCRYPTION_KEY_NOT_CONFIGURED';
      throw err;
    }

    const iv = Buffer.from(hexIv, 'hex');
    const authTag = Buffer.from(hexTag, 'hex');

    for (const key of candidateKeys) {
      try {
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(authTag);

        let plaintext = decipher.update(hexCiphertext, 'hex', 'utf8');
        plaintext += decipher.final('utf8');

        return plaintext;
      } catch {
        // Try next candidate key if rotation fallback is configured
      }
    }

    const err = new Error('Cryptographic decryption failed: ciphertext corrupted or authentication tag mismatch');
    err.code = 'DECRYPTION_FAILED';
    throw err;
  }
}

module.exports = new EncryptionService();
