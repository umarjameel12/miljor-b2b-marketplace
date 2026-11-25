// =============================================================================
// src/components/supplier/SupplierVerificationBadge.jsx
// MilJor Package E1: Supplier Verification Status Badge
// Displays authentic, database-backed verification levels & review states
// =============================================================================
import React from 'react';
import { ShieldCheck, Clock, RefreshCw, AlertCircle, XCircle, AlertTriangle } from 'lucide-react';

export const SupplierVerificationBadge = ({ status, level, size = 'md' }) => {
  const getBadgeConfig = () => {
    switch (status) {
      case 'VERIFIED':
        return {
          label: level === 'LEVEL_3_QUALITY' ? 'Verified Quality Supplier' : 'Verified Supplier',
          icon: ShieldCheck,
          bgClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
        };
      case 'PENDING_REVIEW':
        return {
          label: 'Verification Pending Review',
          icon: Clock,
          bgClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
        };
      case 'UNDER_REVIEW':
        return {
          label: 'Application Under Review',
          icon: RefreshCw,
          bgClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
        };
      case 'MORE_INFORMATION_REQUIRED':
        return {
          label: 'Revisions Requested',
          icon: AlertCircle,
          bgClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
        };
      case 'REJECTED':
        return {
          label: 'Verification Rejected',
          icon: XCircle,
          bgClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
        };
      case 'SUSPENDED':
        return {
          label: 'Account Suspended',
          icon: AlertTriangle,
          bgClass: 'bg-stone-500/10 text-stone-600 dark:text-stone-400 border-stone-500/20',
        };
      case 'NOT_SUBMITTED':
      default:
        return {
          label: 'Unverified Profile (Draft)',
          icon: AlertTriangle,
          bgClass: 'bg-stone-500/10 text-stone-600 dark:text-stone-400 border-stone-500/20',
        };
    }
  };

  const { label, icon: Icon, bgClass } = getBadgeConfig();

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3.5 py-1.5 gap-2 font-medium',
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border transition-colors ${bgClass} ${sizeClasses[size] || sizeClasses.md}`}
    >
      <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      <span>{label}</span>
    </span>
  );
};

export default SupplierVerificationBadge;
