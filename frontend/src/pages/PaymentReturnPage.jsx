import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useSearchParams, useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Receipt,
  PackageCheck
} from 'lucide-react';

function formatCurrency(amount, currency = 'PKR') {
  const num = Number(amount || 0);
  return `${currency} ${num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PaymentReturnPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const isCancelRoute = location.pathname.includes('/cancelled');
  const orderId = searchParams.get('order_id') || searchParams.get('order');
  const trackerBeacon = searchParams.get('beacon') || searchParams.get('tracker');

  const [state, setState] = useState(isCancelRoute ? 'CANCELLED' : 'VERIFYING');
  const [paymentData, setPaymentData] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const reconciledRef = useRef(false);

  const checkStatusAndReconcile = useCallback(async () => {
    if (!orderId) {
      setState('ERROR');
      setErrorMessage('Order reference was not provided in the return callback.');
      return;
    }

    setReconciling(true);
    setErrorMessage('');

    try {
      // Step 1: Read current authoritative order status
      const { data: statusRes } = await apiClient.get(`/orders/${orderId}/payment-status`);
      const statusData = statusRes?.data;
      setPaymentData(statusData);

      if (statusData?.payment_status === 'PAID' || statusData?.order_status === 'PAID') {
        setState('PAID');
        setReconciling(false);
        return;
      }

      // Step 2: If not yet confirmed PAID, trigger server-to-server Safepay reconciliation
      try {
        const { data: reconcileRes } = await apiClient.post(`/orders/${orderId}/reconcile`);
        if (reconcileRes?.success) {
          // Re-fetch authoritative status after reconciliation
          const { data: updatedRes } = await apiClient.get(`/orders/${orderId}/payment-status`);
          const updatedData = updatedRes?.data;
          setPaymentData(updatedData);

          if (updatedData?.payment_status === 'PAID' || updatedData?.order_status === 'PAID') {
            setState('PAID');
          } else {
            setState('PENDING');
          }
        } else {
          setState('PENDING');
        }
      } catch (reconErr) {
        // If reconciliation encountered an error, fall back to current status state
        if (statusData?.payment_status === 'PAYMENT_INITIATED') {
          setState('PENDING');
        } else {
          setState('PENDING');
        }
      }
    } catch (err) {
      setState('ERROR');
      setErrorMessage(
        err.response?.data?.error?.message ||
        err.message ||
        'Unable to verify payment status with MilJor server.'
      );
    } finally {
      setReconciling(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (authLoading) return;

    if (isCancelRoute) {
      setState('CANCELLED');
      if (isAuthenticated && orderId && !paymentData) {
        apiClient.get(`/orders/${orderId}/payment-status`)
          .then((res) => {
            if (res.data?.success) setPaymentData(res.data.data);
          })
          .catch(() => {});
      }
      return;
    }

    if (!isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }

    if (!reconciledRef.current) {
      reconciledRef.current = true;
      checkStatusAndReconcile();
    }
  }, [authLoading, isAuthenticated, isCancelRoute, orderId, checkStatusAndReconcile, location.pathname, location.search, navigate, paymentData]);

  return (
    <AppShell>
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-8 my-8">
        {/* State 1: VERIFYING */}
        {state === 'VERIFYING' && (
          <div
            className="p-8 sm:p-12 rounded-3xl border text-center space-y-6 shadow-sm"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)'
            }}
          >
            <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center border bg-[var(--bg-elevated)] border-[var(--border-subtle)]">
              <RefreshCw className="w-7 h-7 text-[var(--brand-accent)] animate-spin" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>
                Reconciling Safepay Settlement
              </h1>
              <p className="text-xs sm:text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
                Authoritatively synchronizing payment confirmation with Safepay sandbox and updating your order escrow records…
              </p>
            </div>
          </div>
        )}

        {/* State 2: PAID (Confirmed Escrow) */}
        {state === 'PAID' && (
          <div
            className="p-8 sm:p-12 rounded-3xl border text-center space-y-6 shadow-sm"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'rgba(16, 185, 129, 0.3)'
            }}
          >
            <div className="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center border bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">
                Payment Confirmed & Secured in Escrow
              </span>
              <h1 className="text-2xl sm:text-3xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>
                Procurement Order Funded
              </h1>
              <p className="text-xs sm:text-sm max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
                Your payment has been verified with Safepay. Funds are held in escrow custody and the supplier has been notified to commence batch packaging and cold-chain dispatch.
              </p>
            </div>

            {/* Authoritative Receipt Card */}
            <div
              className="p-5 rounded-2xl border text-left space-y-3 max-w-md mx-auto text-xs"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border-subtle)'
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Order Code</span>
                <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {paymentData?.order_code || `ORD-${orderId}`}
                </span>
              </div>

              <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Settled Amount</span>
                <span className="font-mono font-bold text-sm" style={{ color: 'var(--brand-accent)' }}>
                  {formatCurrency(paymentData?.total_amount, paymentData?.currency)}
                </span>
              </div>

              <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Gateway Status</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                  Captured (Safepay Sandbox)
                </span>
              </div>

              {(paymentData?.latest_attempt?.provider_tracker_token || trackerBeacon) && (
                <div className="flex items-center justify-between">
                  <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Safepay Beacon</span>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {paymentData?.latest_attempt?.provider_tracker_token || trackerBeacon}
                  </span>
                </div>
              )}
            </div>

            {/* Next Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Link
                to="/orders"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition"
                style={{
                  backgroundColor: 'var(--brand-accent)',
                  color: '#072a21'
                }}
              >
                <PackageCheck className="w-4 h-4" />
                <span>Track Fulfillment in Orders</span>
              </Link>

              <Link
                to="/pools"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border hover:opacity-90 transition"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              >
                <span>Browse More Active Pools</span>
              </Link>
            </div>
          </div>
        )}

        {/* State 3: PENDING (Waiting for Gateway) */}
        {state === 'PENDING' && (
          <div
            className="p-8 sm:p-12 rounded-3xl border text-center space-y-6 shadow-sm"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'rgba(245, 158, 11, 0.3)'
            }}
          >
            <div className="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center border bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400">
              <Clock className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">
                Payment Awaiting Confirmation
              </span>
              <h1 className="text-2xl sm:text-3xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>
                Processing with Safepay
              </h1>
              <p className="text-xs sm:text-sm max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
                Your payment was received by the payment processor and is undergoing final settlement verification. You can refresh below or check your orders dashboard.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                disabled={reconciling}
                onClick={checkStatusAndReconcile}
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition cursor-pointer disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--brand-accent)',
                  color: '#072a21'
                }}
              >
                <RefreshCw className={`w-4 h-4 ${reconciling ? 'animate-spin' : ''}`} />
                <span>{reconciling ? 'Checking Gateway…' : 'Recheck Status Now'}</span>
              </button>

              <Link
                to="/orders"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border hover:opacity-90 transition"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              >
                <span>Go to Orders</span>
              </Link>
            </div>
          </div>
        )}

        {/* State 4: CANCELLED */}
        {state === 'CANCELLED' && (
          <div
            className="p-8 sm:p-12 rounded-3xl border text-center space-y-6 shadow-sm"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)'
            }}
          >
            <div className="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center border bg-stone-500/10 border-stone-500/20 text-stone-600 dark:text-stone-400">
              <XCircle className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full border bg-stone-500/10 text-stone-700 dark:text-stone-300 border-stone-500/20">
                Checkout Discontinued
              </span>
              <h1 className="text-2xl sm:text-3xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>
                Payment Cancelled
              </h1>
              <p className="text-xs sm:text-sm max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
                You cancelled the Safepay checkout session. No funds were debited. Your pool allocation remains held until the pool payment deadline elapses.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              {orderId && (
                <Link
                  to={`/checkout/${orderId}`}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition"
                  style={{
                    backgroundColor: 'var(--brand-accent)',
                    color: '#072a21'
                  }}
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Resume Checkout</span>
                </Link>
              )}

              <Link
                to="/orders"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border hover:opacity-90 transition"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Orders</span>
              </Link>
            </div>
          </div>
        )}

        {/* State 5: ERROR */}
        {state === 'ERROR' && (
          <div
            className="p-8 sm:p-12 rounded-3xl border text-center space-y-6 shadow-sm"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'rgba(239, 68, 68, 0.3)'
            }}
          >
            <div className="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center border bg-red-500/10 border-red-500/20 text-red-600">
              <AlertTriangle className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-display font-bold" style={{ color: 'var(--text-primary)' }}>
                Verification Error
              </h1>
              <p className="text-xs sm:text-sm max-w-lg mx-auto" style={{ color: 'var(--text-muted)' }}>
                {errorMessage || 'An error occurred while reconciling the payment transaction.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              {orderId && (
                <button
                  type="button"
                  onClick={checkStatusAndReconcile}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                  style={{
                    backgroundColor: 'var(--brand-accent)',
                    color: '#072a21'
                  }}
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Try Verifying Again</span>
                </button>
              )}

              <Link
                to="/orders"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border hover:opacity-90 transition"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              >
                <span>Return to Orders</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
