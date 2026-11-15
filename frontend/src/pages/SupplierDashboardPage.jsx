// =============================================================================
// src/pages/SupplierDashboardPage.jsx
// MilJor Master Supplier Operations Center — Executive Overview
// Live KPI Cards, Dynamic Priority Action Center, Genuine DB Records Only
// =============================================================================
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  TrendingUp,
  Package,
  Layers,
  FileText,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Zap,
  CheckCircle2,
  Clock,
  Sparkles,
  Truck,
  Wallet,
  AlertTriangle,
  RotateCcw,
  Calendar,
  Bell,
  RefreshCw,
  ShoppingBag,
  Check,
  ChevronRight
} from 'lucide-react';
import { toast } from 'react-toastify';

export const SupplierDashboardPage = () => {
  const { user, token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('30d');

  const [dashboardData, setDashboardData] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [profile, setProfile] = useState(null);

  const fetchOverview = useCallback(async (isRefresh = false) => {
    if (!token) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const headers = { Authorization: `Bearer ${token}` };

      const [kpiRes, subRes, profRes] = await Promise.all([
        fetch(`/api/v1/supplier/dashboard-kpis?period=${period}`, { headers }),
        fetch('/api/v1/supplier/subscription', { headers }),
        fetch('/api/v1/supplier/profile', { headers })
      ]);

      if (!kpiRes.ok) {
        throw new Error(`Failed to load KPI metrics (${kpiRes.status})`);
      }

      const kpiJson = await kpiRes.json();
      setDashboardData(kpiJson.data);

      if (subRes.ok) {
        const subJson = await subRes.json();
        setSubscription(subJson.data?.entitlements || subJson.data);
      }

      if (profRes.ok) {
        const profJson = await profRes.json();
        setProfile(profJson.data?.profile || profJson.data);
      }
    } catch (err) {
      console.error('Error fetching supplier dashboard data:', err);
      setError(err.message || 'Could not load operations dashboard');
      toast.error('Unable to refresh supplier metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, period]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const kpis = dashboardData?.kpis || {
    total_sales: '0.00',
    confirmed_paid_orders: 0,
    orders_awaiting_acknowledgment: 0,
    active_unified_pools: 0,
    active_regular_pools: 0,
    active_flash_pools: 0,
    incoming_rfqs: 0,
    pending_quotations: 0,
    upcoming_recurring_commitments: 0,
    today_scheduled_deliveries: 0,
    pending_disputes: 0,
    held_earnings: '0.00',
    settlement_eligible: '0.00',
    completed_payouts: '0.00',
    currency: 'PKR'
  };

  const priorityActions = dashboardData?.priority_actions || [];

  const currentPlan = subscription?.plan_code || subscription?.current_plan || 'STARTER';
  const maxFam = subscription?.max_allowed_families ?? subscription?.max_families ?? 4;
  const usedFam = subscription?.active_families_count ?? subscription?.used_distinct_families ?? 0;
  const remainingFam = subscription?.remaining_family_slots !== undefined
    ? subscription.remaining_family_slots
    : (subscription?.remaining_slots !== undefined ? subscription.remaining_slots : Math.max(0, maxFam - usedFam));
  const percentUsed = Math.min(100, Math.round((usedFam / maxFam) * 100));

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8 transition-colors duration-200">
        
        {/* =========================================================================
            1. HEADER & PERIOD CONTROLS
            ========================================================================= */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)]">
                Supplier Operations Center
              </span>
              {profile?.verification_status === 'VERIFIED' ? (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" /> Verified Supplier
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
                  <Clock className="w-3.5 h-3.5" /> Verification Pending
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text-primary)]">
              {profile?.business_name || user?.business_name || user?.full_name || 'Wholesale Supplier Operations'}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
              Orders, procurement, deliveries and earnings in one place.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Period Selector Tabs */}
            <div
              className="inline-flex items-center p-1 rounded-xl border text-xs font-semibold"
              style={{
                backgroundColor: 'var(--bg-input)',
                borderColor: 'var(--border-subtle)'
              }}
            >
              {[
                { key: '7d', label: '7 Days' },
                { key: '30d', label: '30 Days' },
                { key: 'all', label: 'All Time' }
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setPeriod(tab.key)}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    period === tab.key
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => fetchOverview(true)}
              disabled={refreshing || loading}
              className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
              title="Refresh metrics"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[var(--brand-accent)]' : ''}`} />
            </button>

            {/* Quick Actions */}
            <Link
              to="/supplier/pools"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] text-xs font-semibold transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-[var(--brand-accent)]" /> New Pool
            </Link>
            <Link
              to="/supplier/catalog"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-semibold hover:opacity-95 shadow-xs transition-opacity"
            >
              <Package className="w-3.5 h-3.5" /> Catalog
            </Link>
          </div>
        </div>

        {/* Error State with Retry */}
        {error && (
          <div className="p-4 rounded-2xl border border-red-500/30 bg-red-500/10 flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-400">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => fetchOverview(true)}
              className="px-3 py-1 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* =========================================================================
            2. PRIORITY ACTION CENTER (Actionable operational tasks)
            ========================================================================= */}
        <section aria-labelledby="priority-actions-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="priority-actions-heading" className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--brand-accent)]" /> Priority Action Center
            </h2>
            <span className="text-xs text-[var(--text-muted)]">
              {priorityActions.length} task{priorityActions.length === 1 ? '' : 's'} requiring attention
            </span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] animate-pulse" />
              ))}
            </div>
          ) : priorityActions.length === 0 ? (
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center gap-3 text-xs text-[var(--text-muted)]">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 shrink-0">
                <Check className="w-4 h-4" />
              </div>
              <div>
                <span className="font-semibold text-[var(--text-primary)] block">All Operational Tasks Up to Date</span>
                <span>No urgent unacknowledged orders, expiring pools, or pending disputes at this time.</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {priorityActions.map(action => {
                const isCritical = action.severity === 'CRITICAL';
                const isUrgent = action.severity === 'URGENT';
                const isWarning = action.severity === 'WARNING';
                const badgeColor = isCritical
                  ? 'bg-red-500/15 text-red-600 border-red-500/30'
                  : isUrgent
                  ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
                  : isWarning
                  ? 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30'
                  : 'bg-[var(--brand-accent)]/15 text-[var(--brand-accent)] border-[var(--brand-accent)]/30';

                return (
                  <div
                    key={action.id}
                    className="p-4 rounded-2xl border bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between gap-3 hover:border-[var(--brand-accent)] transition-all"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                          {action.severity}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {action.type.replace('_', ' ')}
                        </span>
                      </div>
                      <h3 className="text-xs font-bold text-[var(--text-primary)] leading-tight">
                        {action.title}
                      </h3>
                      <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">
                        {action.description}
                      </p>
                    </div>

                    <Link
                      to={action.link}
                      className="inline-flex items-center justify-between pt-2 border-t text-xs font-semibold text-[var(--brand-accent)] hover:underline"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <span>{action.action_label}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* =========================================================================
            3. LIVE 10 REQUIRED KPI METRIC CARDS
            ========================================================================= */}
        <section aria-labelledby="live-kpi-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="live-kpi-heading" className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Operational Performance Indicators
            </h2>
            <span className="text-xs text-[var(--text-muted)]">
              Aggregated from authentic transactional records
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {/* Card 1: Total Sales */}
            <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Total Sales</span>
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                  <TrendingUp className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className="text-xl sm:text-2xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
                  {formatPKR(kpis.total_sales)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  {period === '7d' ? 'Last 7 days' : period === '30d' ? 'Last 30 days' : 'All recorded sales'}
                </span>
              </div>
            </div>

            {/* Card 2: Confirmed & Paid Orders */}
            <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Paid Orders</span>
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600">
                  <ShoppingBag className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className="text-xl sm:text-2xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
                  {kpis.confirmed_paid_orders}
                </span>
                <Link to="/orders" className="text-[11px] text-[var(--brand-accent)] hover:underline mt-0.5 inline-flex items-center gap-0.5">
                  View orders <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            </div>

            {/* Card 3: Orders Awaiting Acknowledgment */}
            <div className={`p-4 rounded-2xl border bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between ${
              kpis.orders_awaiting_acknowledgment > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border-subtle)]'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Awaiting Ack</span>
                <div className={`p-1.5 rounded-lg ${kpis.orders_awaiting_acknowledgment > 0 ? 'bg-amber-500/20 text-amber-600' : 'bg-stone-500/10 text-stone-500'}`}>
                  <Clock className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className={`text-xl sm:text-2xl font-sans tabular-nums font-bold block ${kpis.orders_awaiting_acknowledgment > 0 ? 'text-amber-600' : 'text-[var(--text-primary)]'}`}>
                  {kpis.orders_awaiting_acknowledgment}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Requires fulfillment start
                </span>
              </div>
            </div>

            {/* Card 4: Active Unified Pools */}
            <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Active Pools</span>
                <div className="p-1.5 rounded-lg bg-[var(--brand-accent)]/15 text-[var(--brand-accent)]">
                  <Layers className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className="text-xl sm:text-2xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
                  {kpis.active_unified_pools}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  {kpis.active_regular_pools} Regular · {kpis.active_flash_pools} Flash
                </span>
              </div>
            </div>

            {/* Card 5: Incoming RFQs & Quotes */}
            <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">RFQs & Quotes</span>
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                  <FileText className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className="text-xl sm:text-2xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
                  {kpis.incoming_rfqs}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  {kpis.pending_quotations} draft quotations
                </span>
              </div>
            </div>

            {/* Card 6: Recurring Commitments */}
            <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Recurring Cycles</span>
                <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600">
                  <Calendar className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className="text-xl sm:text-2xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
                  {kpis.upcoming_recurring_commitments}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Weekly / monthly schedules
                </span>
              </div>
            </div>

            {/* Card 7: Today's Scheduled Deliveries */}
            <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Today Deliveries</span>
                <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-600">
                  <Truck className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className="text-xl sm:text-2xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
                  {kpis.today_scheduled_deliveries}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Lahore cluster runs
                </span>
              </div>
            </div>

            {/* Card 8: Pending Disputes */}
            <div className={`p-4 rounded-2xl border bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between ${
              kpis.pending_disputes > 0 ? 'border-red-500/40 bg-red-500/5' : 'border-[var(--border-subtle)]'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Open Disputes</span>
                <div className={`p-1.5 rounded-lg ${kpis.pending_disputes > 0 ? 'bg-red-500/20 text-red-600' : 'bg-stone-500/10 text-stone-500'}`}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className={`text-xl sm:text-2xl font-sans tabular-nums font-bold block ${kpis.pending_disputes > 0 ? 'text-red-600' : 'text-[var(--text-primary)]'}`}>
                  {kpis.pending_disputes}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Discrepancies under review
                </span>
              </div>
            </div>

            {/* Card 9: Held Earnings (Escrow) */}
            <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Held in Escrow</span>
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600">
                  <Wallet className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className="text-xl sm:text-2xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
                  {formatPKR(kpis.held_earnings)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Eligible: {formatPKR(kpis.settlement_eligible)}
                </span>
              </div>
            </div>

            {/* Card 10: Completed Recorded Payouts */}
            <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Verified Payouts</span>
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
              </div>
              <div>
                <span className="text-xl sm:text-2xl font-sans tabular-nums font-bold text-[var(--text-primary)] block">
                  {formatPKR(kpis.completed_payouts)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Direct to verified IBAN
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* =========================================================================
            4. SUBSCRIPTION QUOTA & FAMILY ENTITLEMENTS (Preserved Package E3)
            ========================================================================= */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Catalog Allowance Card */}
          <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Commodity Catalog Allowance
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-[var(--brand-accent)]/15 text-[var(--brand-accent)]">
                {currentPlan}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-3xl font-sans tabular-nums font-bold text-[var(--text-primary)]">
                {usedFam}
              </span>
              <span className="text-sm text-[var(--text-muted)]">
                / {maxFam} canonical families published
              </span>
            </div>
            {/* Progress Bar */}
            <div className="w-full bg-[var(--bg-card)] h-2 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full transition-all duration-300 ${
                  percentUsed >= 100 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${percentUsed}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>{remainingFam} slots available</span>
              <Link to="/supplier/subscription" className="text-[var(--brand-accent)] hover:underline font-medium">
                Manage Plan
              </Link>
            </div>
          </div>

          {/* Quick Workspaces Card */}
          <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-3">
                Core Operations Workspaces
              </span>
              <div className="space-y-1.5">
                <Link
                  to="/orders"
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-[var(--bg-card)] transition-colors text-xs font-medium text-[var(--text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-emerald-600" /> Orders & Fulfillment
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </Link>
                <Link
                  to="/supplier/pools"
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-[var(--bg-card)] transition-colors text-xs font-medium text-[var(--text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500" /> Unified Collective Pools
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </Link>
                <Link
                  to="/rfqs"
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-[var(--bg-card)] transition-colors text-xs font-medium text-[var(--text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-500" /> Smart Procurement & Quotes
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                </Link>
              </div>
            </div>
          </div>

          {/* Trust & Settlement Security */}
          <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-3">
                Banking & Settlement Security
              </span>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-600">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)]">
                    {profile?.verification_status === 'VERIFIED' ? 'Verified Tier 1 Supplier' : 'Verification In Progress'}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    NTN: {profile?.tax_ntn || 'Verified at Onboarding'}
                  </div>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Banking details are protected. Buyer confirmation alone does not prove a payout.
              </p>
            </div>
            <Link
              to="/supplier/profile"
              className="mt-4 text-xs font-semibold text-[var(--brand-accent)] hover:underline inline-flex items-center gap-1"
            >
              Verified Profile & Banking <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </section>

      </div>
    </AppShell>
  );
};

export default SupplierDashboardPage;
