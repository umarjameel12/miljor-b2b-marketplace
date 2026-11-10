import React, { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';

/**
 * Reusable deadline countdown (Regular Pools, Flash Pools, RFQ/quote deadlines).
 * Display only: the API/DB remains authoritative for expiry and transactions.
 * Dates must contain a timezone (UTC Z or explicit offset).
 */
export function CountdownTimer({
  deadline, serverTime = null, onExpire, compact = false, label = 'Time left'
}) {
  const expiryMs = useMemo(() => Date.parse(deadline || ''), [deadline]);
  const clock = useMemo(() => {
    const serverMs = Date.parse(serverTime || '');
    return { startedAt: Date.now(), serverMs: Number.isFinite(serverMs) ? serverMs : null };
  }, [serverTime]);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [expiryMs]);

  const authoritativeNow = clock.serverMs === null
    ? nowMs : clock.serverMs + (nowMs - clock.startedAt);
  const remaining = Number.isFinite(expiryMs)
    ? Math.max(0, Math.ceil((expiryMs - authoritativeNow) / 1000))
    : null;

  useEffect(() => {
    if (remaining === 0 && Number.isFinite(expiryMs)) onExpire?.();
  }, [remaining === 0, expiryMs, onExpire]);

  if (remaining === null) {
    return <span className="text-xs text-[var(--text-muted)]">Deadline unavailable</span>;
  }

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const pad = value => String(value).padStart(2, '0');
  const formatted = `${pad(days)}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

  return (
    <span aria-live="off" role="timer" className={`inline-flex items-center gap-1 font-mono tabular-nums ${compact ? 'text-xs' : 'text-sm font-semibold'}`}>
      <Clock size={compact ? 13 : 16} aria-hidden="true" />
      {remaining === 0 ? 'Expired' : `${label}: ${formatted}`}
    </span>
  );
}

export default CountdownTimer;
