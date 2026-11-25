import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  ShieldCheck,
  Lock,
  CreditCard,
  Building2,
  Smartphone,
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Clock,
  CheckCircle2,
  Receipt,
  Truck,
  PackageCheck
} from 'lucide-react';

function formatCurrency(amount, currency = 'PKR') {
  const num = Number(amount || 0);
  return `${currency} ${num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CheckoutPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const [order, setOrder] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [initiating, setInitiating] = useState(false);
  const checkoutKeyRef = useRef(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate(`/login?redirect=/checkout/${orderId}`);
      return;
    }
    if (user?.role !== 'BUYER' && !['ADMIN', 'SUPER_ADMIN'].includes(user?.role)) {
      setError('Only verified buyer accounts may initiate checkout sessions.');
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError('');

    Promise.all([
      apiClient.get(`/orders/${orderId}`),
      apiClient.get(`/orders/${orderId}/payment-status`).catch(() => ({ data: { success: false } }))
    ])
      .then(([orderRes, statusRes]) => {
        if (!isMounted) return;
        const fetchedOrder = orderRes?.data?.data?.order || orderRes?.data?.data;
        if (!fetchedOrder) {
          throw new Error('Order details could not be found.');
        }
        setOrder(fetchedOrder);
        if (statusRes?.data?.success) {
          setPaymentStatus(statusRes.data.data);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.response?.data?.error?.message || err.message || 'Unable to load order details');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [orderId, isAuthenticated, authLoading, user?.role, navigate]);

  const handleInitiateSafepayCheckout = async () => {
    if (initiating) return;
    setInitiating(true);
    setError('');

    try {
      if (!checkoutKeyRef.current) {
        checkoutKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
          ? `chk-${orderId}-${crypto.randomUUID()}`
          : `chk-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
      const idempotencyKey = checkoutKeyRef.current;

      const origin = window.location.origin;
      const redirectUrl = `${origin}/payment/return?order_id=${orderId}`;
      const cancelUrl = `${origin}/payment/cancelled?order_id=${orderId}`;

      const response = await apiClient.post(
        `/orders/${orderId}/checkout`,
        {
          redirect_url: redirectUrl,
          cancel_url: cancelUrl
        },
        {
          headers: {
            'X-Idempotency-Key': idempotencyKey
          }
        }
      );

      const checkoutUrl = response?.data?.data?.checkout_url;
      if (!checkoutUrl || !/^https:\/\//i.test(checkoutUrl)) {
        throw new Error('Authoritative Safepay checkout URL was not provided by the gateway.');
      }

      // Safe navigation to hosted sandbox checkout
      window.location.assign(checkoutUrl);
    } catch (err) {
      setInitiating(false);
      setError(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to connect to Safepay sandbox checkout. Please try again.'
      );
    }
  };

  if (authLoading || loading) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="w-10 h-10 border-2 border-[var(--brand-accent)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-sans tracking-wide" style={{ color: 'var(--text-secondary)' }}>
            Retrieving authoritative order settlement data…
          </p>
        </div>
      </AppShell>
    );
  }

  if (error && !order) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto p-6 my-12">
          <div
            className="p-8 rounded-3xl border text-center space-y-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)'
            }}
          >
            <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center border bg-red-500/10 border-red-500/20 text-red-600">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-display font-semibold" style={{ color: 'var(--text-primary)' }}>
              Order Checkout Unavailable
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {error}
            </p>
            <div className="pt-2">
              <Link
                to="/orders"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-[var(--brand-accent)] text-[#072a21] hover:opacity-90 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Orders</span>
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const isAlreadyPaid = order?.payment_status === 'PAID' || paymentStatus?.payment_status === 'PAID';
  const hold = paymentStatus?.regular_pool_payment_hold;
  const isHoldExpired = hold && hold.status === 'EXPIRED';

  const subtotal = Number(order?.subtotal_amount || (Number(order?.quantity || 0) * Number(order?.final_unit_price || 0)));
  const deliveryFee = Number(order?.delivery_fee || 0);
  const platformFee = Number(order?.platform_fee || order?.buyer_platform_fee || 0);
  const taxAmount = Number(order?.tax_amount || 0);
  const totalAmount = Number(order?.total_amount || (subtotal + deliveryFee + platformFee + taxAmount));

  return (
    <AppShell>
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8">
        {/* Navigation & Breadcrumb */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <Link
              to="/orders"
              className="p-2 rounded-xl border hover:opacity-80 transition cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-primary)'
              }}
              title="Return to Orders"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--brand-accent)'
                  }}
                >
                  Safepay Escrow
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Order #{order?.order_code || orderId}
                </span>
              </div>
              <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight mt-0.5" style={{ color: 'var(--text-primary)' }}>
                B2B Procurement Settlement
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>256-Bit Encrypted Sandbox Checkout</span>
          </div>
        </div>

        {/* Paid Notice If Order Is Already Settled */}
        {isAlreadyPaid && (
          <div
            className="p-6 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              borderColor: 'rgba(16, 185, 129, 0.3)'
            }}
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  Payment Verified & Held in Escrow
                </h3>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                  This order has already been funded. The supplier has been authorized to prepare and dispatch your batch.
                </p>
              </div>
            </div>
            <Link
              to="/orders"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
            >
              View in Orders
            </Link>
          </div>
        )}

        {/* Expired Hold Notice */}
        {!isAlreadyPaid && isHoldExpired && (
          <div
            className="p-6 rounded-2xl border flex items-start gap-3"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              borderColor: 'rgba(239, 68, 68, 0.3)'
            }}
          >
            <Clock className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
                Payment Hold Expired
              </h3>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                The committed payment window for this pool reservation has elapsed. A new checkout session is locked by policy to prevent inventory overdraft. Please contact MilJor support or check active pools to place a new reservation.
              </p>
            </div>
          </div>
        )}

        {/* Main Grid: Left Details & Right Commercial Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Order Breakdown & Payment Methods (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Commodity Spec Card */}
            <div
              className="p-5 sm:p-6 rounded-3xl border space-y-4"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)'
              }}
            >
              <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Procurement Item
                </span>
                <span className="text-xs font-mono font-medium" style={{ color: 'var(--brand-accent)' }}>
                  Batch #{order?.order_code || orderId}
                </span>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-display font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {order?.product_title || 'Wholesale Commodity'}
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Supplier: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{order?.supplier_business_name || order?.supplier_name || 'Verified MilJor Supplier'}</span>
                  </p>
                  {order?.origin_city && (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Fulfillment Hub: {order.origin_city}
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-xs font-sans text-stone-500 block">Committed Volume</span>
                  <span className="text-base font-bold font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {Number(order?.quantity || 0).toLocaleString()} {order?.unit || 'KG'}
                  </span>
                </div>
              </div>

              {/* Unit Economics Highlight */}
              <div
                className="p-3.5 rounded-2xl border flex items-center justify-between text-xs"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)'
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>Locked Wholesale Tier Rate</span>
                <span className="font-mono font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {formatCurrency(order?.final_unit_price || 0, order?.currency)} / {order?.unit || 'KG'}
                </span>
              </div>
            </div>

            {/* Safepay Sandbox Gateway Overview */}
            <div
              className="p-5 sm:p-6 rounded-3xl border space-y-4"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)'
              }}
            >
              <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Payment Method
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Safepay Sandbox
                </span>
              </div>

              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                You will be redirected to the official Safepay hosted checkout to complete this transaction via sandbox test channels. No live funds will be deducted from your account.
              </p>

              {/* Supported Channels in Safepay Sandbox */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div
                  className="p-3 rounded-2xl border flex items-center gap-3"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)'
                  }}
                >
                  <CreditCard className="w-5 h-5 text-[var(--brand-accent)] shrink-0" />
                  <div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Cards</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Visa · MC · PayPak</div>
                  </div>
                </div>

                <div
                  className="p-3 rounded-2xl border flex items-center gap-3"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)'
                  }}
                >
                  <Building2 className="w-5 h-5 text-[var(--brand-accent)] shrink-0" />
                  <div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Raast</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Direct Bank Transfer</div>
                  </div>
                </div>

                <div
                  className="p-3 rounded-2xl border flex items-center gap-3"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)'
                  }}
                >
                  <Smartphone className="w-5 h-5 text-[var(--brand-accent)] shrink-0" />
                  <div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Wallets</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Easypaisa · JazzCash</div>
                  </div>
                </div>
              </div>

              {/* Escrow Guarantee Notice */}
              <div
                className="p-3.5 rounded-2xl border flex items-start gap-3 text-xs"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)'
                }}
              >
                <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Escrow-Backed Buyer Protection
                  </span>
                  <p className="text-[11px] leading-normal" style={{ color: 'var(--text-muted)' }}>
                    Your deposit is held securely in escrow custody by MilJor. Funds are released to the supplier only after goods are delivered and verified by your receiving dock.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Commercial Breakdown & Checkout Action (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            <div
              className="p-6 rounded-3xl border space-y-5 sticky top-24"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)'
              }}
            >
              <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-[var(--brand-accent)]" />
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Payment Summary
                  </span>
                </div>
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  Authoritative Read
                </span>
              </div>

              {/* Line items */}
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Wholesale Commodity Subtotal</span>
                  <span className="font-mono font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(subtotal, order?.currency)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Cold-Chain Logistics & Delivery</span>
                  <span className="font-mono font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {deliveryFee > 0 ? formatCurrency(deliveryFee, order?.currency) : 'Included'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>MilJor Platform Escrow Fee</span>
                  <span className="font-mono font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {platformFee > 0 ? formatCurrency(platformFee, order?.currency) : 'PKR 0.00'}
                  </span>
                </div>

                {taxAmount > 0 && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Applicable Sales Tax (GST)</span>
                    <span className="font-mono font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {formatCurrency(taxAmount, order?.currency)}
                    </span>
                  </div>
                )}

                <div className="pt-3 border-t flex items-baseline justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <span className="text-sm font-semibold block" style={{ color: 'var(--text-primary)' }}>
                      Total Escrow Payable
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      Guaranteed Rate in Pakistani Rupee
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xl sm:text-2xl font-bold tabular-nums" style={{ color: 'var(--brand-accent)' }}>
                      {formatCurrency(totalAmount, order?.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Error Alert */}
              {error && (
                <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                {!isAlreadyPaid && !isHoldExpired ? (
                  <button
                    type="button"
                    disabled={initiating}
                    onClick={handleInitiateSafepayCheckout}
                    className="w-full py-3.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition cursor-pointer disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--brand-accent)',
                      color: '#072a21'
                    }}
                  >
                    {initiating ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Connecting to Safepay…</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Pay via Safepay Sandbox</span>
                        <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                      </>
                    )}
                  </button>
                ) : isAlreadyPaid ? (
                  <Link
                    to="/orders"
                    className="w-full py-3 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border hover:opacity-90 transition text-center"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <PackageCheck className="w-4 h-4 text-emerald-600" />
                    <span>View Fulfillment Status</span>
                  </Link>
                ) : (
                  <Link
                    to="/pools"
                    className="w-full py-3 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border hover:opacity-90 transition text-center"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <span>Browse Active Pools</span>
                  </Link>
                )}

                <Link
                  to="/orders"
                  className="block text-center text-xs py-2 hover:underline transition"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Cancel & Return to Orders
                </Link>
              </div>

              {/* Trust & Security Footnote */}
              <div className="pt-2 border-t text-[10px] space-y-1.5" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-emerald-600" />
                  <span>Idempotent request tokens prevent duplicate charges.</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3 h-3 text-[var(--brand-accent)]" />
                  <span>Licensed under State Bank of Pakistan sandbox guidelines.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
