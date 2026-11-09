// =============================================================================
// src/services/googleAuthService.js
// MilJor Part 4E.10: Google Identity Services & OpenID Connect Foundation
//
// Core Security Principles:
// 1. Authoritative Server-Side Token Verification (google-auth-library)
// 2. Cryptographic Signature, Issuer, Audience & Expiration Validation
// 3. Stable External Identity Anchor: Google 'sub' (Never use email alone)
// 4. Zero Account Takeover: No automatic linking of existing accounts solely by email
// 5. Explicit Authenticated Linking with Ownership Proof
// 6. Role Safety: New Google accounts strictly default to BUYER (No auto SUPPLIER/ADMIN)
// 7. Sanitized Session Issuance: Standard MilJor HS256 JWT (No Google tokens in payload)
// =============================================================================

const { OAuth2Client } = require('google-auth-library');
const db = require('../config/db');

class GoogleAuthService {
  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID || null;
    this.isEnabled = process.env.GOOGLE_AUTH_ENABLED !== 'false' && Boolean(process.env.GOOGLE_CLIENT_ID);
    this.client = this.clientId ? new OAuth2Client(this.clientId) : new OAuth2Client();
  }

  /**
   * Verify Google ID token against trusted Google public certificates.
   *
   * @param {string} idToken - The raw Google credential/id_token
   * @param {Object} [options] - Verification options
   * @param {Object} [options.mockPayload] - Strictly for isolated test environments
   * @returns {Promise<Object>} Verified payload { sub, email, email_verified, name, picture }
   */
  async verifyIdToken(idToken, options = {}) {
    if (!idToken || typeof idToken !== 'string') {
      const err = new Error('Google ID token is required');
      err.code = 'INVALID_TOKEN';
      err.statusCode = 400;
      throw err;
    }

    // Isolated test hook strictly restricted to test environments
    if (process.env.NODE_ENV === 'test' && options.mockPayload) {
      const mock = options.mockPayload;
      if (mock.invalid_signature) {
        const err = new Error('Invalid Google token signature');
        err.code = 'INVALID_SIGNATURE';
        err.statusCode = 401;
        throw err;
      }
      if (mock.wrong_audience) {
        const err = new Error('Token audience mismatch');
        err.code = 'AUDIENCE_MISMATCH';
        err.statusCode = 401;
        throw err;
      }
      if (mock.wrong_issuer) {
        const err = new Error('Token issuer mismatch');
        err.code = 'ISSUER_MISMATCH';
        err.statusCode = 401;
        throw err;
      }
      if (mock.expired) {
        const err = new Error('Google token has expired');
        err.code = 'TOKEN_EXPIRED';
        err.statusCode = 401;
        throw err;
      }
      if (!mock.sub) {
        const err = new Error('Token missing subject identifier (sub)');
        err.code = 'MALFORMED_TOKEN';
        err.statusCode = 400;
        throw err;
      }
      return {
        sub: mock.sub,
        email: mock.email,
        email_verified: Boolean(mock.email_verified),
        name: mock.name || 'Google User',
        picture: mock.picture || null
      };
    }

    if (!this.clientId) {
      const err = new Error('Google OAuth is not configured on this server (GOOGLE_CLIENT_ID missing)');
      err.code = 'GOOGLE_AUTH_NOT_CONFIGURED';
      err.statusCode = 503;
      throw err;
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId
      });

      const payload = ticket.getPayload();
      if (!payload) {
        const err = new Error('Invalid Google token payload');
        err.code = 'MALFORMED_TOKEN';
        err.statusCode = 400;
        throw err;
      }

      // Explicit issuer verification
      const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
      if (!validIssuers.includes(payload.iss)) {
        const err = new Error(`Invalid Google token issuer: ${payload.iss}`);
        err.code = 'ISSUER_MISMATCH';
        err.statusCode = 401;
        throw err;
      }

      return {
        sub: payload.sub,
        email: payload.email,
        email_verified: Boolean(payload.email_verified),
        name: payload.name || 'Google User',
        picture: payload.picture || null
      };
    } catch (err) {
      if (err.statusCode) throw err;
      const error = new Error(`Google authentication failed: ${err.message}`);
      error.code = 'GOOGLE_VERIFICATION_FAILED';
      error.statusCode = 401;
      throw error;
    }
  }

  /**
   * Authenticate or safely onboard a user using a verified Google ID token.
   *
   * @param {Object} params
   * @param {string} params.idToken - Google ID token
   * @param {Object} [params.options] - Test or verification options
   * @returns {Promise<Object>} { user, isNewUser, requiresLinking }
   */
  async authenticateGoogleUser({ idToken, options = {} }) {
    const verified = await this.verifyIdToken(idToken, options);
    const googleSub = verified.sub;
    const email = verified.email ? verified.email.toLowerCase().trim() : null;

    // Enforce email verification by Google
    if (!verified.email_verified || !email) {
      const err = new Error('Google account email is not verified by Google. Cannot authenticate.');
      err.code = 'EMAIL_NOT_VERIFIED';
      err.statusCode = 403;
      throw err;
    }

    // 1. Check if user with this google_id already exists
    const [existingGoogleUsers] = await db.query(
      'SELECT * FROM users WHERE google_id = ?',
      [googleSub]
    );

    if (existingGoogleUsers.length > 0) {
      const user = existingGoogleUsers[0];

      // Enforce account suspension checks
      if (user.verification_status === 'BLOCKED' || user.buyer_trust_status === 'SUSPENDED') {
        const err = new Error('Your account has been suspended or blocked. Please contact support.');
        err.code = 'ACCOUNT_SUSPENDED';
        err.statusCode = 403;
        throw err;
      }

      return {
        user,
        isNewUser: false,
        requiresLinking: false
      };
    }

    // 2. Check if a local account with this email exists (without google_id linked)
    const [existingEmailUsers] = await db.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (existingEmailUsers.length > 0) {
      const existingUser = existingEmailUsers[0];

      // Anti-Account-Takeover Rule: Do NOT auto-link. Require explicit authentication proof!
      const err = new Error(
        'An account with this email already exists. To connect your Google account, please log in with your password and link Google in Account Settings.'
      );
      err.code = 'ACCOUNT_LINKING_REQUIRED';
      err.statusCode = 409;
      err.data = { email, existingUserId: existingUser.id };
      throw err;
    }

    // 3. New User Onboarding via Google — Strictly creates BUYER accounts
    // Concurrency-Safe: Catches race condition duplicate inserts on unique google_id
    let newUserId;
    try {
      const [insertResult] = await db.query(
        `INSERT INTO users
          (full_name, email, google_id, role, business_type, city, verification_status, is_verified, buyer_trust_status)
         VALUES (?, ?, ?, 'BUYER', 'General', 'Lahore', 'EMAIL_VERIFIED', 0, 'CONTACT_VERIFIED')`,
        [verified.name || 'Google Buyer', email, googleSub]
      );
      newUserId = insertResult.insertId;

      // Audit log
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'SYSTEM', 'USER_REGISTERED_GOOGLE', 'users', ?, ?)`,
        [newUserId, newUserId, JSON.stringify({ email, google_sub: googleSub, role: 'BUYER' })]
      );
    } catch (insertErr) {
      if (insertErr.code === 'ER_DUP_ENTRY') {
        // Concurrent onboarding detected: Fetch and return the newly created user
        const [racedUsers] = await db.query('SELECT * FROM users WHERE google_id = ?', [googleSub]);
        if (racedUsers.length > 0) {
          return {
            user: racedUsers[0],
            isNewUser: false,
            requiresLinking: false
          };
        }
      }
      throw insertErr;
    }

    const [newUsers] = await db.query('SELECT * FROM users WHERE id = ?', [newUserId]);

    return {
      user: newUsers[0],
      isNewUser: true,
      requiresLinking: false
    };
  }

  /**
   * Explicitly link an authenticated local user account to a verified Google account.
   *
   * @param {Object} params
   * @param {number} params.userId - Authenticated user ID
   * @param {string} params.idToken - Google ID token
   * @param {Object} [params.options] - Test or verification options
   * @returns {Promise<Object>} Updated user profile
   */
  async linkGoogleAccount({ userId, idToken, options = {} }) {
    // Verify target user status first
    const [targetUsers] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (targetUsers.length === 0) {
      const err = new Error('User not found');
      err.code = 'USER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const targetUser = targetUsers[0];
    if (targetUser.verification_status === 'BLOCKED' || targetUser.buyer_trust_status === 'SUSPENDED') {
      const err = new Error('Suspended or blocked accounts cannot link Google credentials.');
      err.code = 'ACCOUNT_SUSPENDED';
      err.statusCode = 403;
      throw err;
    }

    const verified = await this.verifyIdToken(idToken, options);
    const googleSub = verified.sub;

    // Check if this Google sub is already linked to ANOTHER user
    const [existing] = await db.query(
      'SELECT id FROM users WHERE google_id = ? AND id != ?',
      [googleSub, userId]
    );

    if (existing.length > 0) {
      const err = new Error('This Google account is already linked to another MilJor user.');
      err.code = 'GOOGLE_ACCOUNT_ALREADY_LINKED';
      err.statusCode = 409;
      throw err;
    }

    // Update user record transactionally
    await db.query(
      'UPDATE users SET google_id = ? WHERE id = ?',
      [googleSub, userId]
    );

    // Audit log
    await db.query(
      `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
       VALUES (?, 'BUYER', 'GOOGLE_ACCOUNT_LINKED', 'users', ?, ?)`,
      [userId, userId, JSON.stringify({ google_sub: googleSub })]
    );

    const [updatedUsers] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    return updatedUsers[0];
  }

  /**
   * Safely unlink Google account from user profile.
   * Enforces that the user must retain at least one usable authentication method (password).
   *
   * @param {Object} params
   * @param {number} params.userId - Authenticated user ID
   * @returns {Promise<Object>} Updated user profile
   */
  async unlinkGoogleAccount({ userId }) {
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      const err = new Error('User not found');
      err.code = 'USER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const user = users[0];
    if (!user.google_id) {
      const err = new Error('No Google account is currently linked.');
      err.code = 'NO_LINKED_ACCOUNT';
      err.statusCode = 400;
      throw err;
    }

    // Safety Invariant: Prevent locking user out of their account!
    if (!user.password_hash) {
      const err = new Error('Cannot unlink Google account without first setting a password.');
      err.code = 'PASSWORD_REQUIRED_BEFORE_UNLINK';
      err.statusCode = 400;
      throw err;
    }

    await db.query('UPDATE users SET google_id = NULL WHERE id = ?', [userId]);

    await db.query(
      `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
       VALUES (?, ?, 'GOOGLE_ACCOUNT_UNLINKED', 'users', ?)`,
      [userId, user.role, userId]
    );

    const [updatedUsers] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    return updatedUsers[0];
  }

  /**
   * Sanitized serialization prevents inadvertent secret exposure in logs or JSON serialization
   */
  toJSON() {
    return {
      clientId: this.clientId,
      isEnabled: this.isEnabled
    };
  }
}

module.exports = new GoogleAuthService();
