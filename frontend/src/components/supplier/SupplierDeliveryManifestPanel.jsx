import React, { useEffect, useState } from 'react';
import { deliveryRunsApi } from '../../api/deliveryRuns';

export function SupplierDeliveryManifestPanel() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [etaInput, setEtaInput] = useState('');
  const [pickupCodes, setPickupCodes] = useState({});
  const [failReason, setFailReason] = useState('BUYER_UNAVAILABLE');

  const load = async (signal) => {
    setLoading(true);
    setError('');
    try {
      const res = await deliveryRunsApi.getSupplierManifest({ signal });
      setRuns(res.runs || []);
    } catch (err) {
      if (err?.name !== 'CanceledError') {
        setError(err.response?.data?.error?.message || err.message || 'Unable to load delivery manifest.');
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

  const act = async (fn, successMsg) => {
    if (pending) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage(successMsg);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Delivery manifest action failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label="Supplier delivery runs manifest" className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-base font-semibold">Clustered Delivery Runs &amp; Stops</h3>
        <button type="button" className="text-xs underline" disabled={loading || pending} onClick={() => load()}>
          Refresh manifest
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {message && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p>}
      {loading && <p className="text-xs text-[var(--text-muted)]">Loading delivery runs…</p>}
      {!loading && runs.length === 0 && <p className="text-xs text-[var(--text-muted)]">No delivery runs formed yet.</p>}

      <div className="space-y-3">
        {runs.map((run) => (
          <article key={run.id} className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2 text-xs">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-semibold">{run.run_code} · {run.mode} · {run.status}</span>
              <span>Stops: {run.planned_stops}/{run.max_stops} · Window: {run.delivery_window}</span>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {['FORMING', 'CUTOFF_LOCKED'].includes(run.status) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => deliveryRunsApi.dispatchRun(run.id, { delivery_method: run.mode === 'PICKUP' ? 'BUYER_PICKUP' : 'SUPPLIER_FLEET' }), `Run ${run.run_code} dispatched.`)}
                  className="px-2.5 py-1 rounded bg-[var(--brand-accent)] text-[#072a21] font-semibold"
                >
                  Dispatch Run
                </button>
              )}
              <input
                type="text"
                placeholder="ETA ISO (e.g. 2026-11-18T14:00:00Z)"
                value={etaInput}
                onChange={(e) => setEtaInput(e.target.value)}
                className="p-1 rounded border bg-[var(--bg-surface)]"
              />
              <button
                type="button"
                disabled={pending || !etaInput.trim()}
                onClick={() => act(() => deliveryRunsApi.updateRunEta(run.id, { eta_at: etaInput.trim(), reason: 'Supplier ETA update' }), `ETA updated for ${run.run_code}.`)}
                className="px-2 py-1 rounded border border-[var(--border-subtle)]"
              >
                Update ETA
              </button>
            </div>
            <div className="space-y-1.5 pt-2">
              {(run.stops || []).map((stop) => (
                <div key={stop.id} className="p-2 rounded border border-[var(--border-subtle)] flex flex-wrap justify-between items-center gap-2">
                  <span>
                    #{stop.stop_sequence} · {stop.order_code} · {stop.status} · Qty: {stop.ordered_qty}
                  </span>
                  <div className="flex flex-wrap gap-2 items-center">
                    {stop.mode === 'PICKUP' && ['ASSIGNED', 'DISPATCHED', 'REATTEMPT_SCHEDULED'].includes(stop.status) && (
                      <>
                        <input
                          type="text"
                          placeholder="Pickup code"
                          value={pickupCodes[stop.id] || ''}
                          onChange={(e) => setPickupCodes((prev) => ({ ...prev, [stop.id]: e.target.value }))}
                          className="p-1 rounded border w-28 bg-[var(--bg-surface)]"
                        />
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => act(() => deliveryRunsApi.claimPickup(stop.id, pickupCodes[stop.id] || ''), `Pickup claimed for ${stop.order_code}.`)}
                          className="px-2 py-1 rounded border border-[var(--border-subtle)]"
                        >
                          Verify Pickup
                        </button>
                      </>
                    )}
                    {stop.mode !== 'PICKUP' && ['DISPATCHED', 'REATTEMPT_SCHEDULED'].includes(stop.status) && (
                      <>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => act(() => deliveryRunsApi.markStopDelivered(stop.id, 'Delivered at buyer stop'), `Marked ${stop.order_code} delivered.`)}
                          className="px-2 py-1 rounded border border-[var(--border-subtle)]"
                        >
                          Mark Delivered
                        </button>
                        <select value={failReason} onChange={(e) => setFailReason(e.target.value)} className="p-1 rounded border bg-[var(--bg-surface)]">
                          <option value="BUYER_UNAVAILABLE">Buyer Unavailable</option>
                          <option value="ADDRESS_INACCESSIBLE">Address Inaccessible</option>
                          <option value="CARRIER_DELAY">Carrier Delay</option>
                        </select>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => act(() => deliveryRunsApi.recordFailedAttempt(stop.id, { reason_code: failReason, schedule_reattempt: true }), `Failed attempt recorded for ${stop.order_code}.`)}
                          className="px-2 py-1 rounded border border-[var(--border-subtle)]"
                        >
                          Record Failed Attempt
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
