import React, { useEffect, useState } from 'react';
import { deliveryRunsApi } from '../../api/deliveryRuns';

export function AdminDeliveryRecoveryPanel() {
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async (signal) => {
    setLoading(true);
    setError('');
    try {
      const res = await deliveryRunsApi.getAdminExceptions({ signal });
      setStops(res.stops || []);
    } catch (err) {
      if (err?.name !== 'CanceledError') {
        setError(err.response?.data?.error?.message || err.message || 'Unable to load delivery exceptions.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  const recover = async (stopId, action) => {
    if (pending) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      await deliveryRunsApi.adminRecoverStop(stopId, {
        action,
        reason: `Admin audited delivery recovery (${action})`
      });
      setMessage(`Audited recovery ${action} applied to stop #${stopId}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Admin recovery failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label="Admin delivery exception recovery" className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold">Delivery Exceptions &amp; Audited Recovery</h3>
        <button type="button" className="underline" disabled={loading || pending} onClick={() => load()}>
          Refresh
        </button>
      </div>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {message && <p role="status" className="text-emerald-700 dark:text-emerald-300">{message}</p>}
      {loading && <p className="text-[var(--text-muted)]">Loading exceptions…</p>}
      {!loading && stops.length === 0 && <p className="text-[var(--text-muted)]">No delivery stop exceptions pending.</p>}
      {stops.map((stop) => (
        <div key={stop.id} className="p-2 rounded border border-[var(--border-subtle)] flex flex-wrap justify-between items-center gap-2">
          <span>
            {stop.order_code} ({stop.run_code}) · {stop.status} · Attempts: {stop.attempt_count}/{stop.max_attempts}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => recover(stop.id, 'SCHEDULE_REATTEMPT')} className="px-2 py-1 rounded border border-[var(--border-subtle)]">
              Schedule Reattempt
            </button>
            <button type="button" disabled={pending} onClick={() => recover(stop.id, 'MARK_SLA_BREACH')} className="px-2 py-1 rounded border border-[var(--border-subtle)]">
              Record SLA Breach
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
