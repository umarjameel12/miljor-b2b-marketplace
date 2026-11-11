// =============================================================================
// src/components/supplier/SupplierOnboardingWizard.jsx
// MilJor Package E1: Supplier Onboarding & Business Profile Wizard
// Structured multi-step onboarding with save-draft and verification submission
// =============================================================================
import React, { useState } from 'react';
import {
  Building2,
  Phone,
  User,
  MapPin,
  FileText,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Save,
  Send,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Clock,
  Sparkles
} from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import supplierApi from '../../api/supplier';
import { toast } from 'react-toastify';

export const SupplierOnboardingWizard = ({ initialProfile, onProfileUpdated }) => {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    business_name: initialProfile?.business_name || '',
    business_type: initialProfile?.business_type || 'Wholesale Commodity Distributor',
    business_description: initialProfile?.business_description || '',
    contact_person_name: initialProfile?.contact_person_name || '',
    contact_person_phone: initialProfile?.contact_person_phone || initialProfile?.phone || '',
    warehouse_address: initialProfile?.warehouse_address || initialProfile?.address || '',
    lahore_service_area: initialProfile?.lahore_service_area || initialProfile?.area || 'Lahore — Badami Bagh & Ravi Hub',
    tax_ntn: initialProfile?.tax_ntn || '',
    food_license_no: initialProfile?.food_license_no || '',
    food_license_type: initialProfile?.food_license_type || 'PUNJAB_FOOD_AUTHORITY',
    bank_name: initialProfile?.bank_name || '',
    bank_account_title: initialProfile?.bank_account_title || '',
    bank_iban: initialProfile?.bank_iban || '',
  });

  const businessTypes = [
    'Wholesale Commodity Distributor',
    'Grain Miller & Processor',
    'Edible Oil Refinery / Packer',
    'Pulses & Legumes Wholesaler',
    'Direct Farm / Agricultural Producer',
    'Import / Export Food Trading Company',
    'Commercial Food Wholesaler'
  ];

  const lahoreAreas = [
    'Lahore — Badami Bagh & Ravi Hub',
    'Lahore — Akbari Mandi & Walled City',
    'Lahore — Gulberg & Central Commercial',
    'Lahore — Kot Lakhpat & Industrial Area',
    'Lahore — Multan Road & Allama Iqbal Hub',
    'Lahore — Sundar Industrial Estate',
    'Lahore — Quaid-e-Azam Industrial Estate',
    'Lahore — Wagah & Eastern Corridor',
    'Lahore — Raiwind & Southern Corridor',
    'Lahore — Whole District Distribution'
  ];

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  // 1. Client-Side Validations
  const validateStep = (currentStep) => {
    if (currentStep === 1) {
      if (!formData.business_name || formData.business_name.trim().length < 2) {
        setError('Registered business name must be at least 2 characters');
        return false;
      }
      if (!formData.contact_person_name || formData.contact_person_name.trim().length < 2) {
        setError('Contact person name is required');
        return false;
      }
      const cleanPhone = formData.contact_person_phone.replace(/[\s\-\(\)]/g, '');
      if (!cleanPhone || !/^((\+92)|(0092)|(92)|(0))?3[0-9]{9}$/.test(cleanPhone)) {
        setError('Please enter a valid Pakistani mobile number (e.g. 03001234567 or +923001234567)');
        return false;
      }
    }

    if (currentStep === 2) {
      if (!formData.warehouse_address || formData.warehouse_address.trim().length < 5) {
        setError('Warehouse or dispatch facility address must be at least 5 characters');
        return false;
      }
      if (formData.tax_ntn && formData.tax_ntn.trim().length > 0) {
        if (!/^[0-9]{7}-?[0-9]{1}$/.test(formData.tax_ntn.trim())) {
          setError('NTN format must be 7 digits followed by 1 check digit (e.g. 1234567-8)');
          return false;
        }
      }
    }

    if (currentStep === 3) {
      if (!formData.bank_name || formData.bank_name.trim().length < 2) {
        setError('Settlement bank name is required');
        return false;
      }
      if (!formData.bank_account_title || formData.bank_account_title.trim().length < 2) {
        setError('Bank account title is required');
        return false;
      }
      if (formData.bank_iban) {
        const cleanIban = formData.bank_iban.replace(/[\s\-]/g, '').toUpperCase();
        if (cleanIban.length !== 24 || !cleanIban.startsWith('PK')) {
          setError('Pakistani IBAN must be 24 characters starting with PK (e.g. PK36SCBL0000001123456702)');
          return false;
        }
      }
    }

    setError(null);
    return true;
  };

  // 2. Save Draft Action
  const handleSaveDraft = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await supplierApi.updateProfile(formData);
      toast.success('Draft profile saved successfully');
      setSuccessMsg('Your draft business details have been saved.');
      if (onProfileUpdated) onProfileUpdated(res.data.profile);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Could not save draft';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // 3. Final Verification Submission
  const handleSubmitVerification = async () => {
    // Validate all 3 steps before submitting
    if (!validateStep(1) || !validateStep(2) || !validateStep(3)) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // First save all current data
      await supplierApi.updateProfile(formData);

      // Then submit for verification
      const res = await supplierApi.submitVerification();
      toast.success(res.message || 'Application submitted successfully!');
      setSuccessMsg(res.message);

      // Refresh parent
      const refreshed = await supplierApi.getProfile();
      if (onProfileUpdated) onProfileUpdated(refreshed.data.profile);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Could not submit verification';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const nextStep = () => {
    if (validateStep(step)) {
      setStep((prev) => Math.min(prev + 1, 4));
    }
  };

  const prevStep = () => {
    setError(null);
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const isVerified = initialProfile?.verification_status === 'VERIFIED';
  const isPending = initialProfile?.verification_status === 'PENDING_REVIEW' || initialProfile?.verification_status === 'UNDER_REVIEW';

  return (
    <div className="space-y-6">
      {/* Wizard Progress Stepper */}
      <div className="grid grid-cols-4 gap-2 sm:gap-4 pb-2 border-b border-[var(--border-subtle)]">
        {[
          { num: 1, label: 'Business Identity', icon: Building2 },
          { num: 2, label: 'Lahore Facilities', icon: MapPin },
          { num: 3, label: 'Settlement Payouts', icon: CreditCard },
          { num: 4, label: 'Review & Submit', icon: ShieldCheck },
        ].map((s) => {
          const Icon = s.icon;
          const isActive = step === s.num;
          const isPassed = step > s.num;

          return (
            <button
              key={s.num}
              type="button"
              onClick={() => {
                if (s.num < step || validateStep(step)) {
                  setStep(s.num);
                }
              }}
              className={`flex items-center gap-2 p-2 rounded-xl text-left transition-all cursor-pointer ${
                isActive
                  ? 'bg-[var(--brand-accent)]/10 text-[var(--brand-accent)] font-semibold border border-[var(--brand-accent)]/20'
                  : isPassed
                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isActive
                    ? 'bg-[var(--brand-accent)] text-[var(--text-on-champagne)]'
                    : isPassed
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                }`}
              >
                {isPassed ? <CheckCircle2 className="w-4 h-4" /> : s.num}
              </div>
              <div className="hidden sm:flex flex-col">
                <span className="text-xs font-semibold leading-tight">{s.label}</span>
                <span className="text-[10px] text-[var(--text-muted)]">Step {s.num}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Alert Notices */}
      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl border flex items-start gap-3 text-xs bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400 animate-in fade-in"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Validation Notice</span>
            <span className="mt-0.5 block leading-relaxed">{error}</span>
          </div>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="p-3.5 rounded-xl border flex items-start gap-3 text-xs bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 animate-in fade-in"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Action Completed</span>
            <span className="mt-0.5 block leading-relaxed">{successMsg}</span>
          </div>
        </div>
      )}

      {/* STEP 1: BUSINESS IDENTITY */}
      {step === 1 && (
        <Card className="p-6 space-y-5 bg-[var(--bg-card)] border-[var(--border-subtle)]">
          <div className="border-b border-[var(--border-subtle)] pb-3">
            <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">
              Wholesale Business Identity
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Provide your official commercial trading name and primary authorized contact for bulk procurement operations.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                label="Registered Business Name *"
                type="text"
                required
                value={formData.business_name}
                onChange={(e) => handleChange('business_name', e.target.value)}
                placeholder="e.g. Akbari Rice Traders & Millers"
                icon={Building2}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                Business Category / Operation *
              </label>
              <select
                value={formData.business_type}
                onChange={(e) => handleChange('business_type', e.target.value)}
                className="w-full text-xs rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-primary)] p-3 focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
              >
                {businessTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Input
                label="Primary Contact Person *"
                type="text"
                required
                value={formData.contact_person_name}
                onChange={(e) => handleChange('contact_person_name', e.target.value)}
                placeholder="e.g. Tariq Mehmood"
                icon={User}
              />
            </div>

            <div className="sm:col-span-2">
              <Input
                label="Authorized WhatsApp / Mobile Phone *"
                type="tel"
                required
                value={formData.contact_person_phone}
                onChange={(e) => handleChange('contact_person_phone', e.target.value)}
                placeholder="03001234567 or +923001234567"
                icon={Phone}
              />
              <span className="text-[10px] text-[var(--text-muted)] mt-1 block">
                Order dispatches, pool confirmations, and delivery notifications will be sent to this number.
              </span>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                Business Description & Commodity Specialization
              </label>
              <textarea
                rows={3}
                value={formData.business_description}
                onChange={(e) => handleChange('business_description', e.target.value)}
                placeholder="Summarize your commodity supply capabilities (e.g. Basmati Rice 1121 millers, wholesale chakki flour distributor across Lahore)..."
                className="w-full text-xs rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-primary)] p-3 focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
              />
            </div>
          </div>
        </Card>
      )}

      {/* STEP 2: LAHORE FACILITIES & LICENSING */}
      {step === 2 && (
        <Card className="p-6 space-y-5 bg-[var(--bg-card)] border-[var(--border-subtle)]">
          <div className="border-b border-[var(--border-subtle)] pb-3">
            <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">
              Lahore Warehousing & Commercial Licensing
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Specify your physical dispatch facility location and commercial tax/food authority registration details.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                Primary Lahore Base Service Hub *
              </label>
              <select
                value={formData.lahore_service_area}
                onChange={(e) => handleChange('lahore_service_area', e.target.value)}
                className="w-full text-xs rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-primary)] p-3 focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
              >
                {lahoreAreas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                Warehouse / Dispatch Facility Physical Address *
              </label>
              <textarea
                rows={2}
                value={formData.warehouse_address}
                onChange={(e) => handleChange('warehouse_address', e.target.value)}
                placeholder="Complete street, godown/plot number, market area (e.g. Godown #14, Ravi Link Road, Badami Bagh, Lahore)..."
                className="w-full text-xs rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] text-[var(--text-primary)] p-3 focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
              />
            </div>

            <div>
              <Input
                label="FBR National Tax Number (NTN) (Optional)"
                type="text"
                value={formData.tax_ntn}
                onChange={(e) => handleChange('tax_ntn', e.target.value)}
                placeholder="e.g. 1234567-8"
                icon={FileText}
              />
              <span className="text-[10px] text-[var(--text-muted)] mt-1 block">
                Required for tax invoices and corporate buyer qualification.
              </span>
            </div>

            <div>
              <Input
                label="Punjab Food Authority / License No. (If Applicable)"
                type="text"
                value={formData.food_license_no}
                onChange={(e) => handleChange('food_license_no', e.target.value)}
                placeholder="e.g. PFA-LHR-2024-9842"
                icon={ShieldCheck}
              />
              <span className="text-[10px] text-[var(--text-muted)] mt-1 block">
                Mandatory for processed foods, oils, and dairy distributors.
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* STEP 3: SETTLEMENT PAYOUTS */}
      {step === 3 && (
        <Card className="p-6 space-y-5 bg-[var(--bg-card)] border-[var(--border-subtle)]">
          <div className="border-b border-[var(--border-subtle)] pb-3">
            <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">
              Settlement Banking & Payout Credentials
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Safepay escrow payments released upon buyer fulfillment confirmation are disbursed directly to this Pakistani corporate account.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Input
                label="Bank Name *"
                type="text"
                required
                value={formData.bank_name}
                onChange={(e) => handleChange('bank_name', e.target.value)}
                placeholder="e.g. Standard Chartered Bank / Habib Bank Limited"
                icon={Building2}
              />
            </div>

            <div>
              <Input
                label="Account Title *"
                type="text"
                required
                value={formData.bank_account_title}
                onChange={(e) => handleChange('bank_account_title', e.target.value)}
                placeholder="e.g. Akbari Rice Mills Pvt Ltd"
                icon={User}
              />
            </div>

            <div className="sm:col-span-2">
              <Input
                label="Pakistani IBAN (24 Characters) *"
                type="text"
                required
                value={formData.bank_iban}
                onChange={(e) => handleChange('bank_iban', e.target.value.toUpperCase())}
                placeholder="PK36SCBL0000001123456702"
                icon={CreditCard}
              />
              <span className="text-[10px] text-[var(--text-muted)] mt-1 block">
                Must be an authoritative 24-character IBAN starting with PK. Validated with ISO Modulo-97 algorithm.
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-secondary)] flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Bank details are encrypted and never shown publicly in buyer catalog offers. Invoices and supplier payable summaries mask the middle 16 digits.
            </span>
          </div>
        </Card>
      )}

      {/* STEP 4: REVIEW & SUBMIT */}
      {step === 4 && (
        <Card className="p-6 space-y-5 bg-[var(--bg-card)] border-[var(--border-subtle)]">
          <div className="border-b border-[var(--border-subtle)] pb-3">
            <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">
              Review Business Details & Verification Submission
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Verify your information before submitting to the MilJor Lahore Operations & Verification Team.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-1.5">
              <span className="font-semibold text-[var(--text-primary)] block">Business & Contact</span>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Name:</strong> {formData.business_name || '—'}</p>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Type:</strong> {formData.business_type || '—'}</p>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Contact Person:</strong> {formData.contact_person_name || '—'}</p>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Phone:</strong> {formData.contact_person_phone || '—'}</p>
            </div>

            <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-1.5">
              <span className="font-semibold text-[var(--text-primary)] block">Facilities & Tax</span>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Service Area:</strong> {formData.lahore_service_area || '—'}</p>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Warehouse:</strong> {formData.warehouse_address || '—'}</p>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">NTN:</strong> {formData.tax_ntn || 'Not provided'}</p>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">License:</strong> {formData.food_license_no || 'Not provided'}</p>
            </div>

            <div className="sm:col-span-2 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-1.5">
              <span className="font-semibold text-[var(--text-primary)] block">Payout Account</span>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Bank:</strong> {formData.bank_name || '—'}</p>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">Account Title:</strong> {formData.bank_account_title || '—'}</p>
              <p className="text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">IBAN:</strong> {formData.bank_iban ? `${formData.bank_iban.slice(0, 4)} **** **** **** **** ${formData.bank_iban.slice(-4)}` : '—'}</p>
            </div>
          </div>

          {/* Current Status Callout */}
          <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
              <span className="font-semibold text-[var(--text-primary)] block">Verification Timeline</span>
              Verification reviews are processed by MilJor Lahore Operations within <strong>2 business days</strong>. Once approved, you gain full access to publish Regular Pools and sell to thousands of commercial restaurants, bakeries, and food businesses.
            </div>
          </div>
        </Card>
      )}

      {/* Action Footer Buttons */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={prevStep}
              className="flex-1 sm:flex-initial items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="md"
            loading={saving}
            disabled={saving || submitting}
            onClick={handleSaveDraft}
            className="flex-1 sm:flex-initial items-center gap-1.5 cursor-pointer text-xs"
          >
            <Save className="w-4 h-4" />
            <span>Save Draft</span>
          </Button>
        </div>

        <div className="w-full sm:w-auto">
          {step < 4 ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={nextStep}
              className="w-full sm:w-auto items-center gap-2 cursor-pointer font-semibold shadow-xs"
              style={{
                backgroundColor: 'var(--brand-accent)',
                color: 'var(--text-on-champagne)',
              }}
            >
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={submitting}
              disabled={submitting || saving || isPending || isVerified}
              onClick={handleSubmitVerification}
              className="w-full sm:w-auto items-center gap-2 cursor-pointer font-semibold shadow-xs"
              style={{
                backgroundColor: isVerified ? 'var(--bg-elevated)' : 'var(--brand-accent)',
                color: isVerified ? 'var(--text-muted)' : 'var(--text-on-champagne)',
              }}
            >
              <Send className="w-4 h-4" />
              <span>{isPending ? 'Application Submitted (Pending)' : isVerified ? 'Account Verified' : 'Submit for Verification'}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupplierOnboardingWizard;
