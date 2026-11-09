// =============================================================================
// src/services/supplierValidationService.js
// MilJor Package E1: Validation Engine for Supplier Business Profile & Onboarding
// Implements strict validation for Pakistani Phone, Modulo-97 IBAN, NTN, and field sanitization
// =============================================================================

class SupplierValidationService {
  /**
   * Validates and normalizes a Pakistani mobile/landline number.
   * Accepts: +923001234567, 00923001234567, 923001234567, 03001234567
   * Returns: { valid: boolean, normalized: string|null, error: string|null }
   */
  validatePhone(phone) {
    if (!phone || typeof phone !== 'string') {
      return { valid: false, normalized: null, error: 'Phone number is required and must be a string' };
    }

    const clean = phone.replace(/[\s\-\(\)\.]/g, '');
    const pkPhoneRegex = /^((\+92)|(0092)|(92)|(0))?3[0-9]{9}$/;

    if (!pkPhoneRegex.test(clean)) {
      return { valid: false, normalized: null, error: 'Invalid Pakistani mobile phone number format (e.g. 03001234567 or +923001234567)' };
    }

    // Extract the 10 core digits starting with '3'
    const match = clean.match(/3[0-9]{9}$/);
    const normalized = `+92${match[0]}`;

    return { valid: true, normalized, error: null };
  }

  /**
   * Validates a Pakistani IBAN using ISO 7064 Modulo 97-10 check.
   * Structure: PK + 2 check digits + 4 character bank code + 16 account characters (24 chars total)
   */
  validateIban(iban) {
    if (!iban || typeof iban !== 'string') {
      return { valid: false, normalized: null, error: 'IBAN is required and must be a string' };
    }

    const clean = iban.replace(/[\s\-]/g, '').toUpperCase();

    // 1. Length and regex check
    if (clean.length !== 24) {
      return { valid: false, normalized: null, error: 'Pakistani IBAN must be exactly 24 characters long' };
    }

    const pkIbanRegex = /^PK[0-9]{2}[A-Z]{4}[0-9A-Z]{16}$/;
    if (!pkIbanRegex.test(clean)) {
      return { valid: false, normalized: null, error: 'Invalid Pakistani IBAN format (must start with PK followed by 2 digits, 4-letter bank code, and 16 account digits)' };
    }

    // 2. Modulo 97-10 Algorithm
    // Move the four initial characters to the end of the string
    const rearranged = clean.slice(4) + clean.slice(0, 4);

    // Replace letters with numbers: A=10, B=11 ... Z=35
    let numericString = '';
    for (let i = 0; i < rearranged.length; i++) {
      const code = rearranged.charCodeAt(i);
      if (code >= 65 && code <= 90) {
        numericString += (code - 55).toString();
      } else {
        numericString += rearranged[i];
      }
    }

    // BigInt modulo 97 check
    try {
      const remainder = BigInt(numericString) % 97n;
      if (remainder !== 1n) {
        return { valid: false, normalized: null, error: 'IBAN failed cryptographic checksum validation (invalid digits)' };
      }
    } catch {
      return { valid: false, normalized: null, error: 'IBAN calculation error' };
    }

    return { valid: true, normalized: clean, error: null };
  }

  /**
   * Masks a Pakistani IBAN for secure UI display.
   * Example: "PK36SCBL0000001123456702" -> "PK36 **** **** **** **** 6702"
   */
  maskIban(iban) {
    if (!iban || typeof iban !== 'string') return null;
    const clean = iban.replace(/[\s\-]/g, '').toUpperCase();
    if (clean.length < 8) return '****';
    const prefix = clean.slice(0, 4);
    const suffix = clean.slice(-4);
    return `${prefix} **** **** **** **** ${suffix}`;
  }

  /**
   * Validates Pakistani National Tax Number (NTN).
   * Formats: 1234567-8 or 12345678 (7 digits + 1 check digit)
   */
  validateNtn(ntn) {
    if (!ntn || typeof ntn !== 'string') {
      return { valid: false, normalized: null, error: 'NTN must be a valid string' };
    }

    const clean = ntn.trim();
    const ntnRegex = /^[0-9]{7}-?[0-9]{1}$/;

    if (!ntnRegex.test(clean)) {
      return { valid: false, normalized: null, error: 'Invalid Pakistani NTN format (must be 7 digits followed by 1 check digit, e.g. 1234567-8)' };
    }

    // Normalize to standard hyphenated format
    const digitsOnly = clean.replace('-', '');
    const normalized = `${digitsOnly.slice(0, 7)}-${digitsOnly.slice(7)}`;

    return { valid: true, normalized, error: null };
  }

  /**
   * Whitelist of permitted business types in MilJor B2B Lahore
   */
  getPermittedBusinessTypes() {
    return [
      'Wholesale Commodity Distributor',
      'Grain Miller & Processor',
      'Edible Oil Refinery / Packer',
      'Pulses & Legumes Wholesaler',
      'Direct Farm / Agricultural Producer',
      'Import / Export Food Trading Company',
      'Commercial Food Wholesaler'
    ];
  }

  /**
   * Validates profile update payload (Draft saving or final verification submission)
   */
  validateProfileData(data, isSubmission = false) {
    const errors = [];
    const sanitized = {};

    // 1. Business Name
    if (data.business_name !== undefined) {
      if (typeof data.business_name !== 'string' || data.business_name.trim().length < 2) {
        errors.push('Business name must be at least 2 characters');
      } else if (data.business_name.trim().length > 100) {
        errors.push('Business name cannot exceed 100 characters');
      } else {
        sanitized.business_name = data.business_name.trim();
      }
    } else if (isSubmission) {
      errors.push('Business name is required for verification submission');
    }

    // 2. Business Type
    if (data.business_type !== undefined && data.business_type !== null) {
      if (typeof data.business_type !== 'string' || data.business_type.trim().length === 0) {
        errors.push('Business type cannot be empty');
      } else {
        sanitized.business_type = data.business_type.trim();
      }
    } else if (isSubmission) {
      errors.push('Business type is required for verification submission');
    }

    // 3. Contact Person Name
    if (data.contact_person_name !== undefined && data.contact_person_name !== null) {
      if (typeof data.contact_person_name !== 'string' || data.contact_person_name.trim().length < 2) {
        errors.push('Contact person name must be at least 2 characters');
      } else if (data.contact_person_name.trim().length > 100) {
        errors.push('Contact person name cannot exceed 100 characters');
      } else {
        sanitized.contact_person_name = data.contact_person_name.trim();
      }
    } else if (isSubmission) {
      errors.push('Contact person name is required for verification submission');
    }

    // 4. Contact Person Phone
    if (data.contact_person_phone !== undefined && data.contact_person_phone !== null) {
      const phoneRes = this.validatePhone(data.contact_person_phone);
      if (!phoneRes.valid) {
        errors.push(phoneRes.error);
      } else {
        sanitized.contact_person_phone = phoneRes.normalized;
      }
    } else if (isSubmission) {
      errors.push('Contact person phone is required for verification submission');
    }

    // 5. Warehouse / Facility Address
    if (data.warehouse_address !== undefined && data.warehouse_address !== null) {
      if (typeof data.warehouse_address !== 'string' || data.warehouse_address.trim().length < 5) {
        errors.push('Warehouse address must be at least 5 characters');
      } else if (data.warehouse_address.trim().length > 500) {
        errors.push('Warehouse address cannot exceed 500 characters');
      } else {
        sanitized.warehouse_address = data.warehouse_address.trim();
      }
    } else if (isSubmission) {
      errors.push('Warehouse or dispatch facility address is required for verification submission');
    }

    // 6. Lahore Service Area
    if (data.lahore_service_area !== undefined && data.lahore_service_area !== null) {
      if (typeof data.lahore_service_area !== 'string' || data.lahore_service_area.trim().length < 3) {
        errors.push('Lahore service area must be specified');
      } else {
        sanitized.lahore_service_area = data.lahore_service_area.trim();
      }
    } else if (isSubmission) {
      errors.push('Lahore service area is required for verification submission');
    }

    // 7. NTN (Optional for small traders, but if provided must be valid)
    if (data.tax_ntn !== undefined && data.tax_ntn !== null && data.tax_ntn.trim() !== '') {
      const ntnRes = this.validateNtn(data.tax_ntn);
      if (!ntnRes.valid) {
        errors.push(ntnRes.error);
      } else {
        sanitized.tax_ntn = ntnRes.normalized;
      }
    } else if (data.tax_ntn !== undefined) {
      sanitized.tax_ntn = null;
    }

    // 8. Food License Number & Type (Category dependent: e.g. Punjab Food Authority)
    if (data.food_license_no !== undefined && data.food_license_no !== null && data.food_license_no.trim() !== '') {
      if (typeof data.food_license_no !== 'string' || data.food_license_no.trim().length > 100) {
        errors.push('Food license number cannot exceed 100 characters');
      } else {
        sanitized.food_license_no = data.food_license_no.trim();
        sanitized.food_license_type = data.food_license_type ? data.food_license_type.trim() : 'PUNJAB_FOOD_AUTHORITY';
      }
    } else if (data.food_license_no !== undefined) {
      sanitized.food_license_no = null;
      sanitized.food_license_type = data.food_license_type || 'NOT_APPLICABLE';
    }

    // 9. Bank Information (Mandatory for verification submission to enable Safepay settlements)
    if (data.bank_name !== undefined && data.bank_name !== null) {
      if (typeof data.bank_name !== 'string' || data.bank_name.trim().length < 2) {
        errors.push('Bank name must be at least 2 characters');
      } else {
        sanitized.bank_name = data.bank_name.trim();
      }
    } else if (isSubmission) {
      errors.push('Bank name is required for settlement verification');
    }

    if (data.bank_account_title !== undefined && data.bank_account_title !== null) {
      if (typeof data.bank_account_title !== 'string' || data.bank_account_title.trim().length < 2) {
        errors.push('Bank account title must be at least 2 characters');
      } else {
        sanitized.bank_account_title = data.bank_account_title.trim();
      }
    } else if (isSubmission) {
      errors.push('Bank account title is required for settlement verification');
    }

    if (data.bank_iban !== undefined && data.bank_iban !== null) {
      const ibanRes = this.validateIban(data.bank_iban);
      if (!ibanRes.valid) {
        errors.push(ibanRes.error);
      } else {
        sanitized.bank_iban = ibanRes.normalized;
      }
    } else if (isSubmission) {
      errors.push('Valid Pakistani IBAN is required for settlement verification');
    }

    // 10. Business Description (Optional)
    if (data.business_description !== undefined && data.business_description !== null) {
      if (typeof data.business_description !== 'string' || data.business_description.trim().length > 2000) {
        errors.push('Business description cannot exceed 2000 characters');
      } else {
        sanitized.business_description = data.business_description.trim();
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized
    };
  }
}

module.exports = new SupplierValidationService();
