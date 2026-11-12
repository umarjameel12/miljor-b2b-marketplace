// =============================================================================
// src/pages/RegisterPage.jsx
// MilJor Premium Authentication V2: Dedicated Create Account Experience
// Context-Sensitive Hero Panel (Buyer vs Supplier), Nationwide Brand Positioning,
// Integrated Single-Select Base Cluster, Live Password Guidance & Confirmation
// =============================================================================
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAuthAppearance } from '../context/AuthAppearanceContext';
import { AuthAppearanceControl } from '../components/auth/AuthAppearanceControl';
import { AuthHeroPanel } from '../components/auth/AuthHeroPanel';
import { PasswordField } from '../components/auth/PasswordField';
import { Logo } from '../components/ui/Logo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import LahoreClusterSelector from '../components/geo/LahoreClusterSelector';
import { toast } from 'react-toastify';
import {
  Mail,
  Phone,
  Building2,
  User,
  MapPin,
  AlertCircle,
  Truck,
  Store,
  ShieldCheck,
  Info
} from 'lucide-react';

export const RegisterPage = () => {
  const [role, setRole] = useState('BUYER'); // 'BUYER' or 'SUPPLIER'
  const [formData, setFormData] = useState({
    business_name: '',
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
    city: 'Lahore',
    cluster_id: '',
    society_area: '',
    address: '',
  });

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const { register } = useAuth();
  const { preferences } = useAuthAppearance();
  const navigate = useNavigate();

  // Password validation matching backend invariants
  const isLengthValid = formData.password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(formData.password);
  const hasNumber = /[0-9]/.test(formData.password);
  const isPasswordValid = isLengthValid && hasLetter && hasNumber;
  const isPasswordMatch = formData.password === formData.confirm_password;

  // Phone validation: exactly 11 digits when provided
  const cleanPhone = formData.phone.replace(/\D/g, '');

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      const digitsOnly = value.replace(/\D/g, '').slice(0, 11);
      setFormData((prev) => ({ ...prev, phone: digitsOnly }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleClusterChange = (e, cluster) => {
    setFormData((prev) => ({
      ...prev,
      cluster_id: e.target.value,
      area: cluster?.name || prev.area,
    }));
  };

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // 1. Mandatory Identity Validations
    if (!formData.business_name.trim()) {
      setError(role === 'SUPPLIER' ? 'Supplier / Mill Business Name is required.' : 'Buyer Business Name is required.');
      return;
    }

    if (!formData.full_name.trim()) {
      setError('Authorized contact person name is required.');
      return;
    }

    if (!formData.email) {
      setError('A valid business email address is required.');
      return;
    }

    if (formData.phone && !/^[0-9]{11}$/.test(cleanPhone)) {
      setError('Mobile number must be exactly 11 digits (e.g. 03001234567).');
      return;
    }

    // 2. Base Cluster Validation (Required for both Buyer & Supplier)
    if (!formData.cluster_id) {
      setError(
        role === 'SUPPLIER'
          ? 'Please select your supplier base operational facility cluster in Lahore.'
          : 'Please select your primary Lahore operational cluster for pool discovery.'
      );
      return;
    }

    // 3. Address Handling & Role-Specific Validation
    const hasSociety = Boolean(formData.society_area?.trim());
    const hasAddress = Boolean(formData.address?.trim());

    if (role === 'BUYER') {
      // For BUYER: Society & address are OPTIONAL.
      // If either is provided, both are required to form a valid initial address:
      if ((hasSociety && !hasAddress) || (!hasSociety && hasAddress)) {
        setError(
          'To save an initial delivery address, both Society/Area and Complete Address are required. Or leave both empty to register with base cluster only.'
        );
        return;
      }
    } else if (role === 'SUPPLIER') {
      // For SUPPLIER: Base facility warehouse address is required
      if (!hasAddress) {
        setError('Please enter your complete mill, processing facility, or warehouse address in Lahore.');
        return;
      }
    }

    // 4. Password Invariant Validation
    if (!isPasswordValid) {
      setError('Password must be at least 8 characters and contain both letters and numbers.');
      return;
    }

    if (formData.confirm_password && !isPasswordMatch) {
      setError('Password confirmation does not match.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        business_name: formData.business_name.trim(),
        full_name: formData.full_name.trim(),
        email: formData.email.trim(),
        phone: formData.phone ? cleanPhone : undefined,
        password: formData.password,
        role,
        city: 'Lahore',
        base_cluster_id: Number(formData.cluster_id),
        cluster_id: Number(formData.cluster_id),
      };

      // Attach optional address only if both fields are supplied
      if (hasSociety && hasAddress) {
        payload.society_area = formData.society_area.trim();
        payload.address = formData.address.trim();
      } else if (role === 'SUPPLIER' && hasAddress) {
        if (hasSociety) payload.society_area = formData.society_area.trim();
        payload.address = formData.address.trim();
      }

      const res = await register(payload);

      if (res.requires_verification) {
        toast.success('Account created. Please check your email for the verification code.');
        navigate('/verify-email', { state: { email: formData.email } });
      } else {
        toast.success(
          `Account registered successfully as ${role === 'SUPPLIER' ? 'Supplier' : 'Buyer'}. Welcome to MilJor.`
        );
        if (role === 'SUPPLIER') {
          navigate('/profile');
        } else {
          navigate('/pools');
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Registration failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Registration Form Body
  const renderForm = () => (
    <div className="flex flex-col gap-3.5 sm:gap-4 w-full">
      {/* Top Branding & Positioning */}
      <div className="flex flex-col items-center text-center">
        <Link to="/" aria-label="MilJor Home" className="mb-1">
          <Logo variant="monogram" size="lg" />
        </Link>

        {preferences.showTagline && (
          <span
            className="font-sans font-semibold text-[10px] sm:text-[11px] tracking-widest uppercase mb-0.5"
            style={{ color: 'var(--brand-accent)' }}
          >
            Mil Kar Khareedo, Behtar Pao
          </span>
        )}

        {preferences.showBrandHeading && (
          <h1 className="font-display font-black text-xl sm:text-2xl tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {role === 'SUPPLIER' ? 'Create Supplier Account' : 'Create Buyer Account'}
          </h1>
        )}

        <p className="text-xs font-sans mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {role === 'SUPPLIER'
            ? 'Wholesale mills, importers & commercial distributors — Launching first in Lahore'
            : 'Commercial kitchens & restaurants pooling wholesale demand — Launching first in Lahore'}
        </p>
      </div>

      {/* Segmented Quick-Switch Tabs [Sign In | Create Account] */}
      <div
        className="grid grid-cols-2 p-1 rounded-xl border text-xs font-semibold"
        style={{
          backgroundColor: 'var(--bg-input)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <Link
          to="/login"
          className="py-1.5 text-center rounded-lg transition-all hover:text-[var(--text-primary)]"
          style={{ color: 'var(--text-muted)' }}
        >
          Sign In
        </Link>
        <span
          className="py-1.5 text-center rounded-lg transition-all shadow-xs cursor-default"
          style={{
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        >
          Create Account
        </span>
      </div>

      {/* Account Type Selector: Buyer vs Supplier */}
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-sans font-medium" style={{ color: 'var(--text-secondary)' }}>
          Account Type
        </label>
        <div
          className="grid grid-cols-2 p-1 rounded-xl border text-xs font-semibold"
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => handleRoleChange('BUYER')}
            className={`py-1.5 text-center rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              role === 'BUYER' ? 'shadow-xs font-bold' : 'hover:text-[var(--text-primary)]'
            }`}
            style={{
              backgroundColor: role === 'BUYER' ? 'var(--bg-surface)' : 'transparent',
              color: role === 'BUYER' ? 'var(--brand-accent)' : 'var(--text-muted)',
              border: role === 'BUYER' ? '1px solid var(--border-default)' : '1px solid transparent',
            }}
          >
            <Store className="w-3.5 h-3.5" />
            <span>Buyer (Kitchen / Caterer)</span>
          </button>
          <button
            type="button"
            onClick={() => handleRoleChange('SUPPLIER')}
            className={`py-1.5 text-center rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              role === 'SUPPLIER' ? 'shadow-xs font-bold' : 'hover:text-[var(--text-primary)]'
            }`}
            style={{
              backgroundColor: role === 'SUPPLIER' ? 'var(--bg-surface)' : 'transparent',
              color: role === 'SUPPLIER' ? 'var(--brand-accent)' : 'var(--text-muted)',
              border: role === 'SUPPLIER' ? '1px solid var(--border-default)' : '1px solid transparent',
            }}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Supplier (Mill / Trader)</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          className="p-3 rounded-xl border flex items-start gap-2.5 text-xs animate-in fade-in duration-200"
          style={{
            backgroundColor: 'var(--status-danger-bg)',
            borderColor: 'var(--status-danger)',
            color: 'var(--status-danger)',
          }}
          role="alert"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Registration Notice</span>
            <span className="mt-0.5 block">{error}</span>
          </div>
        </div>
      )}

      {/* Registration Form Fields */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Row 1: Business Name & Authorized Contact */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Input
            label={role === 'SUPPLIER' ? 'Supplier Business Name' : 'Buyer Business Name'}
            type="text"
            name="business_name"
            placeholder={role === 'SUPPLIER' ? 'e.g. Al-Rehman Rice Mills' : 'e.g. Royal Caterers'}
            value={formData.business_name}
            onChange={handleChange}
            icon={Building2}
            required
          />

          <Input
            label="Contact Person Name"
            type="text"
            name="full_name"
            placeholder="e.g. Tariq Mehmood"
            value={formData.full_name}
            onChange={handleChange}
            icon={User}
            required
          />
        </div>

        {/* Row 2: Email & Phone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Input
            label="Business Email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="procurement@business.pk"
            value={formData.email}
            onChange={handleChange}
            icon={Mail}
            required
          />

          <Input
            label="Mobile Number (11 digits)"
            type="tel"
            name="phone"
            autoComplete="tel"
            placeholder="03001234567"
            value={formData.phone}
            onChange={handleChange}
            icon={Phone}
            helperText="For order & dispatch SMS updates"
          />
        </div>

        {/* Geographic Launch Alignment Section */}
        <div className="pt-2 border-t space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {role === 'SUPPLIER' ? 'Supplier Facility Location' : 'Marketplace Base Cluster'}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Launch Service Area — Lahore</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Launch City Fixed */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-sans font-medium flex items-center justify-between" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-stone-400" />
                  <span>Launch City</span>
                </span>
                <span className="text-[10px] text-stone-400">First Market</span>
              </label>
              <input
                type="text"
                readOnly
                value="Lahore District, Pakistan"
                aria-label="Launch City"
                className="w-full px-3.5 py-2 rounded-xl border text-xs font-medium cursor-not-allowed select-none"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                  opacity: 0.9,
                }}
              />
            </div>

            {/* Authoritative Lahore Base Cluster Dropdown */}
            <LahoreClusterSelector
              value={formData.cluster_id}
              onChange={handleClusterChange}
              label={role === 'SUPPLIER' ? 'Primary Mill / Facility Cluster' : 'Base Operating Cluster'}
              helperText={
                role === 'SUPPLIER'
                  ? 'Location of your primary warehouse or processing facility in Lahore.'
                  : 'Used for pool discovery. You can add specific delivery addresses later.'
              }
            />
          </div>

          {/* Role-Specific Address Handling */}
          {role === 'BUYER' ? (
            <div className="space-y-2 pt-0.5">
              <div className="flex items-start gap-1.5 text-[11px] text-stone-500">
                <Info className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Optional Delivery Address:</strong> You can register now with just your base cluster. Full street delivery addresses are only required when placing doorstep delivery orders.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Input
                  label="Society / Area (Optional)"
                  type="text"
                  name="society_area"
                  placeholder="e.g. Johar Town Block G1, DHA Phase 6"
                  value={formData.society_area}
                  onChange={handleChange}
                  icon={MapPin}
                />

                <Input
                  label="Commercial Address (Optional)"
                  type="text"
                  name="address"
                  placeholder="e.g. Shop 4B, Main Market"
                  value={formData.address}
                  onChange={handleChange}
                  icon={Building2}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2 pt-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Input
                  label="Society / Industrial Area"
                  type="text"
                  name="society_area"
                  placeholder="e.g. Badami Bagh, Quaid-e-Azam Estate"
                  value={formData.society_area}
                  onChange={handleChange}
                  icon={MapPin}
                />

                <Input
                  label="Facility Street Address"
                  type="text"
                  name="address"
                  placeholder="e.g. Plot 14-B, Industrial Area, Kot Lakhpat"
                  value={formData.address}
                  onChange={handleChange}
                  icon={Building2}
                  required
                />
              </div>
            </div>
          )}
        </div>

        {/* Password & Confirmation with Live Checklist */}
        <div className="pt-2 border-t space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <PasswordField
              label="Account Password"
              value={formData.password}
              onChange={handleChange}
              name="password"
              id="password"
              autoComplete="new-password"
              required={true}
              showStrength={true}
              confirmValue={formData.confirm_password}
            />

            <PasswordField
              label="Confirm Password"
              value={formData.confirm_password}
              onChange={handleChange}
              name="confirm_password"
              id="confirm_password"
              placeholder="Re-enter your password"
              autoComplete="new-password"
              required={true}
              showStrength={false}
              guidanceText=""
            />
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          className="w-full mt-1.5 font-semibold shadow-xs justify-center cursor-pointer"
          style={{
            backgroundColor: 'var(--brand-accent)',
            color: 'var(--text-on-champagne)',
          }}
        >
          Create {role === 'SUPPLIER' ? 'Supplier' : 'Buyer'} Account
        </Button>

        <p className="text-[11px] text-center text-stone-500">
          By registering, you agree to MilJor's B2B collective procurement terms and Lahore delivery policies.
        </p>
      </form>
    </div>
  );

  return (
    <div
      className="min-h-[calc(100vh-5rem)] flex items-center justify-center p-3 sm:p-5 lg:p-6 transition-colors duration-300 relative overflow-hidden"
      style={{ background: 'var(--bg-auth)' }}
    >
      {/* Preserved Appearance Customizer Control (Hidden from view to prevent clutter) */}
      <div className="hidden" aria-hidden="true">
        <AuthAppearanceControl />
      </div>

      {/* ORIGINAL LAYOUT MODE (Reversible single-card presentation) */}
      {preferences.layoutStyle === 'original' ? (
        <div
          className="w-full max-w-lg p-6 sm:p-8 rounded-3xl auth-box-enhanced relative z-10 shadow-xl my-auto border"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {renderForm()}
        </div>
      ) : (
        /* ENHANCED SPLIT LUXURY LAYOUT (Dedicated Registration Experience) */
        <div
          className={`w-full ${
            preferences.showBrandPanel ? 'max-w-5xl' : 'max-w-xl'
          } rounded-3xl auth-box-enhanced shadow-2xl relative z-10 overflow-hidden border transition-all duration-300 my-auto`}
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className={`grid ${preferences.showBrandPanel ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'}`}>
            {/* Left Dedicated Create Account Hero Panel */}
            {preferences.showBrandPanel && (
              <AuthHeroPanel
                pageType="register"
                role={role}
                showBackgroundImage={preferences.showBackgroundImage}
                className="lg:col-span-5 min-h-[300px] lg:min-h-[580px]"
              />
            )}

            {/* Right Registration Form Panel */}
            <div
              className={`${
                preferences.showBrandPanel ? 'lg:col-span-7' : 'col-span-1'
              } p-6 sm:p-8 flex flex-col justify-center`}
            >
              {renderForm()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegisterPage;
