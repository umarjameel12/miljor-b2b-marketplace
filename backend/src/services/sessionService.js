// =============================================================================
// src/services/sessionService.js
// MilJor Enterprise Session Management, Persistent Tokens & Revocation Service
// Security Architecture:
//   - Cryptographically random opaque refresh tokens (256-bit entropy)
//   - SHA-256 hashed storage (raw tokens never stored in MySQL)
//   - Strict token rotation on every /refresh request
//   - Family lineage tracking with automatic replay detection & family invalidation
//   - Absolute maximum 30-day lifetime for persistent "Remember Me" sessions
//   - Non-persistent browser sessions (8h max, session-only cookies)
//   - Real-time session revocation check in authGuard
//   - Concurrency tolerance (15-second grace window for in-flight rotated tokens)
// =============================================================================
const crypto = require('crypto');
const db = require('../config/db');

// Session Lifetimes (in milliseconds)
const PERSISTENT_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days
const NON_PERSISTENT_ABSOLUTE_LIFETIME_MS = 8 * 60 * 60 * 1000;   // 8 Hours
const PERSISTENT_IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;      // 7 Days
const NON_PERSISTENT_IDLE_LIFETIME_MS = 2 * 60 * 60 * 1000;       // 2 Hours
const CONCURRENCY_GRACE_WINDOW_MS = 15 * 1000;                     // 15 Seconds

class SessionService {

  // Hash opaque refresh token using SHA-256
  hashToken(rawToken) {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  // Generate cryptographically secure random token (64 hex characters)
  generateRawToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // ---------------------------------------------------------------------------
  // Create a new session and initial refresh token
  // ---------------------------------------------------------------------------
  async createSession({ userId, rememberMe = false, userAgent = null, ipAddress = null }) {
    const isPersistent = Boolean(rememberMe);
    const sessionId = crypto.randomUUID();
    const sessionFamilyId = crypto.randomUUID();

    const now = new Date();
    const absoluteLifetimeMs = isPersistent ? PERSISTENT_ABSOLUTE_LIFETIME_MS : NON_PERSISTENT_ABSOLUTE_LIFETIME_MS;
    const idleLifetimeMs = isPersistent ? PERSISTENT_IDLE_LIFETIME_MS : NON_PERSISTENT_IDLE_LIFETIME_MS;

    const absoluteExpiresAt = new Date(now.getTime() + absoluteLifetimeMs);
    const idleExpiresAt = new Date(now.getTime() + idleLifetimeMs);

    // 1. Insert user session record
    await db.query(
      `INSERT INTO user_sessions (
        session_id, user_id, session_family_id, is_persistent,
        idle_expires_at, absolute_expires_at, user_agent, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        userId,
        sessionFamilyId,
        isPersistent,
        idleExpiresAt,
        absoluteExpiresAt,
        userAgent ? userAgent.substring(0, 255) : null,
        ipAddress ? ipAddress.substring(0, 45) : null
      ]
    );

    // 2. Generate initial refresh token
    const rawRefreshToken = this.generateRawToken();
    const tokenHash = this.hashToken(rawRefreshToken);

    await db.query(
      `INSERT INTO user_refresh_tokens (
        session_id, token_hash, expires_at
      ) VALUES (?, ?, ?)`,
      [sessionId, tokenHash, idleExpiresAt]
    );

    return {
      sessionId,
      sessionFamilyId,
      rawRefreshToken,
      isPersistent,
      absoluteExpiresAt
    };
  }

  // ---------------------------------------------------------------------------
  // Rotate refresh token with atomic replay detection
  // ---------------------------------------------------------------------------
  async rotateRefreshToken({ rawToken, userAgent = null, ipAddress = null }) {
    if (!rawToken || typeof rawToken !== 'string') {
      return { success: false, code: 'INVALID_TOKEN', message: 'No refresh token provided.' };
    }

    const tokenHash = this.hashToken(rawToken);

    // Query token record joined with session and user
    const [rows] = await db.query(
      `SELECT
        rt.id as token_id, rt.session_id, rt.token_hash, rt.expires_at,
        rt.consumed_at, rt.revoked_at as token_revoked_at, rt.replacement_token_id,
        s.user_id, s.session_family_id, s.is_persistent, s.idle_expires_at,
        s.absolute_expires_at, s.revoked_at as session_revoked_at,
        u.email, u.phone, u.role, u.verification_status, u.buyer_trust_status, u.is_verified
       FROM user_refresh_tokens rt
       JOIN user_sessions s ON rt.session_id = s.session_id
       JOIN users u ON s.user_id = u.id
       WHERE rt.token_hash = ?`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return { success: false, code: 'INVALID_TOKEN', message: 'Invalid or unknown refresh token.' };
    }

    const record = rows[0];
    const now = new Date();

    // 1. Check Replay / Token Theft: Was this token already consumed?
    if (record.consumed_at !== null) {
      const consumedTime = new Date(record.consumed_at).getTime();
      const elapsedSinceConsumed = now.getTime() - consumedTime;

      // Gate 10: A consumed token must NEVER grant fresh authentication credentials.
      // If submitted within the concurrency grace window (15s), inform caller of rotation
      // without terminating the family. The client uses the already-rotated token or active session.
      if (elapsedSinceConsumed <= CONCURRENCY_GRACE_WINDOW_MS && record.replacement_token_id) {
        return {
          success: false,
          code: 'TOKEN_ALREADY_ROTATED',
          message: 'Refresh token was already rotated by a concurrent request. Please use active session.'
        };
      }

      // Replay outside grace window detected — Compromise response: Invalidate entire session family
      await db.query(
        `UPDATE user_sessions
         SET revoked_at = NOW(), revocation_reason = 'TOKEN_REUSE_DETECTED'
         WHERE session_family_id = ? AND revoked_at IS NULL`,
        [record.session_family_id]
      );

      await db.query(
        `UPDATE user_refresh_tokens rt
         JOIN user_sessions s ON rt.session_id = s.session_id
         SET rt.revoked_at = NOW()
         WHERE s.session_family_id = ? AND rt.revoked_at IS NULL`,
        [record.session_family_id]
      );

      return {
        success: false,
        code: 'TOKEN_REUSE_DETECTED',
        message: 'Security warning: Refresh token reuse detected. All sessions in this family have been terminated.'
      };
    }

    // 2. Check if token or session is explicitly revoked
    if (record.token_revoked_at !== null || record.session_revoked_at !== null) {
      return { success: false, code: 'SESSION_REVOKED', message: 'Session has been revoked.' };
    }

    // 3. Check absolute session expiration (Hard 30-day ceiling for persistent sessions)
    if (now > new Date(record.absolute_expires_at)) {
      await this.revokeSession(record.session_id, 'ABSOLUTE_LIFETIME_EXPIRED');
      return { success: false, code: 'SESSION_EXPIRED', message: 'Session has reached its maximum lifetime. Please sign in again.' };
    }

    // 4. Check user account status
    if (record.verification_status === 'BLOCKED' || record.buyer_trust_status === 'SUSPENDED') {
      await this.revokeSession(record.session_id, 'ACCOUNT_SUSPENDED');
      return { success: false, code: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended or blocked.' };
    }

    // 5. Generate NEW rotating refresh token
    const newRawRefreshToken = this.generateRawToken();
    const newTokenHash = this.hashToken(newRawRefreshToken);

    const isPersistent = Boolean(record.is_persistent);
    const idleLifetimeMs = isPersistent ? PERSISTENT_IDLE_LIFETIME_MS : NON_PERSISTENT_IDLE_LIFETIME_MS;
    const newIdleExpiresAt = new Date(Math.min(
      now.getTime() + idleLifetimeMs,
      new Date(record.absolute_expires_at).getTime()
    ));

    // Insert new token
    const [insertResult] = await db.query(
      `INSERT INTO user_refresh_tokens (
        session_id, token_hash, expires_at
      ) VALUES (?, ?, ?)`,
      [record.session_id, newTokenHash, newIdleExpiresAt]
    );

    const newTokenId = insertResult.insertId;

    // Mark previous token as consumed
    await db.query(
      `UPDATE user_refresh_tokens
       SET consumed_at = NOW(), replacement_token_id = ?
       WHERE id = ?`,
      [newTokenId, record.token_id]
    );

    // Update session last seen
    await db.query(
      `UPDATE user_sessions
       SET last_seen_at = NOW(),
           idle_expires_at = ?,
           user_agent = COALESCE(?, user_agent),
           ip_address = COALESCE(?, ip_address)
       WHERE session_id = ?`,
      [
        newIdleExpiresAt,
        userAgent ? userAgent.substring(0, 255) : null,
        ipAddress ? ipAddress.substring(0, 45) : null,
        record.session_id
      ]
    );

    return {
      success: true,
      sessionId: record.session_id,
      newRawRefreshToken,
      user: {
        id: record.user_id,
        email: record.email,
        phone: record.phone,
        role: record.role,
        verification_status: record.verification_status,
        buyer_trust_status: record.buyer_trust_status,
        is_verified: Boolean(record.is_verified)
      },
      isPersistent,
      absoluteExpiresAt: record.absolute_expires_at
    };
  }

  // ---------------------------------------------------------------------------
  // Check if session is active, unrevoked, and matches user ownership (used by authGuard)
  // ---------------------------------------------------------------------------
  async isSessionActive(sessionId, userId = null) {
    if (!sessionId) return false;

    const [rows] = await db.query(
      `SELECT id, user_id, revoked_at, absolute_expires_at
       FROM user_sessions
       WHERE session_id = ?`,
      [sessionId]
    );

    if (rows.length === 0) return false;
    const session = rows[0];

    // Gate 9: Verify user ownership matches session binding
    if (userId !== null && Number(session.user_id) !== Number(userId)) {
      return false;
    }

    if (session.revoked_at !== null) return false;
    if (new Date() > new Date(session.absolute_expires_at)) return false;

    return true;
  }

  // ---------------------------------------------------------------------------
  // Revoke single session (Explicit logout)
  // ---------------------------------------------------------------------------
  async revokeSession(sessionId, reason = 'LOGOUT') {
    if (!sessionId) return;

    await db.query(
      `UPDATE user_sessions
       SET revoked_at = NOW(), revocation_reason = ?
       WHERE session_id = ? AND revoked_at IS NULL`,
      [reason, sessionId]
    );

    await db.query(
      `UPDATE user_refresh_tokens
       SET revoked_at = NOW()
       WHERE session_id = ? AND revoked_at IS NULL`,
      [sessionId]
    );
  }

  // ---------------------------------------------------------------------------
  // Revoke all sessions for a user (Password reset / Account suspension)
  // Supports optional transactional executor/connection for atomic commit
  // ---------------------------------------------------------------------------
  async revokeAllUserSessions(userId, reason = 'PASSWORD_RESET', executor = null) {
    if (!userId) return;
    const client = executor || db;

    await client.query(
      `UPDATE user_sessions
       SET revoked_at = NOW(), revocation_reason = ?
       WHERE user_id = ? AND revoked_at IS NULL`,
      [reason, userId]
    );

    await client.query(
      `UPDATE user_refresh_tokens rt
       JOIN user_sessions s ON rt.session_id = s.session_id
       SET rt.revoked_at = NOW()
       WHERE s.user_id = ? AND rt.revoked_at IS NULL`,
      [userId]
    );
  }

  // ---------------------------------------------------------------------------
  // Cookie Helpers
  // ---------------------------------------------------------------------------
  setRefreshCookie(res, rawToken, isPersistent, absoluteExpiresAt) {
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/api/v1/auth'
    };

    if (isPersistent && absoluteExpiresAt) {
      const remainingMs = Math.max(0, new Date(absoluteExpiresAt).getTime() - Date.now());
      cookieOptions.maxAge = remainingMs;
    }
    // If not persistent, cookieOptions has no maxAge/expires, rendering it a browser session cookie

    res.cookie('miljor_refresh', rawToken, cookieOptions);
  }

  clearRefreshCookie(res) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('miljor_refresh', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/api/v1/auth'
    });
  }

  parseCookies(req) {
    const list = {};
    const cookieHeader = req.headers?.cookie;
    if (!cookieHeader) return list;

    cookieHeader.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const name = parts.shift().trim();
      if (name) {
        list[name] = decodeURIComponent(parts.join('='));
      }
    });
    return list;
  }
}

module.exports = new SessionService();
