import React, { useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const FINANCIAL_ADMINS = ['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN'];
const inputClass = 'block w-full rounded-lg border p-2 bg-[var(--bg-surface)]';
const buttonClass = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-50';
const reviewPath = id => `/procurement/admin/orders/${id}/settlement-review`;
const positiveId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));

// Keep editable money as decimal text; never round a fee through floating point.
function cents(value) {
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(String(value));
  return match ? BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0')) : null;
}
function amount(value) {
  const parsed = cents(value);
  return parsed === null ? 'Unavailable' : `${parsed / 100n}.${String(parsed % 100n).padStart(2, '0')}`;
}
function remainder(held, refund) {
  const left = cents(held), right = cents(refund);
  if (left === null || right === null || right > left) return null;
  const remaining = left - right;
  return `${remaining / 100n}.${String(remaining % 100n).padStart(2, '0')}`;
}
function confirmed(response) {
  if (response.data?.success !== true || response.data.data == null) throw Error('The server did not confirm this request.');
  return response.data.data;
}
function MoneyRows({ rows }) {
  return <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
    {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-medium tabular-nums">PKR {amount(value)}</dd></div>)}
  </dl>;
}

export function AdminProcurementSettlementReview() {
  const { user } = useAuth();
  if (!FINANCIAL_ADMINS.includes(user?.role)) return null;
  return <SettlementReviewWorkspace key={`${user.id}:${user.role}`} actorId={user.id} />;
}

function SettlementReviewWorkspace({ actorId }) {
  const [pending, setPending] = useState([]), [orderInput, setOrderInput] = useState('');
  const [preview, setPreview] = useState(null), [deliveryRefund, setDeliveryRefund] = useState('0.00'), [processingRefund, setProcessingRefund] = useState('0.00');
  const [notes, setNotes] = useState(''), [consent, setConsent] = useState(false);
  const [title, setTitle] = useState(''), [iban, setIban] = useState(''), [payoutNotes, setPayoutNotes] = useState(''), [payoutConsent, setPayoutConsent] = useState(false);
  const [instruction, setInstruction] = useState(null), [retry, setRetry] = useState(null);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const lifecycle = useRef(null), inFlight = useRef(true), intents = useRef(new Map()), preparation = useRef(null);
  const allocation = preview?.allocation;
  const review = preview?.review?.allocation;
  const payableId = allocation?.supplier_payable_id;
  const retainedDelivery = remainder(allocation?.delivery_fee_hold, deliveryRefund);
  const retainedProcessing = remainder(allocation?.processing_fee_hold, processingRefund);
  const cleanIban = iban.replace(/\s+/g, '').toUpperCase();
  const reviewReady = fresh && preview && !review && /^[a-f0-9]{64}$/.test(preview.assessment_hash || '') &&
    retainedDelivery !== null && retainedProcessing !== null && consent && notes.trim().length >= 10 && notes.length <= 2000;
  const prepareReady = fresh && review && positiveId(payableId) && title.trim().length >= 3 && /^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(cleanIban) && !instruction;

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    inFlight.current = true;
    apiClient.get('/procurement/admin/settlement-reviews', { signal: controller.signal })
      .then(response => {
        const list = confirmed(response);
        if (!Array.isArray(list)) throw Error('The pending review list was not confirmed.');
        if (!controller.signal.aborted) setPending(list);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.response?.data?.error?.message || err.message || 'Unable to load settlement reviews.'); })
      .finally(() => { if (!controller.signal.aborted) { inFlight.current = false; setBusy(false); } });
    return () => controller.abort();
  }, [actorId]);

  const getPending = async () => {
    const list = confirmed(await apiClient.get('/procurement/admin/settlement-reviews', { signal: lifecycle.current.signal }));
    if (!Array.isArray(list)) throw Error('The pending review list was not confirmed.');
    if (!lifecycle.current.signal.aborted) setPending(list);
  };
  const getOrder = async (id, reset = false) => {
    setFresh(false);
    const record = confirmed(await apiClient.get(reviewPath(id), { signal: lifecycle.current.signal }));
    if (String(record.order_id) !== String(id) || !record.allocation) throw Error('The server returned a different or incomplete order assessment.');
    if (lifecycle.current.signal.aborted) return;
    setPreview(record);
    setFresh(true);
    setConsent(false);
    if (record.review) setRetry(current => current?.kind === 'review' && String(current.orderId) === String(record.order_id) ? null : current);
    setOrderInput(String(record.order_id));
    if (reset || record.review) {
      setDeliveryRefund(record.review?.allocation?.delivery_refund || '0.00');
      setProcessingRefund(record.review?.allocation?.processing_refund || '0.00');
      setNotes(record.review?.allocation?.notes || '');
      setConsent(false);
    }
  };
  const run = async operation => {
    if (inFlight.current || lifecycle.current?.signal.aborted) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await operation(); }
    catch (err) { if (!lifecycle.current.signal.aborted) setError(err.response?.data?.error?.message || err.message || 'The action could not be confirmed.'); }
    finally { if (!lifecycle.current.signal.aborted) { inFlight.current = false; setBusy(false); } }
  };
  const openOrder = id => run(async () => {
    if (!positiveId(id)) throw Error('Enter a valid order ID.');
    setPreview(null); setInstruction(null); setRetry(null); preparation.current = null; setTitle(''); setIban(''); setPayoutNotes(''); setPayoutConsent(false);
    await getOrder(id, true);
  });
  const makeCommand = (kind, path, body) => {
    const signature = JSON.stringify([actorId, preview.order_id, path, body]);
    if (!intents.current.has(signature)) intents.current.set(signature, `settlement-${crypto.randomUUID()}`);
    return { kind, path, body, key: intents.current.get(signature), orderId: preview.order_id };
  };
  const send = command => run(async () => {
    setFresh(false);
    let result;
    try {
      result = confirmed(await apiClient.post(command.path, command.body, {
        headers: { 'X-Idempotency-Key': command.key }, signal: lifecycle.current.signal,
      }));
      if (lifecycle.current.signal.aborted) return;
      if (command.kind !== 'review') {
        if (!positiveId(result.disbursement?.id) || String(result.disbursement.order_id) !== String(command.orderId)) throw Error('The server did not return the matching payout instruction.');
        setInstruction(result.disbursement);
        if (command.kind === 'prepare') preparation.current = command;
        setPayoutConsent(false);
      } else if (!positiveId(result.review_id)) throw Error('The server did not return a confirmed review.');
    } catch (err) {
      // Approval has no durable replay route. Reuse the original prepare intent
      // to read the canonical instruction before offering approval again.
      if (!lifecycle.current.signal.aborted) setRetry(command.kind === 'approve' && preparation.current ? { ...preparation.current, kind: 'recover' } : command);
      throw err;
    }
    setRetry(null);
    setMessage(command.kind === 'review' ? 'Settlement review recorded by the server.' : command.kind === 'prepare' ? 'Payout instruction prepared by the server. External execution remains disabled.' : command.kind === 'recover' ? 'Payout instruction reloaded from the server. Check its recorded status; external execution remains disabled.' : 'Payout instruction approval recorded by the server. External execution remains disabled.');
    try { await getOrder(command.orderId); await getPending(); }
    catch { setFresh(false); throw Error('The server confirmed the action, but refreshing the assessment failed. Refresh before another action.'); }
  });

  return <section aria-label="Procurement settlement reviews" className="rounded-2xl border p-5 sm:p-6 space-y-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold">Procurement settlement reviews</h2><p className="text-sm opacity-70">Review final receipt assessments and decide responsibility for held delivery and processing fees.</p></div>
      <button type="button" disabled={busy} className={buttonClass} onClick={() => run(async () => { if (preview) await getOrder(preview.order_id); await getPending(); })}>Refresh settlement records</button>
    </div>
    <p className="text-sm">Refund and payout execution remains disabled. An approved allocation or instruction does not confirm money was sent.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {retry && <div className="space-y-2 text-sm"><p>The request could not be confirmed. Retrying sends the exact same details and intent key. Refresh to check the recorded decision.</p><button type="button" disabled={busy} className={buttonClass} onClick={() => send(retry)}>Retry exact {retry.kind === 'review' ? 'settlement review' : 'payout request'}</button></div>}
    <div className="flex flex-wrap gap-2 items-end">
      <label className="text-sm">Pending assessment<select className={inputClass} disabled={busy} value="" onChange={event => { if (event.target.value) openOrder(event.target.value); }}><option value="">{busy ? 'Loading…' : pending.length ? 'Choose an order' : 'No pending assessments'}</option>{pending.map(order => <option key={order.order_id} value={order.order_id}>{order.order_code} · #{order.order_id}</option>)}</select></label>
      <form className="flex gap-2 items-end" onSubmit={event => { event.preventDefault(); openOrder(orderInput); }}><label className="text-sm">Order ID<input className={inputClass} inputMode="numeric" value={orderInput} disabled={busy} onChange={event => setOrderInput(event.target.value)} /></label><button className={buttonClass} disabled={busy || !positiveId(orderInput)}>Load review</button></form>
    </div>
    {preview && <div className="space-y-4" aria-busy={busy}>
      <h3 className="font-semibold">{preview.order_code} · Order #{preview.order_id}</h3>
      <p className="text-xs opacity-70 break-all">Assessment reference: {preview.assessment_hash}</p>
      <MoneyRows rows={[
        ['Captured payment', allocation.captured_amount], ['Accepted merchandise (immutable)', allocation.accepted_merchandise_amount],
        ['Accepted commission (immutable)', allocation.accepted_commission_amount], ['Accepted supplier net', allocation.accepted_supplier_net],
        ['Disputed merchandise held', allocation.disputed_merchandise_hold], ['Delivery fee held', allocation.delivery_fee_hold], ['Processing fee held', allocation.processing_fee_hold],
      ]} />
      {review ? <div className="space-y-2"><h4 className="font-semibold">Server-confirmed settlement review #{preview.review.id}</h4>
        <MoneyRows rows={[
          ['Supplier entitlement', review.supplier_entitlement], ['Platform entitlement', review.platform_entitlement], ['Total buyer refund reserved', review.total_refund],
          ['Merchandise refund', review.merchandise_refund], ['Delivery fee refund', review.delivery_refund], ['Processing fee refund', review.processing_refund],
        ]} /><p className="text-sm whitespace-pre-wrap">Reason: {review.notes}</p><p className="text-sm">External execution: {review.external_execution_status || 'Status unavailable'}</p>
      </div> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (reviewReady && !busy && !retry) send(makeCommand('review', reviewPath(preview.order_id), {
        assessment_hash: preview.assessment_hash, delivery_refund_amount: amount(deliveryRefund), processing_refund_amount: amount(processingRefund), approve_disputed_merchandise_refunds: true, notes: notes.trim(),
      })); }}><fieldset disabled={busy || Boolean(retry)} className="space-y-3"><legend className="font-semibold">Allocate held fees</legend>
        <label className="block text-sm">Delivery fee refund to buyer (PKR)<input className={inputClass} inputMode="decimal" required value={deliveryRefund} onChange={event => { setDeliveryRefund(event.target.value); setConsent(false); }} /></label>
        <p className="text-xs">Delivery fee retained for supplier: {retainedDelivery === null ? 'Enter an amount from zero to the delivery fee held.' : `PKR ${retainedDelivery}`}</p>
        <label className="block text-sm">Processing fee refund to buyer (PKR)<input className={inputClass} inputMode="decimal" required value={processingRefund} onChange={event => { setProcessingRefund(event.target.value); setConsent(false); }} /></label>
        <p className="text-xs">Processing fee retained for platform: {retainedProcessing === null ? 'Enter an amount from zero to the processing fee held.' : `PKR ${retainedProcessing}`}</p>
        <label className="block text-sm">Reason for this allocation<textarea className={inputClass} required minLength={10} maxLength={2000} value={notes} onChange={event => { setNotes(event.target.value); setConsent(false); }} /></label>
        <label className="block text-sm"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} /> I explicitly approve the assessed disputed merchandise refunds and the delivery and processing fee refund amounts shown above.</label>
        <button className={buttonClass} disabled={!reviewReady}>Approve immutable settlement review</button>
      </fieldset></form>}
      {review && <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}><h4 className="font-semibold">Supplier payout instruction</h4>
        <p className="text-sm">Preparation reserves the server-approved supplier entitlement. Approval records an internal decision; external execution stays disabled.</p>
        {!positiveId(payableId) && <p role="alert" className="text-sm">The preview has no supplier payable ID. Refresh after the backend provides it; payout preparation is unavailable.</p>}
        {!instruction && <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (prepareReady && !busy && !retry) send(makeCommand('prepare', '/settlements/disbursements/prepare', { payable_id: payableId, beneficiary_title: title.trim(), beneficiary_iban: cleanIban })); }}><fieldset className="space-y-3" disabled={busy || Boolean(retry)}><legend className="text-sm">Prepare for payable #{payableId || 'unavailable'}</legend>
          <label className="block text-sm">Beneficiary account title<input className={inputClass} autoComplete="off" required minLength={3} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label className="block text-sm">Pakistani IBAN (24 characters)<input className={inputClass} autoComplete="off" spellCheck={false} required value={iban} onChange={event => setIban(event.target.value)} /></label>
          <button className={buttonClass} disabled={!prepareReady}>Prepare payout instruction</button>
        </fieldset></form>}
        {instruction && <div className="space-y-3"><p className="text-sm">Instruction {instruction.disbursement_code || instruction.id} · {instruction.status} · PKR {amount(instruction.amount)}</p><p className="text-sm">Beneficiary: {instruction.beneficiary_title} · IBAN ending {String(instruction.beneficiary_iban || '').slice(-4)}</p><p className="text-sm">External execution: {instruction.external_execution_status || 'Status unavailable'}</p>
          {instruction.status === 'PREPARED' && <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (fresh && payoutConsent && payoutNotes.trim().length >= 10 && !busy && !retry) send(makeCommand('approve', `/settlements/disbursements/${instruction.id}/approve`, { notes: payoutNotes.trim() })); }}><fieldset className="space-y-3" disabled={busy || Boolean(retry) || !fresh}><legend className="font-medium">Approve prepared instruction</legend>
            <label className="block text-sm">Approval reason<textarea className={inputClass} required minLength={10} maxLength={2000} value={payoutNotes} onChange={event => { setPayoutNotes(event.target.value); setPayoutConsent(false); }} /></label>
            <label className="block text-sm"><input type="checkbox" required checked={payoutConsent} onChange={event => setPayoutConsent(event.target.checked)} /> I approve this prepared instruction for the beneficiary I entered.</label>
            <button className={buttonClass} disabled={!payoutConsent || payoutNotes.trim().length < 10}>Approve payout instruction</button>
          </fieldset></form>}
        </div>}
      </div>}
    </div>}
    <SupplementalDeliveryFeeReviews actorId={actorId} onReviewed={orderId => {
      if (String(preview?.order_id) === String(orderId)) {
        setFresh(false); setPayoutConsent(false);
        setMessage('Supplemental fee allocation changed. Refresh the original settlement before preparing an instruction.');
      }
    }} />
  </section>;
}

function SupplementalDeliveryFeeReviews({ actorId, onReviewed }) {
  const [pending, setPending] = useState([]), [contractInput, setContractInput] = useState(''), [contract, setContract] = useState(null);
  const [refund, setRefund] = useState(''), [notes, setNotes] = useState(''), [consent, setConsent] = useState(false), [evidenceChecked, setEvidenceChecked] = useState(false);
  const [busy, setBusy] = useState(true), [fresh, setFresh] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [retry, setRetry] = useState(null);
  const lifecycle = useRef(null), inFlight = useRef(true), intents = useRef(new Map());
  const base = '/procurement/admin/delivery-payment-reviews';
  const supplierAmount = remainder(contract?.amount, refund);
  const ready = fresh && contract && !contract.review_snapshot && /^[a-f0-9]{64}$/.test(contract.contract_hash || '') &&
    supplierAmount !== null && (supplierAmount === '0.00' || evidenceChecked) && consent && notes.trim().length >= 10 && notes.length <= 2000;
  useEffect(() => {
    const controller = new AbortController(); lifecycle.current = controller; inFlight.current = true;
    apiClient.get(base, { signal: controller.signal }).then(response => {
      const list = confirmed(response);
      if (!Array.isArray(list)) throw Error('Supplemental fee review list was not confirmed.');
      if (!controller.signal.aborted) setPending(list);
    }).catch(err => { if (!controller.signal.aborted) setError(err.response?.data?.error?.message || err.message); })
      .finally(() => { if (!controller.signal.aborted) { inFlight.current = false; setBusy(false); } });
    return () => controller.abort();
  }, [actorId]);
  const getPending = async () => {
    const list = confirmed(await apiClient.get(base, { signal: lifecycle.current.signal }));
    if (!Array.isArray(list)) throw Error('Supplemental fee review list was not confirmed.');
    if (!lifecycle.current.signal.aborted) setPending(list);
  };
  const getContract = async (id, reset = false) => {
    setFresh(false);
    const record = confirmed(await apiClient.get(`${base}/${id}`, { signal: lifecycle.current.signal }));
    if (String(record.id) !== String(id) || cents(record.amount) === null) throw Error('The server returned a different or incomplete fee contract.');
    if (lifecycle.current.signal.aborted) return;
    setContract(record); setContractInput(String(record.id)); setFresh(true); setConsent(false); setEvidenceChecked(false);
    if (reset || record.review_snapshot) {
      setRefund(record.review_snapshot?.refund_amount || ''); setNotes(record.review_snapshot?.notes || ''); setRetry(null);
    }
  };
  const run = async operation => {
    if (inFlight.current || lifecycle.current?.signal.aborted) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await operation(); }
    catch (err) { if (!lifecycle.current.signal.aborted) setError(err.response?.data?.error?.message || err.message || 'Supplemental fee review could not be confirmed.'); }
    finally { if (!lifecycle.current.signal.aborted) { inFlight.current = false; setBusy(false); } }
  };
  const open = id => run(async () => {
    if (!positiveId(id)) throw Error('Enter a valid supplemental fee contract ID.');
    setContract(null); setRetry(null); await getContract(id, true);
  });
  const send = command => run(async () => {
    setFresh(false);
    try {
      const result = confirmed(await apiClient.post(command.path, command.body, { headers: { 'X-Idempotency-Key': command.key }, signal: lifecycle.current.signal }));
      if (lifecycle.current.signal.aborted) return;
      if (String(result.contract_id) !== String(command.id)) throw Error('The server did not confirm the matching fee contract.');
    } catch (err) { if (!lifecycle.current.signal.aborted) setRetry(command); throw err; }
    setRetry(null); setMessage('Supplemental fee allocation recorded internally. Any refund remains pending external execution; execution is disabled.');
    onReviewed(contract.order_id);
    try { await getContract(command.id); await getPending(); }
    catch { setFresh(false); throw Error('The server recorded the fee review, but refresh failed. Reload the contract to view the confirmed allocation.'); }
  });
  const submit = event => {
    event.preventDefault();
    if (!ready || busy || retry) return;
    const body = { contract_hash: contract.contract_hash, refund_amount: amount(refund), notes: notes.trim() };
    const path = `${base}/${contract.id}`, signature = JSON.stringify([actorId, path, body]);
    if (!intents.current.has(signature)) intents.current.set(signature, `delivery-review-${crypto.randomUUID()}`);
    send({ id: contract.id, path, body, key: intents.current.get(signature) });
  };
  return <section aria-label="Supplemental delivery fee reviews" className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
    <div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">Supplemental delivery fee reviews</h3><button type="button" className={buttonClass} disabled={busy} onClick={() => run(async () => { if (contract) await getContract(contract.id); await getPending(); })}>Refresh supplemental fees</button></div>
    <p className="text-sm">These separately captured reattempt fees do not change accepted merchandise or commission. A full fee refund may be reviewed before fulfillment. Retaining any fee requires actual supplier delivery, all final buyer receipts, and the original partial-receipt review where required; the server verifies those records.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    {retry && <button type="button" className={buttonClass} disabled={busy} onClick={() => send(retry)}>Retry exact supplemental fee review</button>}
    <label className="block text-sm">Pending captured fees<select className={inputClass} value="" disabled={busy} onChange={event => { if (event.target.value) open(event.target.value); }}><option value="">{busy ? 'Loading…' : pending.length ? 'Choose a fee contract' : 'No pending supplemental fee reviews'}</option>{pending.map(value => <option key={value.id} value={value.id}>{value.order_code} · {value.contract_code} · PKR {amount(value.amount)} · {value.status}</option>)}</select></label>
    <form className="flex gap-2 items-end" onSubmit={event => { event.preventDefault(); open(contractInput); }}><label className="text-sm">Fee contract ID<input className={inputClass} inputMode="numeric" disabled={busy} value={contractInput} onChange={event => setContractInput(event.target.value)} /></label><button className={buttonClass} disabled={busy || !positiveId(contractInput)}>Load fee review</button></form>
    {contract && <div className="space-y-3" aria-busy={busy}><h4 className="font-medium">{contract.contract_code || `Contract #${contract.id}`} · Order #{contract.order_id} · {contract.status}</h4>
      <MoneyRows rows={[["Captured supplemental fee (immutable)", contract.amount]]} />
      <details className="text-sm"><summary className="cursor-pointer">Recorded buyer consent</summary><p>Proposal revision: {contract.consent_snapshot?.proposal_version ?? 'Unavailable'} · Buyer payment consent: {contract.consent_snapshot?.explicit_payment_consent === true ? 'Recorded' : 'Unavailable'}</p><p>Accepted extra fee: PKR {amount(contract.consent_snapshot?.accepted_extra_fee)}</p><p>Recorded UTC slot: {contract.consent_snapshot?.proposal?.start_utc || 'Unavailable'} to {contract.consent_snapshot?.proposal?.end_utc || 'Unavailable'}</p></details>
      {contract.review_snapshot ? <div className="space-y-2"><h4 className="font-medium">Server-confirmed supplemental fee allocation</h4><MoneyRows rows={[["Retained supplier entitlement", contract.review_snapshot.supplier_amount], ["Buyer refund reserved", contract.review_snapshot.refund_amount]]} /><p className="text-sm whitespace-pre-wrap">Reason: {contract.review_snapshot.notes}</p><p className="text-sm">External execution: {contract.review_snapshot.external_execution_status || 'Status unavailable'}. A refund reservation does not confirm a completed refund.</p></div>
        : <form className="space-y-3" onSubmit={submit}><fieldset disabled={busy || Boolean(retry)} className="space-y-3"><legend className="font-medium">Decide the supplemental fee split</legend>
          <label className="block text-sm">Refund amount to buyer (PKR)<input className={inputClass} inputMode="decimal" required value={refund} onChange={event => { setRefund(event.target.value); setConsent(false); setEvidenceChecked(false); }} /></label>
          <button type="button" className={buttonClass} onClick={() => { setRefund(amount(contract.amount)); setConsent(false); setEvidenceChecked(false); }}>Allocate full fee to buyer refund</button>
          <p className="text-sm">Supplier share: {supplierAmount === null ? `Enter a refund from PKR 0.00 to ${amount(contract.amount)} with at most two decimal places.` : `PKR ${supplierAmount}`}</p>
          <label className="block text-sm">Allocation reason<textarea className={inputClass} minLength={10} maxLength={2000} required value={notes} onChange={event => { setNotes(event.target.value); setConsent(false); }} /></label>
          {supplierAmount !== null && supplierAmount !== '0.00' && <label className="block text-sm"><input type="checkbox" checked={evidenceChecked} onChange={event => { setEvidenceChecked(event.target.checked); setConsent(false); }} /> I have checked actual supplier delivery, final buyer receipts, and any required original partial-receipt review before retaining this fee.</label>}
          <label className="block text-sm"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} /> I explicitly approve this supplemental fee refund and supplier share. External execution remains disabled.</label>
          <button className={buttonClass} disabled={!ready}>Approve supplemental fee allocation</button>
        </fieldset></form>}
    </div>}
  </section>;
}

export default AdminProcurementSettlementReview;
