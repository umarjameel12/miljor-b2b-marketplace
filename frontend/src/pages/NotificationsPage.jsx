// =============================================================================
// src/pages/NotificationsPage.jsx
// MilJor Unified In-App Notifications & Action Inbox
// Direct Integration with /api/v1/notifications & Real-Time Mark as Read
// =============================================================================
import React, { useState, useEffect, useCallback } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../context/AuthContext';
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  Layers,
  ShoppingBag,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Info
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';

export const NotificationsPage = () => {
  const { token, user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'UNREAD'

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (!token) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const res = await fetch('/api/v1/notifications', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const json = await res.json();
        setNotifications(json.data?.notifications || json.notifications || []);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id) => {
    try {
      const res = await fetch(`/api/v1/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1, read_at: new Date().toISOString() } : n));
      }
    } catch (err) {
      console.error('Error marking notification read:', err);
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.is_read);
    await Promise.all(unread.map(n => markAsRead(n.id)));
    toast.success('All notifications marked as read');
  };

  const filtered = notifications.filter(n => {
    if (filter === 'UNREAD') return !n.is_read;
    return true;
  });

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)]">
                Communications Hub
              </span>
            </div>
            <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
              Notifications & Alerts
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Authoritative updates on orders, escrow settlements, RFQs, pool deadlines, and disputes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="inline-flex items-center p-1 rounded-xl border text-xs font-semibold"
              style={{
                backgroundColor: 'var(--bg-input)',
                borderColor: 'var(--border-subtle)'
              }}
            >
              <button
                type="button"
                onClick={() => setFilter('ALL')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  filter === 'ALL'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                All ({notifications.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('UNREAD')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  filter === 'UNREAD'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Unread ({notifications.filter(n => !n.is_read).length})
              </button>
            </div>

            <button
              type="button"
              onClick={markAllRead}
              className="px-3 py-1.5 rounded-xl border border-[var(--border-default)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors inline-flex items-center gap-1.5"
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-600" /> Mark All Read
            </button>
          </div>
        </div>

        {/* Notifications List */}
        {loading ? (
          <div className="p-12 text-center text-xs text-[var(--text-muted)]">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[var(--brand-accent)]" />
            Loading notifications...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center space-y-2">
            <Bell className="w-8 h-8 mx-auto text-[var(--brand-accent)] opacity-50" />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">No Notifications</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
              {filter === 'UNREAD' ? 'You have read all notifications.' : 'No alerts have been recorded yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-3 ${
                  item.is_read
                    ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] opacity-80'
                    : 'bg-[var(--bg-card)] border-[var(--brand-accent)]/40 shadow-xs'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                    item.is_read ? 'bg-stone-500/10 text-stone-500' : 'bg-[var(--brand-accent)]/15 text-[var(--brand-accent)]'
                  }`}>
                    <Bell className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {item.title || item.event_type || 'Platform Notice'}
                      </span>
                      {!item.is_read && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                      {item.message || item.body || 'Operational notification recorded in MilJor system.'}
                    </p>
                    <span className="text-[10px] text-[var(--text-muted)] block mt-1.5">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : 'Just now'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!item.is_read && (
                    <button
                      type="button"
                      onClick={() => markAsRead(item.id)}
                      className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      title="Mark as read"
                    >
                      <Check className="w-4 h-4 text-emerald-600" />
                    </button>
                  )}
                  {item.action_url && (
                    <Link
                      to={item.action_url}
                      className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--brand-accent)]"
                      title="View details"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </AppShell>
  );
};

export default NotificationsPage;
