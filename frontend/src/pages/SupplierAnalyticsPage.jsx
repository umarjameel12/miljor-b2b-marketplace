// =============================================================================
// src/pages/SupplierAnalyticsPage.jsx
// MilJor Master Supplier Operations Center — Analytics & Business Reports
// Real Database Aggregations, Quiet Luxury Aesthetics, Zero Fabricated Data
// =============================================================================
import React, { useState, useEffect, useCallback } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../context/AuthContext';
import {
  TrendingUp,
  BarChart3,
  Layers,
  ShoppingBag,
  Zap,
  Calendar,
  Clock,
  RefreshCw,
  ArrowUpRight,
  ShieldCheck
} from 'lucide-react';
import { toast } from 'react-toastify';

export const SupplierAnalyticsPage = () => {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kpis, setKpis] = useState(null);
  const [insights, setInsights] = useState(null);

  const fetchAnalytics = useCallback(async (isRefresh = false) => {
    if (!token) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const headers = { Authorization: `Bearer ${token}` };

      const [kpiRes, insightsRes] = await Promise.all([
        fetch('/api/v1/supplier/dashboard-kpis?period=all', { headers }),
        fetch('/api/v1/supplier/pools/insights', { headers }).catch(() => ({ ok: false }))
      ]);

      if (kpiRes.ok) {
        const json = await kpiRes.json();
        setKpis(json.data?.kpis || {});
      }

      if (insightsRes.ok) {
        const json = await insightsRes.json();
        setInsights(json.data || {});
      }
    } catch (err) {
      console.error('Error fetching analytics:', err);
      toast.error('Could not load analytics metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const formatPKR = (val) => {
    const num = Number(val) || 0;
    return new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 0
    }).format(num).replace('PKR', 'Rs.');
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)]">
                Performance Intelligence
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                <BarChart3 className="w-3.5 h-3.5" /> Authentic Data Only
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text-primary)]">
              Supplier Analytics & Business Reports
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
              Authoritative transaction volume, pool participation, quotation conversion, and delivery performance.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fetchAnalytics(true)}
            disabled={refreshing || loading}
            className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
            title="Refresh analytics"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[var(--brand-accent)]' : ''}`} />
          </button>
        </div>

        {/* Volume & Revenue Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
              All-Time Gross Sales
            </span>
            <span className="text-3xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
              {formatPKR(kpis?.total_sales || 0)}
            </span>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Across {kpis?.confirmed_paid_orders || 0} confirmed paid customer orders.
            </p>
          </div>

          <div className="p-6 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
              Active Unified Pools
            </span>
            <span className="text-3xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
              {kpis?.active_unified_pools || 0}
            </span>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              {kpis?.active_regular_pools || 0} Regular tiered pools · {kpis?.active_flash_pools || 0} Flash ready-stock clearance.
            </p>
          </div>

          <div className="p-6 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
              Settlement Payout Total
            </span>
            <span className="text-3xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
              {formatPKR(kpis?.completed_payouts || 0)}
            </span>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Escrow funds verified and disbursed to designated business bank account.
            </p>
          </div>
        </div>

        {/* Procurement Performance */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Procurement & Quotation Conversion
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[var(--text-muted)]">Incoming Invitations</span>
                <span className="font-bold text-[var(--text-primary)]">{kpis?.incoming_rfqs || 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[var(--text-muted)]">Pending Quotations</span>
                <span className="font-bold text-[var(--text-primary)]">{kpis?.pending_quotations || 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[var(--text-muted)]">Recurring Commitments</span>
                <span className="font-bold text-[var(--text-primary)]">{kpis?.upcoming_recurring_commitments || 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Open Discrepancies</span>
                <span className="font-bold text-red-600">{kpis?.pending_disputes || 0}</span>
              </div>
            </div>
          </div>

          <div className="p-6 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Delivery Logistics Reliability
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[var(--text-muted)]">Scheduled Deliveries Today</span>
                <span className="font-bold text-[var(--text-primary)]">{kpis?.today_scheduled_deliveries || 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-[var(--text-muted)]">Orders Awaiting Fulfillment</span>
                <span className="font-bold text-amber-600">{kpis?.orders_awaiting_acknowledgment || 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Escrow Funds On Hold</span>
                <span className="font-bold text-[var(--text-primary)]">{formatPKR(kpis?.held_earnings || 0)}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </AppShell>
  );
};

export default SupplierAnalyticsPage;
