import React, { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import apiClient from '../../api/client';

export function AdminSubscriptionApprovalPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [rejectReasons, setRejectReasons] = useState({});

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/admin/subscriptions');
      setItems(res?.data?.data?.subscriptions || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Unable to load supplier subscription queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleApprove = async (subscriptionId) => {
    setBusyId(subscriptionId);
    setError('');
    try {
      await apiClient.post(`/admin/subscriptions/${subscriptionId}/approve`, {
        notes: 'Approved via Admin Operations Queue'
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Approval failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (subscriptionId) => {
    const reason = (rejectReasons[subscriptionId] || '').trim();
    if (reason.length < 5) {
      setError('Enter a rejection reason (at least 5 characters).');
      return;
    }
    setBusyId(subscriptionId);
    setError('');
    try {
      await apiClient.post(`/admin/subscriptions/${subscriptionId}/reject`, { reason });
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Rejection failed.');
    } finally {
      setBusyId(null);
    }
  };

  const pendingItems = items.filter((i) => i.admin_approval_status === 'PENDING_ADMIN_APPROVAL');

  return (
    <section
      className="rounded-2xl border p-5 sm:p-6 space-y-4"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
            Supplier subscription approval gate
          </p>
          <p className="text-lg font-bold">
            {loading ? '…' : pendingItems.length}{' '}
            <span className="text-xs font-normal opacity-70">
              verified paid subscriptions awaiting activation review
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
        <div className="text-xs rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 py-2">
          {error}
        </div>
      )}

      {!loading && pendingItems.length === 0 && (
        <p className="text-xs opacity-70">No paid supplier subscriptions are currently waiting for approval.</p>
      )}

      <div className="space-y-3">
        {pendingItems.map((sub) => (
          <div
            key={sub.id}
            className="rounded-xl border p-4 space-y-3"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-sm">
                  {sub.supplier_name || `Supplier #${sub.supplier_id}`} — {sub.plan_code}
                </div>
                <div className="text-xs opacity-70">
                  PKR {Number(sub.price_pkr || 0).toLocaleString()} · Tracker: {sub.tracker_token || 'N/A'} · Status: {sub.status}
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <Clock className="w-3 h-3" /> Pending Admin Approval
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyId === sub.id}
                onClick={() => handleApprove(sub.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve & Activate
              </button>
              <input
                type="text"
                placeholder="Rejection reason (min 5 chars)"
                value={rejectReasons[sub.id] || ''}
                onChange={(e) => setRejectReasons((prev) => ({ ...prev, [sub.id]: e.target.value }))}
                className="px-2.5 py-1.5 text-xs rounded-lg border flex-1 min-w-[200px]"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
              />
              <button
                type="button"
                disabled={busyId === sub.id}
                onClick={() => handleReject(sub.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-500/40 text-rose-700 dark:text-rose-300 disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject (Create Refund Obligation)
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
