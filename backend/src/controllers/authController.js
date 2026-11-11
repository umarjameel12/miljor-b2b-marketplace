// =============================================================================
// src/controllers/authController.js
// MilJor Authentication & Session Management
// Security Enhancements:
//   - Password complexity validation (min 8 chars, 1 letter, 1 number)
//   - Pakistani/standard phone format validation
//   - Generic error messages preventing user enumeration
//   - Strict BUYER assignment on public registration (role injection blocked)
//   - Standard JWT claims (issuer: 'miljor-api', audience: 'miljor-app')
//   - Active account suspension check on login
//   - Logout endpoint with audit footprint
// =============================================================================
const db = require('../config/db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../middlewares/authGuard');
const googleAuthService = require('../services/googleAuthService');
const emailService = require('../services/emailService');
const sessionService = require('../services/sessionService');

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ACCESS_EXPIRES_IN = '15m'; // Phase 6C: Short-lived access token (15 minutes)
const JWT_LEGACY_EXPIRES_IN = '7d';

// Sign short-lived access token with sid session binding
const signAccessToken = (payload) => jwt.sign(payload, JWT_SECRET, {
  expiresIn: JWT_ACCESS_EXPIRES_IN,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  algorithm: 'HS256'
});

// Legacy signing fallback
const signToken = (payload) => jwt.sign(payload, JWT_SECRET, {
  expiresIn: payload.sid ? JWT_ACCESS_EXPIRES_IN : JWT_LEGACY_EXPIRES_IN,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  algorithm: 'HS256'
});

// =============================================================================
// Atomic Database-Backed Cross-Worker Cooldown Reservations (FIX 1)
// Enforces exactly one accepted reset request per normalized identity per 60s
// Uses row-level lock (FOR UPDATE) on auth_cooldown_reservations
// =============================================================================
const COOLDOWN_KEY = process.env.COOLDOWN_SALT || process.env.JWT_SECRET || 'miljor_cooldown_identity_salt_2026';

const computeCooldownIdentityHash = (normalizedEmail) => {
  return crypto.createHmac('sha256', COOLDOWN_KEY).update(`cooldown:${normalizedEmail}`).digest('hex');
};

const reserveCooldown = async (identityHash, purpose = 'PASSWORD_RESET', cooldownSeconds = 60) => {
  let connection = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT id, cooldown_until, (cooldown_until > NOW()) AS is_active
         FROM auth_cooldown_reservations
         WHERE identity_hash = ? AND purpose = ?
         FOR UPDATE`,
        [identityHash, purpose]
      );

      if (rows.length === 0) {
        try {
          await connection.query(
            `INSERT INTO auth_cooldown_reservations (identity_hash, purpose, cooldown_until)
             VALUES (?, ?, NOW() + INTERVAL ? SECOND)`,
            [identityHash, purpose, cooldownSeconds]
          );
          await connection.commit();
          return { admitted: true };
        } catch (insertErr) {
          if (insertErr.code === 'ER_DUP_ENTRY') {
            await connection.rollback();
            connection.release();
            connection = null;
            continue;
          }
          throw insertErr;
        }
      }

      const reservation = rows[0];
      if (reservation.is_active) {
        await connection.rollback();
        return { admitted: false };
      }

      // Expired cooldown: renew reservation atomically
      await connection.query(
        `UPDATE auth_cooldown_reservations
         SET cooldown_until = NOW() + INTERVAL ? SECOND
         WHERE id = ?`,
        [cooldownSeconds, reservation.id]
      );
      await connection.commit();
      return { admitted: true };

    } catch (err) {
      if (connection) {
        try { await connection.rollback(); } catch (_) {}
      }
      if ((err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') && attempt < maxRetries) {
        if (connection) {
          connection.release();
          connection = null;
        }
        await new Promise(r => setTimeout(r, 20 * (attempt + 1)));
        continue;
      }
      // Fail closed: if shared store is unavailable, throw so request fails closed
      throw err;
    } finally {
      if (connection) {
        connection.release();
        connection = null;
      }
    }
  }

  return { admitted: false };
};

// Helper: Sanitize user response (never leak password_hash)
const safeUser = (user, extra = {}) => ({
  id: user.id,
  full_name: user.full_name,
  business_name: user.business_name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  verification_status: user.verification_status,
  buyer_trust_status: user.buyer_trust_status,
  is_verified: Boolean(user.is_verified),
  google_linked: Boolean(user.google_id),
  city: user.city,
  area: user.area,
  base_cluster_id: user.base_cluster_id !== undefined ? user.base_cluster_id : null,
  created_at: user.created_at,
  has_delivery_address: extra.has_delivery_address !== undefined
    ? extra.has_delivery_address
    : (extra.requires_address !== undefined ? !extra.requires_address : false),
  business_onboarding_complete: extra.business_onboarding_complete !== undefined
    ? extra.business_onboarding_complete
    : (user.role === 'BUYER' ? Boolean(user.base_cluster_id) : Boolean(user.business_name && (user.business_type || extra.supplier_profile))),
  requires_base_cluster: Boolean(user.role === 'BUYER' && !user.base_cluster_id),
  requires_address: extra.requires_address !== undefined ? extra.requires_address : false,
  onboarding_flags: {
    authenticated: true,
    base_cluster_configured: Boolean(user.base_cluster_id),
    delivery_address_available: extra.has_delivery_address !== undefined
      ? Boolean(extra.has_delivery_address)
      : (extra.requires_address !== undefined ? !extra.requires_address : false)
  }
});

class AuthController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/register
  // Public Buyer Registration — Strictly creates BUYER accounts
  // ---------------------------------------------------------------------------
  async register(req, res) {
    try {
      const {
        full_name,
        business_name,
        email,
        phone,
        password,
        role: requestedRole,
        city = 'Lahore',
        base_cluster_id,
        cluster_id,
        society_area,
        area,
        address,
        full_address,
        pin_latitude,
        pin_longitude
      } = req.body;

      // 1. Password Complexity Validation
      if (!password || password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Password must be at least 8 characters long and contain both letters and numbers'
          }
        });
      }

      // 2. Identity Contact Validation
      if (!email && !phone) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Either email address or phone number is required' }
        });
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' }
        });
      }

      if (phone && !/^[0-9+]{10,15}$/.test(phone.replace(/[\s-]/g, ''))) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid phone number format. Must contain 10-15 digits.' }
        });
      }

      const cleanPhone = phone ? phone.replace(/[\s-]/g, '') : null;

      // 3. Strict Public Registration Role Validation (Phase 6D.2)
      // Only explicitly approved public roles may register: 'BUYER' or 'SUPPLIER'.
      // If omitted (undefined, null, or empty string), default to 'BUYER' for backwards compatibility.
      let assignedRole = 'BUYER';
      if (requestedRole !== undefined && requestedRole !== null && requestedRole !== '') {
        if (typeof requestedRole !== 'string') {
          return res.status(422).json({
            success: false,
            error: {
              code: 'INVALID_REGISTRATION_ROLE',
              message: "Invalid registration role. Role must be a string and is restricted to 'BUYER' or 'SUPPLIER'."
            }
          });
        }
        const normalizedRole = requestedRole.trim().toUpperCase();
        if (normalizedRole === 'BUYER' || normalizedRole === 'SUPPLIER') {
          assignedRole = normalizedRole;
        } else {
          return res.status(422).json({
            success: false,
            error: {
              code: 'INVALID_REGISTRATION_ROLE',
              message: `Invalid registration role '${requestedRole}'. Public registration is strictly restricted to 'BUYER' or 'SUPPLIER'. Privileged roles cannot be self-assigned.`
            }
          });
        }
      }

      // 4. Lahore District Boundary Enforcement (Absolute Launch Rule)
      if (city && city.trim().toLowerCase() !== 'lahore') {
        return res.status(422).json({
          success: false,
          error: {
            code: 'OUTSIDE_LAHORE_DISTRICT',
            message: 'MilJor currently operates exclusively within Lahore District, Punjab. Registrations from other cities or districts are not supported.'
          }
        });
      }

      // 5. Uniqueness Check (Short-circuits duplicate registrations with 409 USER_EXISTS)
      const [existing] = await db.query(
        'SELECT id FROM users WHERE (email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?)',
        [email || null, cleanPhone || null]
      );

      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: { code: 'USER_EXISTS', message: 'An account with this email or phone number already exists' }
        });
      }

      // 6. Cluster & Location Validation (Phase 6D.3)
      if (
        base_cluster_id !== undefined && base_cluster_id !== null && base_cluster_id !== '' &&
        cluster_id !== undefined && cluster_id !== null && cluster_id !== '' &&
        Number(base_cluster_id) !== Number(cluster_id)
      ) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'CLUSTER_MISMATCH',
            message: 'Contradictory cluster identifiers provided (base_cluster_id does not match cluster_id).'
          }
        });
      }

      const effectiveClusterId = (base_cluster_id !== undefined && base_cluster_id !== null && base_cluster_id !== '')
        ? Number(base_cluster_id)
        : ((cluster_id !== undefined && cluster_id !== null && cluster_id !== '') ? Number(cluster_id) : null);

      if (assignedRole === 'BUYER' && !effectiveClusterId) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'BASE_CLUSTER_REQUIRED',
            message: 'A valid Lahore base cluster is required for buyer registration.'
          }
        });
      }

      let cluster = null;
      if (effectiveClusterId !== null) {
        const [clusterRows] = await db.query(
          'SELECT * FROM geographic_clusters WHERE id = ? AND is_active = 1',
          [Number(effectiveClusterId)]
        );
        if (clusterRows.length === 0) {
          return res.status(422).json({
            success: false,
            error: {
              code: 'INVALID_CLUSTER',
              message: 'Selected delivery cluster is inactive or does not exist.'
            }
          });
        }
        cluster = clusterRows[0];
        if (cluster.district && cluster.district.toLowerCase() !== 'lahore') {
          return res.status(422).json({
            success: false,
            error: {
              code: 'OUTSIDE_LAHORE_DISTRICT',
              message: 'The selected cluster does not belong to Lahore District.'
            }
          });
        }
      }

      // Context-aware boundary parsing for free-text area/address
      const effectiveArea = society_area || area;
      const effectiveAddress = full_address || address;

      const hasArea = Boolean(effectiveArea && String(effectiveArea).trim().length > 0);
      const hasAddressText = Boolean(effectiveAddress && String(effectiveAddress).trim().length > 0);

      // Incomplete address check: If either is provided, both are required to form a valid initial address
      if ((hasArea && !hasAddressText) || (!hasArea && hasAddressText)) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'INCOMPLETE_ADDRESS',
            message: 'Both society/area and complete address must be provided if voluntarily supplying a delivery address.'
          }
        });
      }

      const OUTSIDE_DISTRICTS = ['kasur', 'kot radha kishan', 'pattoki', 'sheikhupura', 'muridke', 'ferozewala', 'nankana sahib', 'okara', 'gujranwala', 'chunian'];
      const ROAD_SUFFIX_REGEX = /\b(road|rd|highway|expressway|bypass)\b/i;
      const BIZ_SUFFIX_REGEX = /\b(traders|trading|store|stores|shop|sweets|foods|feed|mills|mill|enterprises|enterprise|corp|corporation)\b/i;

      function isRoadContext(text, kw) {
        const pattern = new RegExp(`(?:main\\s+)?${kw}\\s+${ROAD_SUFFIX_REGEX.source}|${ROAD_SUFFIX_REGEX.source}\\s+(?:of\\s+)?${kw}`, 'i');
        return pattern.test(text);
      }

      function isBusinessContext(text, kw) {
        const pattern = new RegExp(`(?:main\\s+)?${kw}\\s+${BIZ_SUFFIX_REGEX.source}|${BIZ_SUFFIX_REGEX.source}\\s+(?:of\\s+)?${kw}`, 'i');
        return pattern.test(text);
      }

      if (hasArea) {
        const cleanAreaLower = effectiveArea.trim().toLowerCase();
        for (const outKw of OUTSIDE_DISTRICTS) {
          const exactKwRegex = new RegExp(`(^|\\b|\\s|,)${outKw}(\\b|\\s|,|$)`, 'i');
          if (exactKwRegex.test(cleanAreaLower) && !isRoadContext(cleanAreaLower, outKw)) {
            return res.status(422).json({
              success: false,
              error: {
                code: 'OUTSIDE_LAHORE_DISTRICT',
                message: `Location '${outKw}' belongs outside Lahore District. MilJor service is strictly restricted to Lahore District.`
              }
            });
          }
        }
      }

      if (hasAddressText) {
        const cleanAddressLower = effectiveAddress.trim().toLowerCase();
        for (const outKw of OUTSIDE_DISTRICTS) {
          const outsideCityRegex = new RegExp(`\\b${outKw}\\s+(city|town|mandi|district)\\b|\\b(city|town|mandi)\\s+${outKw}\\b`, 'i');
          if (outsideCityRegex.test(cleanAddressLower) && !isRoadContext(cleanAddressLower, outKw) && !isBusinessContext(cleanAddressLower, outKw)) {
            return res.status(422).json({
              success: false,
              error: {
                code: 'OUTSIDE_LAHORE_DISTRICT',
                message: `Location '${outKw}' belongs outside Lahore District. MilJor service is strictly restricted to Lahore District.`
              }
            });
          }
        }
      }

      // 7. Secure Bcrypt Password Hash (12 rounds)
      const passwordHash = await bcrypt.hash(password, 12);

      // 8. Atomic Database Insertion (User + Profile + Initial Address)
      const connection = await db.getConnection();
      await connection.beginTransaction();

      let userId;
      let hasCreatedAddress = false;
      try {
        const [result] = await connection.query(
          `INSERT INTO users
            (full_name, business_name, email, phone, password_hash, role, business_type, city, area, address, base_cluster_id, verification_status, is_verified)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Lahore', ?, ?, ?, 'UNVERIFIED', 0)`,
          [
            full_name || null,
            business_name || null,
            email || null,
            cleanPhone,
            passwordHash,
            assignedRole,
            assignedRole === 'SUPPLIER' ? 'Wholesale Supplier' : 'Commercial Food Buyer',
            cluster ? cluster.name : (hasArea ? effectiveArea : 'Lahore — Gulberg & Central'),
            hasAddressText ? effectiveAddress : null,
            cluster ? cluster.id : null
          ]
        );

        userId = result.insertId;

        // Role-Specific Profile & Address Setup (Voluntary address only)
        if (assignedRole === 'BUYER' && cluster && hasArea && hasAddressText) {
          await connection.query(
            `INSERT INTO buyer_delivery_addresses
              (user_id, city, cluster_id, cluster_version, society_area, full_address, pin_latitude, pin_longitude, geographic_match_status, user_confirmation_status, business_verification_status, manual_review_required, is_default)
             VALUES (?, 'Lahore', ?, ?, ?, ?, ?, ?, 'PROVISIONAL', 'CONFIRMED', 'NOT_REQUIRED', 0, 1)`,
            [
              userId,
              cluster.id,
              cluster.version || 1,
              effectiveArea.trim(),
              effectiveAddress.trim(),
              pin_latitude ? Number(pin_latitude) : null,
              pin_longitude ? Number(pin_longitude) : null
            ]
          );
          hasCreatedAddress = true;
        } else if (assignedRole === 'SUPPLIER') {
          // Initialize default supplier profile
          await connection.query(
            `INSERT INTO supplier_profiles
              (supplier_id, verification_level, verification_status, subscription_plan, max_active_listings, transaction_fee_percent)
             VALUES (?, 'LEVEL_1_CONTACT', 'NOT_SUBMITTED', 'STARTER', 5, 2.50)`,
            [userId]
          );

          // Initialize default supplier delivery configuration (Phase 6D.2: Draft state with 0 modes enabled)
          await connection.query(
            `INSERT INTO supplier_delivery_configurations
              (supplier_id, standard_delivery_enabled, pickup_enabled, express_enabled, express_cutoff_time, express_fulfillment_hours, version)
             VALUES (?, 0, 0, 0, '14:00:00', 4, 1)`,
            [userId]
          );
        }

        // 9. Audit Trail
        await connection.query(
          `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
           VALUES (?, 'SYSTEM', 'USER_REGISTERED', 'users', ?, ?)`,
          [userId, userId, JSON.stringify({ email, phone: cleanPhone, role: assignedRole, city: 'Lahore', base_cluster_id: cluster ? cluster.id : null, has_address: hasCreatedAddress })]
        );

        await connection.commit();
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }

      // 10. Issue Session Token
      const token = signToken({ id: userId, email: email || null, phone: cleanPhone, role: assignedRole });

      return res.status(201).json({
        success: true,
        message: 'Account created successfully. Welcome to MilJor!',
        data: {
          token,
          user: safeUser({
            id: userId,
            full_name: full_name || null,
            business_name: business_name || null,
            email: email || null,
            phone: cleanPhone,
            role: assignedRole,
            city: 'Lahore',
            area: cluster ? cluster.name : (hasArea ? effectiveArea : 'Lahore — Gulberg & Central'),
            address: hasAddressText ? effectiveAddress : null,
            base_cluster_id: cluster ? cluster.id : null,
            verification_status: 'UNVERIFIED',
            is_verified: false
          }, {
            requires_address: !hasCreatedAddress,
            has_delivery_address: hasCreatedAddress
          })
        }
      });

    } catch (error) {
      console.error('Register Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Registration failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/login
  // Authenticates buyer, supplier, or admin with generic error responses
  // ---------------------------------------------------------------------------
  async login(req, res) {
    try {
      const { identifier, password, rememberMe } = req.body;

      if (!identifier || !password) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Email/phone and password are required' }
        });
      }

      const cleanIdentifier = identifier.trim();

      const [users] = await db.query(
        'SELECT * FROM users WHERE email = ? OR phone = ?',
        [cleanIdentifier, cleanIdentifier]
      );

      // Generic authentication failure — prevents user enumeration
      const genericAuthError = {
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email/phone or password' }
      };

      if (users.length === 0) {
        return res.status(401).json(genericAuthError);
      }

      const user = users[0];

      if (!user.password_hash) {
        return res.status(401).json(genericAuthError);
      }

      // Check account suspension / blocking
      if (user.verification_status === 'BLOCKED' || user.buyer_trust_status === 'SUSPENDED') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCOUNT_SUSPENDED',
            message: 'Your account has been suspended or blocked. Please contact MilJor support.'
          }
        });
      }

      // Verify bcrypt password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        return res.status(401).json(genericAuthError);
      }

      // Gate 8: Prevent session fixation & isolate previous browser session
      const existingCookies = sessionService.parseCookies(req);
      if (existingCookies.miljor_refresh) {
        const oldHash = sessionService.hashToken(existingCookies.miljor_refresh);
        const [oldRows] = await db.query('SELECT session_id FROM user_refresh_tokens WHERE token_hash = ?', [oldHash]);
        if (oldRows.length > 0) {
          await sessionService.revokeSession(oldRows[0].session_id, 'SESSION_REPLACED_ON_LOGIN');
        }
      }

      // Phase 6C: Create backend session with persistent/session policy
      const session = await sessionService.createSession({
        userId: user.id,
        rememberMe: Boolean(rememberMe),
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });

      // Sign short-lived access JWT bound to session sid
      const token = signAccessToken({
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        sid: session.sessionId
      });

      // Issue HttpOnly refresh token cookie
      sessionService.setRefreshCookie(
        res,
        session.rawRefreshToken,
        session.isPersistent,
        session.absoluteExpiresAt
      );

      // Audit login
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
         VALUES (?, ?, 'USER_LOGIN', 'users', ?)`,
        [user.id, user.role, user.id]
      );

      return res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: safeUser(user)
        }
      });

    } catch (error) {
      console.error('Login Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Login failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/auth/me  (Protected)
  // Returns authenticated user's profile and supplier metadata if applicable
  // ---------------------------------------------------------------------------
  async getMe(req, res) {
    try {
      const [users] = await db.query(
        `SELECT id, full_name, business_name, email, phone, role, business_type,
                city, area, address, base_cluster_id, verification_status, buyer_trust_status,
                is_verified, created_at, updated_at
         FROM users WHERE id = ?`,
        [req.user.id]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User account not found' }
        });
      }

      const user = users[0];

      let supplierProfile = null;
      let requiresAddress = false;
      let buyerAddresses = [];
      if (user.role === 'SUPPLIER') {
        const [profiles] = await db.query(
          'SELECT * FROM supplier_profiles WHERE supplier_id = ?',
          [user.id]
        );
        supplierProfile = profiles[0] || null;
      } else if (user.role === 'BUYER') {
        const [addrRows] = await db.query(
          'SELECT id, cluster_id, society_area, full_address, is_default FROM buyer_delivery_addresses WHERE user_id = ?',
          [user.id]
        );
        buyerAddresses = addrRows;
        requiresAddress = addrRows.length === 0;
      }

      return res.status(200).json({
        success: true,
        data: {
          user: safeUser(user, {
            requires_address: requiresAddress,
            has_delivery_address: buyerAddresses.length > 0,
            business_onboarding_complete: user.role === 'BUYER' ? Boolean(user.base_cluster_id) : Boolean(user.business_name && supplierProfile)
          }),
          supplier_profile: supplierProfile,
          delivery_address_count: buyerAddresses.length
        }
      });

    } catch (error) {
      console.error('GetMe Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Could not fetch profile.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/supplier/apply  (Protected — BUYER only)
  // Buyer applies for supplier status
  // ---------------------------------------------------------------------------
  async applyForSupplier(req, res) {
    try {
      const userId = req.user.id;
      const { business_name, area, address, tax_ntn, food_license_no } = req.body;

      if (req.user.role !== 'BUYER') {
        return res.status(409).json({
          success: false,
          error: { code: 'ALREADY_SUPPLIER', message: 'Your account is already a supplier or admin account' }
        });
      }

      const [existing] = await db.query(
        'SELECT id FROM supplier_profiles WHERE supplier_id = ?',
        [userId]
      );
      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: { code: 'APPLICATION_EXISTS', message: 'You have already submitted a supplier application' }
        });
      }

      // Update user details
      await db.query(
        `UPDATE users
         SET business_name = COALESCE(?, business_name),
             area = COALESCE(?, area),
             address = COALESCE(?, address),
             verification_status = 'PENDING_SUPPLIER_VERIFICATION'
         WHERE id = ?`,
        [business_name || null, area || null, address || null, userId]
      );

      // Create initial supplier profile
      await db.query(
        `INSERT INTO supplier_profiles
          (supplier_id, verification_level, verification_status, subscription_plan, tax_ntn, food_license_no)
         VALUES (?, 'LEVEL_1_CONTACT', 'PENDING_REVIEW', 'STARTER', ?, ?)`,
        [userId, tax_ntn || null, food_license_no || null]
      );

      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
         VALUES (?, 'BUYER', 'SUPPLIER_APPLICATION_SUBMITTED', 'supplier_profiles', ?)`,
        [userId, userId]
      );

      return res.status(201).json({
        success: true,
        message: 'Supplier application submitted successfully. Verification team will review within 2 business days.',
        data: { verification_status: 'PENDING_REVIEW' }
      });

    } catch (error) {
      console.error('Supplier Apply Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Application failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/refresh (Public with HttpOnly Cookie)
  // Rotates refresh token & returns fresh short-lived access token
  // ---------------------------------------------------------------------------
  async refresh(req, res) {
    try {
      const cookies = sessionService.parseCookies(req);
      const rawRefreshToken = cookies.miljor_refresh;

      if (!rawRefreshToken) {
        return res.status(401).json({
          success: false,
          error: { code: 'NO_REFRESH_TOKEN', message: 'No active session or refresh token found.' }
        });
      }

      const result = await sessionService.rotateRefreshToken({
        rawToken: rawRefreshToken,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });

      if (!result.success) {
        // Same-browser concurrent refresh during the 15s rotation grace
        // is NOT a stolen/replayed session. Never delete the legitimate
        // replacement cookie merely because an older in-flight request lost
        // this race. True theft/reuse outside grace still revokes and clears.
        const concurrentGrace = result.code === 'TOKEN_ALREADY_ROTATED';
        if (!concurrentGrace) sessionService.clearRefreshCookie(res);
        return res.status(concurrentGrace ? 409 : 401).json({
          success: false,
          error: { code: result.code || 'REFRESH_FAILED', message: result.message }
        });
      }

      // New access token
      const token = signAccessToken({
        id: result.user.id,
        email: result.user.email,
        phone: result.user.phone,
        role: result.user.role,
        sid: result.sessionId
      });

      // Set rotated refresh cookie with preserved absolute expiration
      sessionService.setRefreshCookie(
        res,
        result.newRawRefreshToken,
        result.isPersistent,
        result.absoluteExpiresAt
      );

      return res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          token,
          user: safeUser(result.user)
        }
      });

    } catch (error) {
      console.error('Refresh Error:', error);
      sessionService.clearRefreshCookie(res);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Session refresh failed.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/logout  (Protected / Session Termination)
  // Client session revocation & cookie destruction
  // ---------------------------------------------------------------------------
  async logout(req, res) {
    try {
      // 1. Invalidate session in database
      if (req.user?.sessionId) {
        await sessionService.revokeSession(req.user.sessionId, 'LOGOUT');
      } else {
        // Fallback: check refresh cookie to identify session if token was unparseable
        const cookies = sessionService.parseCookies(req);
        if (cookies.miljor_refresh) {
          const tokenHash = sessionService.hashToken(cookies.miljor_refresh);
          const [rtRows] = await db.query('SELECT session_id FROM user_refresh_tokens WHERE token_hash = ?', [tokenHash]);
          if (rtRows.length > 0) {
            await sessionService.revokeSession(rtRows[0].session_id, 'LOGOUT');
          }
        }
      }

      // 2. Clear HttpOnly refresh cookie
      sessionService.clearRefreshCookie(res);

      // 3. Write audit log if user was identified
      if (req.user?.id) {
        await db.query(
          `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
           VALUES (?, ?, 'USER_LOGOUT', 'users', ?)`,
          [req.user.id, req.user.role, req.user.id]
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Logged out successfully.'
      });
    } catch (error) {
      sessionService.clearRefreshCookie(res);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/google (Public)
  // Authenticates or safely onboards a user via Google ID Token
  // Enforces Google double-submit cookie CSRF defense when g_csrf_token is provided
  // ---------------------------------------------------------------------------
  async googleAuth(req, res) {
    try {
      const { id_token, credential, g_csrf_token } = req.body || {};
      const tokenToVerify = id_token || credential;

      if (!tokenToVerify) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Google ID token (id_token or credential) is required' }
        });
      }

      // Google Identity Services (GSI) CSRF Protection:
      // When submitted via browser redirect/One Tap POST, g_csrf_token double-submit token is required
      if (g_csrf_token) {
        const cookieHeader = req.headers.cookie || '';
        let cookieCsrfToken = null;
        for (const cookie of cookieHeader.split(';')) {
          const parts = cookie.trim().split('=');
          if (parts[0] === 'g_csrf_token') {
            cookieCsrfToken = decodeURIComponent(parts.slice(1).join('='));
            break;
          }
        }
        if (!cookieCsrfToken && req.headers['x-g-csrf-token']) {
          cookieCsrfToken = req.headers['x-g-csrf-token'];
        }

        if (
          !cookieCsrfToken ||
          Buffer.byteLength(cookieCsrfToken) !== Buffer.byteLength(g_csrf_token) ||
          !crypto.timingSafeEqual(Buffer.from(cookieCsrfToken), Buffer.from(g_csrf_token))
        ) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'CSRF_TOKEN_MISMATCH',
              message: 'Failed Google CSRF double-submit token verification'
            }
          });
        }
      }

      // Check test hooks if in test environment
      let options = {};
      if (process.env.NODE_ENV === 'test' && req.testHooks?.mockGooglePayload) {
        options.mockPayload = req.testHooks.mockGooglePayload;
      }

      const { user, isNewUser } = await googleAuthService.authenticateGoogleUser({
        idToken: tokenToVerify,
        options
      });

      // Gate 8: Prevent session fixation on Google authentication
      const existingCookies = sessionService.parseCookies(req);
      if (existingCookies.miljor_refresh) {
        const oldHash = sessionService.hashToken(existingCookies.miljor_refresh);
        const [oldRows] = await db.query('SELECT session_id FROM user_refresh_tokens WHERE token_hash = ?', [oldHash]);
        if (oldRows.length > 0) {
          await sessionService.revokeSession(oldRows[0].session_id, 'SESSION_REPLACED_ON_GOOGLE_AUTH');
        }
      }

      // Phase 6C: Create session for Google-authenticated user
      const rememberMe = Boolean(req.body?.rememberMe);
      const session = await sessionService.createSession({
        userId: user.id,
        rememberMe,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      });

      const token = signAccessToken({
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        sid: session.sessionId
      });

      sessionService.setRefreshCookie(
        res,
        session.rawRefreshToken,
        session.isPersistent,
        session.absoluteExpiresAt
      );

      return res.status(200).json({
        success: true,
        message: isNewUser ? 'Google account onboarded successfully.' : 'Google login successful.',
        data: {
          token,
          user: safeUser(user),
          is_new_user: isNewUser
        }
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'VALIDATION_ERROR' ? 400 :
        err.code === 'INVALID_TOKEN' || err.code === 'MALFORMED_TOKEN' ? 400 :
        err.code === 'INVALID_SIGNATURE' || err.code === 'AUDIENCE_MISMATCH' || err.code === 'ISSUER_MISMATCH' || err.code === 'TOKEN_EXPIRED' || err.code === 'GOOGLE_VERIFICATION_FAILED' ? 401 :
        err.code === 'ACCOUNT_SUSPENDED' || err.code === 'EMAIL_NOT_VERIFIED' ? 403 :
        err.code === 'ACCOUNT_LINKING_REQUIRED' ? 409 :
        err.code === 'GOOGLE_AUTH_NOT_CONFIGURED' ? 503 : 500
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'GOOGLE_AUTH_FAILED',
          message: err.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/google/link (Protected)
  // Explicitly links authenticated user's account to a Google account
  // ---------------------------------------------------------------------------
  async googleLink(req, res) {
    try {
      const { id_token, credential } = req.body || {};
      const tokenToVerify = id_token || credential;

      if (!tokenToVerify) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Google ID token is required' }
        });
      }

      let options = {};
      if (process.env.NODE_ENV === 'test' && req.testHooks?.mockGooglePayload) {
        options.mockPayload = req.testHooks.mockGooglePayload;
      }

      const updatedUser = await googleAuthService.linkGoogleAccount({
        userId: req.user.id,
        idToken: tokenToVerify,
        options
      });

      return res.status(200).json({
        success: true,
        message: 'Google account linked successfully.',
        data: {
          user: safeUser(updatedUser)
        }
      });
    } catch (err) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'LINKING_FAILED',
          message: err.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/google/unlink (Protected)
  // Safely unlinks Google account from user's profile
  // ---------------------------------------------------------------------------
  async googleUnlink(req, res) {
    try {
      const updatedUser = await googleAuthService.unlinkGoogleAccount({
        userId: req.user.id
      });

      return res.status(200).json({
        success: true,
        message: 'Google account unlinked successfully.',
        data: {
          user: safeUser(updatedUser)
        }
      });
    } catch (err) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'UNLINKING_FAILED',
          message: err.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/verify-email (Protected / Public with email+otp)
  // Verifies email address using single-use OTP
  // ---------------------------------------------------------------------------
  async verifyEmail(req, res) {
    try {
      const { otp, email } = req.body || {};
      let userId = req.user ? req.user.id : null;

      if (!userId && email) {
        const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
        if (users.length > 0) userId = users[0].id;
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'User identity or email is required' }
        });
      }

      await emailService.verifyAndConsumeOtp({
        userId,
        otp,
        purpose: 'REGISTRATION_VERIFY'
      });

      // Update user verification status
      await db.query(
        `UPDATE users
         SET verification_status = 'EMAIL_VERIFIED',
             is_verified = CASE WHEN role = 'BUYER' THEN 1 ELSE is_verified END
         WHERE id = ?`,
        [userId]
      );

      // Audit log
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
         VALUES (?, 'BUYER', 'EMAIL_VERIFIED', 'users', ?)`,
        [userId, userId]
      );

      return res.status(200).json({
        success: true,
        message: 'Email address verified successfully.'
      });
    } catch (err) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'VERIFICATION_FAILED',
          message: err.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/resend-otp (Protected / Public with email)
  // Requests a fresh email OTP with rate limiting
  // ---------------------------------------------------------------------------
  async resendOtp(req, res) {
    try {
      const { email } = req.body || {};
      let user = null;

      if (req.user) {
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        user = users[0];
      } else if (email) {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
        user = users[0];
      }

      if (!user || !user.email) {
        // Return generic success to avoid email enumeration
        return res.status(200).json({
          success: true,
          message: 'If the account exists, a new verification code has been dispatched.'
        });
      }

      const result = await emailService.createAndSendOtp({
        userId: user.id,
        email: user.email,
        userName: user.full_name,
        purpose: 'REGISTRATION_VERIFY'
      });

      return res.status(200).json({
        success: true,
        message: 'Verification code sent to your email address.',
        data: result
      });
    } catch (err) {
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'RESEND_FAILED',
          message: err.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/request-password-reset (Public)
  // Initiates password reset flow with zero account enumeration & timing attack defense
  // ---------------------------------------------------------------------------
  async requestPasswordReset(req, res) {
    try {
      const { email } = req.body || {};
      if (!email || !email.includes('@')) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Valid email address is required' }
        });
      }

      const cleanEmail = email.toLowerCase().trim();

      // 1. Privacy-preserving keyed digest for identity
      const identityHash = computeCooldownIdentityHash(cleanEmail);

      // 2. Database-backed atomic cross-worker cooldown reservation
      // Row-locks auth_cooldown_reservations so simultaneous worker requests cannot race
      // Fails closed if store is unavailable
      const { admitted } = await reserveCooldown(identityHash, 'PASSWORD_RESET', 60);

      if (!admitted) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Please wait at least 60 seconds before requesting another verification code.'
          }
        });
      }

      // 3. Sanitized security audit log (decoupled from concurrency lock)
      try {
        await db.query(
          `INSERT INTO system_audit_logs (actor_role, action, entity_name, new_value, ip_address, user_agent)
           VALUES ('PUBLIC', 'PASSWORD_RESET_REQUESTED', 'auth_password_reset', JSON_OBJECT('identity_hash', ?), ?, ?)`,
          [identityHash, req.ip || null, (req.headers['user-agent'] || '').slice(0, 255)]
        );
      } catch (auditErr) {
        // Non-fatal audit log catch
      }

      const [users] = await db.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);

      if (users.length > 0 && users[0].verification_status !== 'BLOCKED' && users[0].buyer_trust_status !== 'SUSPENDED') {
        const user = users[0];
        try {
          await emailService.createAndSendOtp({
            userId: user.id,
            email: user.email,
            userName: user.full_name,
            purpose: 'PASSWORD_RESET'
          });
        } catch (mailErr) {
          if (mailErr.statusCode === 429) {
            return res.status(429).json({
              success: false,
              error: { code: 'RATE_LIMITED', message: mailErr.message }
            });
          }
          // Log mail error securely without leaking to client
          console.error('[AUTH] Failed to send password reset email:', mailErr.message);
        }
      } else {
        // Timing mitigation: perform dummy HMAC operation to match execution profile
        crypto.createHmac('sha256', emailService.otpHmacSecret).update(`${cleanEmail}:timing_dummy`).digest('hex');
      }

      // Always return generic 200 to prevent user enumeration
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email address, a password reset code has been sent.'
      });
    } catch (err) {
      console.error('[AUTH] requestPasswordReset unexpected error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Password reset request failed.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/auth/reset-password (Public)
  // Validates OTP and updates password in a single atomic database transaction
  // Enforces row locking, durable attempt counter, full session revocation
  // ---------------------------------------------------------------------------
  async resetPassword(req, res) {
    let connection = null;
    try {
      const { email, otp, new_password } = req.body || {};

      if (!email || !otp || !new_password) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Email, OTP code, and new password are required' }
        });
      }

      // Password complexity check
      if (new_password.length < 8 || !/[a-zA-Z]/.test(new_password) || !/[0-9]/.test(new_password)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Password must be at least 8 characters long and contain both letters and numbers'
          }
        });
      }

      const cleanEmail = email.toLowerCase().trim();
      const [users] = await db.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);

      if (users.length === 0) {
        // Equalize timing profile with constant-time dummy HMAC
        crypto.createHmac('sha256', emailService.otpHmacSecret).update(`${cleanEmail}:timing_dummy`).digest('hex');
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid or expired password reset request.' }
        });
      }

      const user = users[0];

      // Pre-compute 12-round bcrypt hash outside database transaction to avoid holding locks
      const passwordHash = await bcrypt.hash(new_password, 12);
      const isPasswordEstablishment = !user.password_hash;

      // Acquire dedicated connection for atomic verification + password update transaction
      connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // Row-lock latest unconsumed PASSWORD_RESET challenge
        const [challenges] = await connection.query(
          `SELECT id, email, otp_hash, expires_at, attempts_count, (expires_at <= NOW()) AS is_expired
           FROM email_verifications
           WHERE user_id = ? AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL
           ORDER BY id DESC LIMIT 1
           FOR UPDATE`,
          [user.id]
        );

        if (challenges.length === 0) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Invalid or expired password reset request.' }
          });
        }

        const challenge = challenges[0];

        // Expiry check
        if (challenge.is_expired) {
          await connection.rollback();
          return res.status(410).json({
            success: false,
            error: { code: 'OTP_EXPIRED', message: 'Verification code has expired. Please request a new code.' }
          });
        }

        // Brute-force check: max 5 attempts allowed
        if (challenge.attempts_count >= 5) {
          await connection.query('UPDATE email_verifications SET consumed_at = NOW() WHERE id = ?', [challenge.id]);
          await connection.commit();
          return res.status(429).json({
            success: false,
            error: {
              code: 'MAX_ATTEMPTS_EXCEEDED',
              message: 'Too many invalid attempts. Verification code invalidated. Please request a new code.'
            }
          });
        }

        // Increment durable attempts counter
        await connection.query(
          'UPDATE email_verifications SET attempts_count = attempts_count + 1 WHERE id = ?',
          [challenge.id]
        );

        // Verify OTP hash with constant-time equality
        const isMatch = emailService.verifyOtpHmac({
          otp,
          userId: user.id,
          email: challenge.email || user.email,
          purpose: 'PASSWORD_RESET',
          storedHash: challenge.otp_hash
        });

        if (!isMatch) {
          // Commit incremented attempts count so attempts are durable
          await connection.commit();
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_OTP', message: 'Invalid verification code. Please check and try again.' }
          });
        }

        // OTP is proven valid!
        // Enforce suspension check AFTER OTP verification: prevents attackers from probing account suspension status
        if (user.verification_status === 'BLOCKED' || user.buyer_trust_status === 'SUSPENDED') {
          // Burn the valid challenge so it cannot be reused
          await connection.query('UPDATE email_verifications SET consumed_at = NOW() WHERE id = ?', [challenge.id]);
          await connection.commit();
          return res.status(403).json({
            success: false,
            error: { code: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended or blocked. Cannot reset password.' }
          });
        }

        // Atomically burn the challenge
        const [consumeResult] = await connection.query(
          'UPDATE email_verifications SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL',
          [challenge.id]
        );

        if (consumeResult.affectedRows === 0) {
          await connection.rollback();
          return res.status(409).json({
            success: false,
            error: { code: 'OTP_ALREADY_CONSUMED', message: 'Verification code has already been consumed.' }
          });
        }

        // Atomically update user password hash
        const [userUpdateResult] = await connection.query(
          'UPDATE users SET password_hash = ? WHERE id = ?',
          [passwordHash, user.id]
        );

        if (userUpdateResult.affectedRows === 0) {
          await connection.rollback();
          return res.status(500).json({
            success: false,
            error: { code: 'UPDATE_FAILED', message: 'Failed to update user password.' }
          });
        }

        // Invalidate any other unconsumed password reset challenges for this user
        await connection.query(
          `UPDATE email_verifications
           SET consumed_at = NOW()
           WHERE user_id = ? AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL`,
          [user.id]
        );

        // Atomically invalidate all active sessions & refresh tokens in the SAME transaction
        await sessionService.revokeAllUserSessions(user.id, 'PASSWORD_RESET', connection);

        // Test hook (test environment only): simulate catastrophic failure after password update but before commit
        if (process.env.NODE_ENV === 'test' && (req.testHooks?.simulateFailureAfterPasswordUpdate || req.headers['x-simulate-failure'] === 'true')) {
          throw new Error('SIMULATED_TRANSACTION_FAILURE_BEFORE_COMMIT');
        }

        // Commit atomic transaction
        await connection.commit();
      } catch (txErr) {
        if (connection) {
          try { await connection.rollback(); } catch (_) {}
        }
        throw txErr;
      } finally {
        if (connection) {
          connection.release();
          connection = null;
        }
      }

      sessionService.clearRefreshCookie(res);

      // Audit log entry
      const auditAction = isPasswordEstablishment ? 'PASSWORD_ESTABLISHED_FOR_GOOGLE_USER' : 'PASSWORD_RESET_COMPLETED';
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id)
         VALUES (?, ?, ?, 'users', ?)`,
        [user.id, user.role, auditAction, user.id]
      );

      return res.status(200).json({
        success: true,
        message: 'Password reset successfully. You may now log in with your new credentials.'
      });
    } catch (err) {
      if (connection) {
        try { await connection.rollback(); } catch (_) {}
        connection.release();
        connection = null;
      }
      console.error('[AUTH] resetPassword unexpected error:', err);
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'RESET_FAILED',
          message: err.message || 'Password reset failed.'
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PATCH /api/v1/auth/base-cluster (Protected)
  // Sets or updates buyer base discovery cluster
  // ---------------------------------------------------------------------------
  async updateBaseCluster(req, res) {
    try {
      const userId = req.user.id;
      const { base_cluster_id } = req.body || {};

      if (base_cluster_id === undefined || base_cluster_id === null || isNaN(Number(base_cluster_id))) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'base_cluster_id must be a valid number' }
        });
      }

      const clusterId = Number(base_cluster_id);
      const [clusters] = await db.query(
        'SELECT * FROM geographic_clusters WHERE id = ? AND is_active = 1',
        [clusterId]
      );

      if (clusters.length === 0) {
        return res.status(422).json({
          success: false,
          error: { code: 'INVALID_CLUSTER', message: 'Selected cluster is inactive or does not exist.' }
        });
      }

      const cluster = clusters[0];
      if (cluster.district && cluster.district.toLowerCase() !== 'lahore') {
        return res.status(422).json({
          success: false,
          error: { code: 'OUTSIDE_LAHORE_DISTRICT', message: 'The selected cluster does not belong to Lahore District.' }
        });
      }

      await db.query(
        'UPDATE users SET base_cluster_id = ?, updated_at = NOW() WHERE id = ?',
        [clusterId, userId]
      );

      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, 'BASE_CLUSTER_UPDATED', 'users', ?, ?)`,
        [userId, req.user.role, userId, JSON.stringify({ base_cluster_id: clusterId, cluster_code: cluster.cluster_code })]
      );

      const [userRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
      const updatedUser = userRows[0];

      const [addrRows] = await db.query(
        'SELECT id FROM buyer_delivery_addresses WHERE user_id = ?',
        [userId]
      );

      return res.status(200).json({
        success: true,
        message: 'Base cluster updated successfully',
        data: {
          user: safeUser(updatedUser, {
            requires_address: addrRows.length === 0,
            has_delivery_address: addrRows.length > 0
          })
        }
      });
    } catch (error) {
      console.error('UpdateBaseCluster Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to update base cluster' }
      });
    }
  }
}

const authControllerInstance = new AuthController();
authControllerInstance.computeCooldownIdentityHash = computeCooldownIdentityHash;
authControllerInstance.reserveCooldown = reserveCooldown;
authControllerInstance._clearCooldownReservations = async (email = null) => {
  if (email) {
    const identityHash = computeCooldownIdentityHash(email.toLowerCase().trim());
    await db.query("DELETE FROM auth_cooldown_reservations WHERE identity_hash = ?", [identityHash]);
    await db.query("DELETE FROM system_audit_logs WHERE action = 'PASSWORD_RESET_REQUESTED'");
  } else {
    await db.query("DELETE FROM auth_cooldown_reservations");
    await db.query("DELETE FROM system_audit_logs WHERE action = 'PASSWORD_RESET_REQUESTED'");
  }
};
authControllerInstance._clearResetCooldownMap = authControllerInstance._clearCooldownReservations;
authControllerInstance._clearMemoryCooldownOnly = () => {};

module.exports = authControllerInstance;