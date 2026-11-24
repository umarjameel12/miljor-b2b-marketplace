import React, { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import adminApi from '../../api/admin';

export function AdminOrderApprovalPanel() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [rejectReasons, setRejectReasons] = useState({});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.getPendingApprovalOrders();
      setOrders(res?.data?.orders || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Unable to load pending order approval queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleApprove = async (orderId) => {
    setBusyId(orderId);
    setError('');
    setMessage('');
    try {
      await adminApi.approveOrder(orderId, 'Approved via Admin Operations Queue');
      setMessage(`Order #${orderId} approved for supplier fulfillment.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Order approval failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (orderId) => {
    const reason = (rejectReasons[orderId] || '').trim();
    if (reason.length < 5) {
      setError('Enter a rejection reason (at least 5 characters).');
      return;
    }
    setBusyId(orderId);
    setError('');
    setMessage('');
    try {
      const res = await adminApi.rejectOrder(orderId, reason);
      const refundNote = res?.data?.refund_obligation_created
        ? ' Refund obligation recorded (external execution disabled).'
        : '';
      setMessage(`Order #${orderId} rejected.${refundNote}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Order rejection failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-label="Mandatory order admin approval queue"
      className="rounded-2xl border p-5 sm:p-6 space-y-4"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
            Mandatory order approval gate
          </p>
          <p className="text-lg font-bold">
            {loading ? '…' : orders.length}{' '}
            <span className="text-xs font-normal opacity-70">
              buyer procurement orders awaiting admin review before supplier forwarding
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs rounded-lg border disabled:opacity-50"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="text-xs rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="text-xs rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-2">
          {message}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <p className="text-xs opacity-70">No buyer orders are currently waiting in the Admin Approval Queue.</p>
      )}

      <div className="space-y-3">
        {orders.map((order) => (
          <div
            key={order.id}
            className="rounded-xl border p-4 space-y-3"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-sm">
                  {order.order_code} · {order.buyer_name} → {order.supplier_name}
                </div>
                <div className="text-xs opacity-70">
                  Qty: {order.total_qty} · Total: {order.currency || 'PKR'} {Number(order.total_amount || 0).toLocaleString()} · Payment: {order.payment_status} · Order: {order.order_status}
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <Clock className="w-3 h-3" /> Pending Admin Approval
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyId === order.id}
                onClick={() => handleApprove(order.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve for Supplier Fulfillment
              </button>
              <input
                type="text"
                aria-label={`Rejection reason for ${order.order_code}`}
                placeholder="Rejection reason (min 5 chars)"
                value={rejectReasons[order.id] || ''}
                onChange={(e) => setRejectReasons((prev) => ({ ...prev, [order.id]: e.target.value }))}
                className="px-2.5 py-1.5 text-xs rounded-lg border flex-1 min-w-[200px]"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
              />
              <button
                type="button"
                disabled={busyId === order.id}
                onClick={() => handleReject(order.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-500/40 text-rose-700 dark:text-rose-300 disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject Order
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
