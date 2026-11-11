import React, { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { RegularPaymentHoldCard } from '../components/RegularPaymentHoldCard';
import { FlashPaymentHoldCard } from '../components/FlashPaymentHoldCard';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  ClipboardList,
  Layers,
  ShieldCheck,
  Clock,
  CheckCircle2,
  Truck,
  ArrowRight,
} from 'lucide-react';
import FLAGS from '../config/featureFlags';

export const OrdersPage = () => {
  const { user, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState('ALL');
  const [showSamplePreview, setShowSamplePreview] = useState(false);
  const [realOrders,setRealOrders]=useState([]);
  const [ordersLoading,setOrdersLoading]=useState(false);
  const [ordersError,setOrdersError]=useState('');
  const [flashHolds,setFlashHolds]=useState([]);
  const [myReservations,setMyReservations]=useState([]);
  const regularOrders=realOrders.filter(order=>order.pool_id&&order.reservation_id);
  const refreshBuyerOrders=async()=>{
    if(!isAuthenticated||user?.role!=='BUYER')return;
    try{
      const [o,h,r]=await Promise.all([
        apiClient.get('/orders',{params:{limit:20}}),
        apiClient.get('/flash-pools/holds/mine'),
        apiClient.get('/reservations/my')
      ]);
      setRealOrders(o.data?.data?.orders||[]);
      setFlashHolds(h.data?.data?.holds||[]);
      setMyReservations(r.data?.data?.reservations||[]);
      setOrdersError('');
    }catch(e){setOrdersError(e.response?.data?.error?.message||'Could not retrieve your orders, Flash holds or reservations.');}
  };
  useEffect(()=>{
    if(!isAuthenticated || user?.role!=='BUYER')return;
    let mounted=true;
    setOrdersLoading(true);
    Promise.all([
      apiClient.get('/orders',{params:{limit:20}}),
      apiClient.get('/flash-pools/holds/mine'),
      apiClient.get('/reservations/my')
    ]).then(([orders,holds,reservations])=>{
      if(!mounted)return;
      setRealOrders(orders.data?.data?.orders||[]);
      setFlashHolds(holds.data?.data?.holds||[]);
      setMyReservations(reservations.data?.data?.reservations||[]);
    }).catch(e=>{if(mounted)setOrdersError(e.response?.data?.error?.message||'Cannot load buyer procurement history');})
      .finally(()=>{if(mounted)setOrdersLoading(false)});
    return()=>{mounted=false};
  },[isAuthenticated,user?.role]);

  return (
    <AppShell>
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8 transition-colors duration-200">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-sans font-medium mb-2 border shadow-2xs"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--brand-accent)',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>{isAuthenticated ? `Buyer Account · ${user?.business_name || user?.full_name || 'Verified Member'}` : 'Guest Preview'}</span>
            </div>
            <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Procurement Orders & Reservations
            </h1>
            <p className="mt-1 text-xs sm:text-sm max-w-xl" style={{ color: 'var(--text-muted)' }}>
              Track pooled commodity commitments, collective volume lock milestones, and delivery fulfillment.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link to="/pools">
              <button
                type="button"
                className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
                style={{
                  backgroundColor: 'var(--brand-accent)',
                  color: '#072a21',
                }}
              >
                <Layers className="w-4 h-4" />
                <span>Explore Active Pools</span>
              </button>
            </Link>
          </div>
        </div>

        {/* Operational Overview Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div
            className="p-4 sm:p-5 rounded-2xl border"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-sans text-stone-500">Active Commitments</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-bold font-sans tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {realOrders.length}
              </span>
              <span className="ml-1 text-xs text-stone-500">orders</span>
            </div>
          </div>

          <div
            className="p-4 sm:p-5 rounded-2xl border"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-sans text-stone-500">Volume Locked</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl font-bold font-sans tabular-nums" style={{ color: 'var(--text-primary)' }}>
                Rs. 0
              </span>
              <span className="ml-1 text-xs text-stone-500">settled volume</span>
            </div>
          </div>

          <div
            className="p-4 sm:p-5 rounded-2xl border"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-sans text-stone-500">Escrow Protection</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center border"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                100% Safepay Protected
              </span>
              <p className="text-[11px] text-stone-500 mt-0.5">
                Funds released upon physical batch inspection
              </p>
            </div>
          </div>
        </div>

        {/* Filter Navigation Tabs */}
        <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
          {[
            { id: 'ALL', label: 'All Reservations' },
            { id: 'ACTIVE', label: 'Active Aggregations' },
            { id: 'LOCKED', label: 'Tier Locked' },
            { id: 'FULFILLED', label: 'Fulfilled Batches' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-sans transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'font-semibold shadow-xs'
                  : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
              style={{
                backgroundColor: activeTab === tab.id ? 'var(--bg-sidebar-active)' : 'transparent',
                color: activeTab === tab.id ? 'var(--text-primary)' : undefined,
                border: activeTab === tab.id ? '1px solid var(--border-subtle)' : '1px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Real B4 orders use authoritative payment hold status, not sample data. */}
        {ordersLoading && <p className="text-xs text-[var(--text-muted)]">Loading your procurement orders…</p>}
        {ordersError && <p role="alert" className="text-xs text-red-600">{ordersError}</p>}
        {!ordersLoading && regularOrders.length > 0 && (
          <section className="space-y-3" aria-label="Your regular pool orders">
            <h2 className="font-semibold text-lg">Your Regular Pool Payments</h2>
            {regularOrders.map(order=>
              <RegularPaymentHoldCard key={order.id} order={order}/>
            )}
          </section>
        )}
        {!ordersLoading && !ordersError && flashHolds.length>0&&<section aria-label="Your Flash Pool checkout holds" className="space-y-3">
          <h2 className="text-lg font-semibold">Flash Pool Payments & Holds</h2>
          {flashHolds.map(hold=><FlashPaymentHoldCard key={hold.hold_id} hold={hold} onRefresh={refreshBuyerOrders}/>)}
        </section>}
        {!ordersLoading && !ordersError && myReservations.length>0&&<section aria-label="Your Regular Pool reservations" className="space-y-3">
          <h2 className="text-lg font-semibold">Your Regular Pool Reservations</h2>
          {myReservations.map(r=><div key={r.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-2">
            <div className="flex justify-between gap-2 text-xs"><strong>{r.specification?.product_title||r.reservation_code}</strong>
              <span>{r.status}</span></div>
            <p className="text-xs text-[var(--text-muted)]">Reference: {r.reservation_code} · Reserved quantity: {r.quantity} · Supplier: {r.supplier?.business_name||'Not available'}</p>
            <p className="text-xs text-[var(--text-muted)]">Reservation is not a paid order. Final price and payment become available only after supplier qualification and your commercial acceptance.</p>
          </div>)}
        </section>}
        {!ordersLoading && !ordersError && regularOrders.length === 0 && flashHolds.length===0 && myReservations.length===0 && (
          <>
        {/* Empty State / Truthful Real Data Display */}
        <div
          className="p-8 sm:p-12 rounded-3xl border text-center flex flex-col items-center justify-center max-w-xl mx-auto shadow-xs"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 border"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <ClipboardList className="w-7 h-7" style={{ color: 'var(--brand-accent)' }} />
          </div>

          <h3 className="font-display font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
            No Regular Pool Orders Yet
          </h3>

          <p className="text-xs text-stone-500 mt-2 max-w-sm leading-relaxed">
            {isAuthenticated
              ? 'You do not have any Regular Pool orders requiring payment right now. Browse live Regular Pools to join a supplier offer.'
              : 'Sign in to reserve quantities and aggregate bulk volume for lower wholesale prices with guaranteed escrow delivery.'}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/pools">
              <button
                type="button"
                className="px-5 py-2.5 rounded-full text-xs font-semibold flex items-center justify-center shadow-xs transition-all cursor-pointer"
                style={{
                  backgroundColor: 'var(--brand-accent)',
                  color: '#072a21',
                }}
              >
                <span>Browse Active Commodity Pools</span>
              </button>
            </Link>

            {!isAuthenticated && (
              <Link to="/login">
                <button
                  type="button"
                  className="px-4 py-2.5 rounded-full text-xs font-medium border transition-colors cursor-pointer"
                  style={{
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Sign In to Account
                </button>
              </Link>
            )}
          </div>

          {/* Clean B2B Sample Order Flow (Strictly NO Emoji) */}
          {FLAGS.ordersSamplePreview && (
            <div className="mt-6 pt-4 border-t w-full" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setShowSamplePreview(!showSamplePreview)}
                className="text-xs font-semibold underline transition cursor-pointer"
                style={{ color: 'var(--brand-accent)' }}
              >
                {showSamplePreview ? 'Hide Sample Order Lifecycle' : 'Preview Example B2B Order Flow'}
              </button>
            </div>
          )}
        </div>

        {/* Interactive Sample Order Card (Feature Flag Protected - STRICTLY NO EMOJI) */}
        {FLAGS.ordersSamplePreview && showSamplePreview && (
          <div
            className="p-6 sm:p-7 rounded-3xl border shadow-md space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-200"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <span className="text-[10px] font-sans font-medium uppercase tracking-wider text-emerald-800 dark:text-champagne">
                  Simulated Active Batch · Order #MLJ-8421
                </span>
                <h3 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                  Super Kernel Basmati Rice (100 kg reserved)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  Wholesale Tier 2 Locked · Rs. 295/kg
                </span>
              </div>
            </div>

            {/* 5-Stage Milestone Progress Tracker */}
            <div>
              <p className="text-xs font-medium mb-3 text-stone-500">Live Batch Aggregation & Delivery Pipeline</p>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-center text-xs">
                <div className="p-3 rounded-xl border bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
                  <span className="font-semibold block text-[11px]">1. Pooled</span>
                  <span className="text-[10px] opacity-80">5,000 kg Met</span>
                </div>
                <div className="p-3 rounded-xl border bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
                  <span className="font-semibold block text-[11px]">2. Tier Locked</span>
                  <span className="text-[10px] opacity-80">Rs. 295 / kg</span>
                </div>
                <div className="p-3 rounded-xl border bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200">
                  <Clock className="w-4 h-4 mx-auto mb-1 text-amber-600 animate-pulse" />
                  <span className="font-semibold block text-[11px]">3. QC Testing</span>
                  <span className="text-[10px] opacity-80">Moisture &lt; 12%</span>
                </div>
                <div className="p-3 rounded-xl border opacity-50" style={{ borderColor: 'var(--border-subtle)' }}>
                  <Truck className="w-4 h-4 mx-auto mb-1 text-stone-400" />
                  <span className="font-semibold block text-[11px]">4. Dispatched</span>
                  <span className="text-[10px] opacity-80">Pending QC</span>
                </div>
                <div className="p-3 rounded-xl border opacity-50" style={{ borderColor: 'var(--border-subtle)' }}>
                  <ShieldCheck className="w-4 h-4 mx-auto mb-1 text-stone-400" />
                  <span className="font-semibold block text-[11px]">5. Escrow Release</span>
                  <span className="text-[10px] opacity-80">On Inspection</span>
                </div>
              </div>
            </div>

            {/* Financial & Settlement Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl" style={{ backgroundColor: 'var(--bg-elevated)' }}>
              <div>
                <span className="text-[10px] text-stone-500 block">Total Pooled Value</span>
                <span className="font-bold text-sm tabular-nums" style={{ color: 'var(--text-primary)' }}>Rs. 29,500</span>
              </div>
              <div>
                <span className="text-[10px] text-stone-500 block">Escrow Deposit (20%)</span>
                <span className="font-bold text-sm text-emerald-700 dark:text-emerald-400 tabular-nums">Rs. 5,900 Paid</span>
              </div>
              <div>
                <span className="text-[10px] text-stone-500 block">Est. Delivery</span>
                <span className="font-bold text-sm tabular-nums" style={{ color: 'var(--text-primary)' }}>Tomorrow, 10:00 AM</span>
              </div>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </AppShell>
  );
};

export default OrdersPage;
