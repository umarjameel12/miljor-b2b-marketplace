import React, { useEffect, useRef, useState } from 'react';
import { canManageNotificationOperations, notificationOperationKey, startNotificationOperations } from '../../api/notifications.js';

function countRows(counts, prefix = '') {
  return Object.entries(counts).flatMap(([key, value]) => {
    const label = `${prefix}${key.replace(/_/g, ' ')}`;
    if (Number.isSafeInteger(value) && value >= 0) return [[label, value]];
    return value && typeof value === 'object' && !Array.isArray(value) ? countRows(value, `${label}: `) : [];
  });
}

// Mount only while the disclosure is open. Account-keyed parent mounting and
// controller disposal prevent another recipient seeing stale operations data.
export function NotificationOperations({ role }) {
  const session = useRef(null);
  const [state, setState] = useState(null);
  const [reasons, setReasons] = useState({});
  useEffect(() => {
    if (!canManageNotificationOperations(role)) return undefined;
    const active = startNotificationOperations({ role, onChange: setState });
    session.current = active;
    void active.load();
    return () => { active.stop(); if (session.current === active) session.current = null; };
  }, [role]);
  if (!canManageNotificationOperations(role)) return null;
  return (
    <section aria-label="Notification operations" className="space-y-2 mt-2">
      <p>Queue status and failed notification attempts. A retry does not confirm delivery or provider acceptance.</p>
      <button type="button" className="underline min-h-9" disabled={state?.loading}
        onClick={() => session.current?.load()}>Refresh operations</button>
      {(!state || state.loading) && <p role="status">Loading operations…</p>}
      {state?.error && <p role="alert">{state.error}</p>}
      {state?.notice && <p role="status">{state.notice}</p>}
      {state?.data && <>
        <dl className="space-y-1">
          {countRows(state.data.counts).map(([label, value]) => <div key={label} className="flex justify-between gap-2">
            <dt>{label}</dt><dd>{value}</dd>
          </div>)}
        </dl>
        <h4 className="font-semibold">Failed notification attempts</h4>
        {state.data.failedEvents.length === 0 && <p>No failed attempts returned.</p>}
        {state.data.failedEvents.map(event => {
          const key = notificationOperationKey(event);
          const retryable = event.status === 'FAILED' && ['EVENT', 'EMAIL'].includes(event.channel);
          return <form key={key} className="space-y-2 border rounded-xl p-2"
          style={{ borderColor: 'var(--border-subtle)' }} onSubmit={async submission => {
            submission.preventDefault();
            if (await session.current?.retry(event, reasons[key] || '')) {
              setReasons(current => ({ ...current, [key]: '' }));
            }
          }}>
          <p className="font-semibold" dir="auto">{event.channel}: {event.eventType || 'Notification'} #{event.id}</p>
          {Number.isSafeInteger(event.attemptCount) && <p>Attempts: {event.attemptCount}</p>}
          {event.lastErrorCode && <p dir="auto">{event.lastErrorCode}</p>}
          {retryable ? <>
          <label className="block space-y-1">
            <span>Retry reason for {event.channel} #{event.id} (10–500 characters)</span>
            <input type="text" required minLength={10} maxLength={500} value={reasons[key] || ''} disabled={state.loading}
              className="block w-full rounded border p-1" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              onChange={change => setReasons(current => ({ ...current, [key]: change.target.value }))} />
          </label>
          <button type="submit" className="underline min-h-9" disabled={state.loading || (reasons[key]?.trim().length ?? 0) < 10}>
            {state.pending === key ? 'Requesting retry…' : 'Request retry'}
          </button>
          </> : <p>This attempt cannot be retried.</p>}
        </form>; })}
      </>}
    </section>
  );
}
