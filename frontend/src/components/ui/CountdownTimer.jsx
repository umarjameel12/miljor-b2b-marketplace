import React, { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';

// Shared regular/flash countdown. Deadline is authoritative and never reset
// by re-render, refresh or browser visibility changes. Local clock is adjusted
// with the API's server_time where available.
export function CountdownTimer({ deadline, serverTime = null, onExpire, compact = false, label = 'Time left' }) {
  const parsedDeadline = useMemo(() => Date.parse(deadline || ''), [deadline]);
  const offsetMs = useMemo(() => {
    const remote = Date.parse(serverTime || '');
    return Number.isFinite(remote) ? remote - Date.now() : 0;
  }, [serverTime]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [parsedDeadline]);
  const remaining = Number.isFinite(parsedDeadline)
    ? Math.max(0, Math.ceil((parsedDeadline - now - offsetMs) / 1000)) : null;
  useEffect(() => {
    if (remaining === 0 && Number.isFinite(parsedDeadline)) onExpire?.();
  }, [remaining === 0, parsedDeadline, onExpire]);
  if (remaining === null) return <span className="text-xs text-[var(--text-muted)]">Deadline unavailable</span>;
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  const digits = value => String(value).padStart(2, '0');
  const display = days > 0
    ? `${days}d ${digits(hours)}h ${digits(mins)}m ${digits(secs)}s`
    : `${digits(hours)}:${digits(mins)}:${digits(secs)}`;
  return <span aria-live="off" role="timer" className={`inline-flex items-center gap-1 font-mono tabular-nums ${compact ? 'text-xs' : 'text-sm font-semibold'}`}>
    <Clock size={compact ? 13 : 16} aria-hidden="true" />
    {remaining === 0 ? 'Expired' : `${label}: ${display}`}
  </span>;
}
