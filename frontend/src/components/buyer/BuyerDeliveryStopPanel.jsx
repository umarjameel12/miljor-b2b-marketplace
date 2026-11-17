import React, { useEffect, useState } from 'react';
import { deliveryRunsApi } from '../../api/deliveryRuns';

export function BuyerDeliveryStopPanel({ orderId, orderedQty }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  const [acceptedQty, setAcceptedQty] = useState(String(orderedQty || ''));
  const [missingQty, setMissingQty] = useState('0');
  const [rejectedQty, setRejectedQty] = useState('0');
  const [claimDesc, setClaimDesc] = useState('');

  const load = async (signal) => {
    setLoading(true);
    setError('');
    try {
      const res = await deliveryRunsApi.getBuyerStop(orderId, { signal });
      setData(res);
      if (res?.stop?.ordered_qty && !acceptedQty) {
        setAcceptedQty(String(res.stop.ordered_qty));
      }
    } catch (err) {
      if (err?.name !== 'CanceledError') {
        setError(err.response?.data?.error?.message || err.message || 'Unable to load delivery status.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [orderId]);

  const submitReceipt = async (isPartial) => {
    if (!data?.stop || pending) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const body = isPartial
        ? {
            accepted_qty: acceptedQty,
            missing_qty: missingQty || '0',
            rejected_qty: rejectedQty || '0',
            reason: 'SHORT_QUANTITY',
            description: claimDesc.trim() || `Partial receipt: ${acceptedQty} accepted, ${missingQty} missing, ${rejectedQty} rejected.`
          }
        : {
            accepted_qty: data.stop.ordered_qty,
            missing_qty: '0',
            rejected_qty: '0'
          };
      await deliveryRunsApi.recordBuyerReceipt(data.stop.id, body);
      setMessage(isPartial ? 'Partial receipt and shortage dispute recorded.' : 'Full delivery receipt confirmed.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Could not record receipt.');
    } finally {
      setPending(false);
    }
  };

  const handleAmendmentDecision = async (amd, decision) => {
    if (pending) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      await deliveryRunsApi.decideAmendment(amd.id, {
        amendment_version: amd.amendment_version,
        quote_hash: amd.quote_hash,
        decision
      });
      setMessage(`Amendment ${amd.amendment_code} ${decision.toLowerCase()}.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Could not update amendment decision.');
      await load();
    } finally {
      setPending(false);
    }
  };

  if (loading) return <p className="text-xs text-[var(--text-muted)] mt-2">Loading delivery stop…</p>;
  if (error && !data) {
    return (
      <div className="mt-2 text-xs text-red-600 flex items-center gap-2">
        <span>{error}</span>
        <button type="button" className="underline" onClick={() => load()}>Retry</button>
      </div>
    );
  }

  const stop = data?.stop;
  const attempts = data?.attempts || [];
  const amendments = data?.amendments || [];

  if (!stop && amendments.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] space-y-2 text-xs" aria-label={`Delivery details for order ${orderId}`}>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {message && <p role="status" className="text-emerald-700 dark:text-emerald-300">{message}</p>}

      {stop && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <span className="font-semibold">
              Run {stop.run_code} · Mode: {stop.mode} · Stop Status: {stop.status}
            </span>
            <span>Delivery Fee: PKR {Number(stop.locked_delivery_fee_pkr || 0).toFixed(2)}</span>
          </div>
          <p className="text-[var(--text-muted)]">
            Window: {stop.delivery_window} ({String(stop.delivery_day).slice(0, 10)})
            {stop.eta_at ? ` · ETA: ${String(stop.eta_at)} (v${stop.eta_version})` : ''}
          </p>

          {stop.mode === 'PICKUP' && stop.pickup_code && (
            <p className="p-2 rounded border border-[var(--border-subtle)] font-mono">
              Private Pickup Code: <strong>{stop.pickup_code}</strong> (Share only at collection)
            </p>
          )}

          {['SUPPLIER_DELIVERED', 'DISPATCHED'].includes(stop.status) && (
            <div className="pt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submitReceipt(false)}
                  className="px-2.5 py-1 rounded bg-[var(--brand-accent)] text-[#072a21] font-semibold"
                >
                  Confirm Full Receipt ({stop.ordered_qty})
                </button>
              </div>
              <details>
                <summary className="cursor-pointer underline">Report partial delivery / shortage</summary>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label>
                    Accepted
                    <input
                      type="text"
                      value={acceptedQty}
                      onChange={(e) => setAcceptedQty(e.target.value)}
                      className="w-full p-1 rounded border bg-[var(--bg-surface)]"
                    />
                  </label>
                  <label>
                    Missing
                    <input
                      type="text"
                      value={missingQty}
                      onChange={(e) => setMissingQty(e.target.value)}
                      className="w-full p-1 rounded border bg-[var(--bg-surface)]"
                    />
                  </label>
                  <label>
                    Rejected
                    <input
                      type="text"
                      value={rejectedQty}
                      onChange={(e) => setRejectedQty(e.target.value)}
                      className="w-full p-1 rounded border bg-[var(--bg-surface)]"
                    />
                  </label>
                </div>
                <textarea
                  placeholder="Describe shortage or damage..."
                  value={claimDesc}
                  onChange={(e) => setClaimDesc(e.target.value)}
                  className="w-full mt-2 p-1.5 rounded border bg-[var(--bg-surface)]"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submitReceipt(true)}
                  className="mt-1 px-2.5 py-1 rounded border border-[var(--border-subtle)] font-semibold"
                >
                  Submit Partial Receipt &amp; Dispute
                </button>
              </details>
            </div>
          )}

          {stop.status === 'PARTIAL_CONFIRMED' && (
            <p className="font-medium">
              Partial Receipt: {stop.accepted_qty} accepted · {stop.disputed_qty} disputed (Dispute #{stop.dispute_id})
            </p>
          )}
        </div>
      )}

      {attempts.length > 0 && (
        <div className="space-y-1">
          <p className="font-semibold">Delivery Attempts ({attempts.length}):</p>
          <ul className="list-disc pl-4">
            {attempts.map((a) => (
              <li key={a.id}>
                Attempt #{a.attempt_number}: {a.outcome} ({a.reason_code}){a.notes ? ` — ${a.notes}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {amendments.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-semibold">Delivery Amendments / Reroute Quotes:</p>
          {amendments.map((amd) => (
            <div key={amd.id} className="p-2 rounded border border-[var(--border-subtle)] space-y-1">
              <p>
                <strong>{amd.amendment_code}</strong> (v{amd.amendment_version}) · {amd.amendment_type} · Status: <strong>{amd.decision}</strong>
              </p>
              <p>
                Old Fee: PKR {Number(amd.old_amount_pkr).toFixed(2)} → New Fee: PKR {Number(amd.new_amount_pkr).toFixed(2)} (Diff: PKR {Number(amd.charge_diff_pkr).toFixed(2)})
              </p>
              <p className="text-[var(--text-muted)]">
                Reason: {amd.reason} · Expires: {String(amd.expires_at)}
              </p>
              {amd.decision === 'PENDING' && (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleAmendmentDecision(amd, 'ACCEPTED')}
                    className="px-2 py-1 rounded bg-[var(--brand-accent)] text-[#072a21] font-semibold"
                  >
                    Accept Quote
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleAmendmentDecision(amd, 'DECLINED')}
                    className="px-2 py-1 rounded border border-[var(--border-subtle)]"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
