import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ShieldCheck, Users, FolderCheck, RefreshCw, AlertTriangle, ArrowRight, LockKeyhole } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import adminApi from '../api/admin';

const VERIFIERS = ['SUPER_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'];
const ADMINS = [...VERIFIERS, 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN'];
const CATALOG = ['SUPER_ADMIN', 'VERIFICATION_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'];

export function AdminDashboardPage() {
  const { user, isAuthenticated } = useAuth();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const role = user?.role;
  const canVerify = VERIFIERS.includes(role);
  const canCatalog = CATALOG.includes(role);

  const refresh = async () => {
    if (!canVerify) return;
    setLoading(true); setError('');
    try {
      const response = await adminApi.getPendingSuppliers();
      setPending(response?.data?.suppliers || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Unable to load pending supplier applications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAuthenticated && canVerify) refresh(); }, [isAuthenticated, canVerify]);

  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: { pathname: '/admin' } }} />;
  if (!ADMINS.includes(role)) return (
    <AppShell>
      <div className="mx-auto max-w-xl p-8 sm:p-12">
        <div className="rounded-3xl border p-8 space-y-4" style={{background:'var(--bg-surface)',borderColor:'var(--border-subtle)'}}>
          <LockKeyhole className="h-9 w-9 text-amber-600" />
          <h1 className="text-2xl font-bold">Administrator access required</h1>
          <p className="text-sm opacity-75">Your signed-in account is not assigned an administrative role. Business ownership does not automatically grant administrative access. Use a separately provisioned administrator account.</p>
          <Link className="inline-flex text-sm font-semibold underline" to="/login" state={{ from: { pathname: '/admin' } }}>Sign in as an administrator</Link>
        </div>
      </div>
    </AppShell>
  );

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl p-5 sm:p-8 space-y-7">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{color:'var(--brand-accent)'}}>
              <ShieldCheck className="w-4 h-4" /> MilJor Administration
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold">Operations overview</h1>
            <p className="mt-2 text-sm opacity-70">Verification, supplier trust and catalog governance for the Lahore marketplace.</p>
          </div>
          <div className="rounded-xl px-4 py-2 border text-xs font-semibold" style={{borderColor:'var(--border-subtle)',background:'var(--bg-surface)'}}>{role.replaceAll('_',' ')}</div>
        </div>

        {canVerify && (
          <section className="rounded-2xl border p-5 sm:p-6" style={{borderColor:'var(--border-subtle)',background:'var(--bg-surface)'}}>
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div className="flex items-center gap-3">
                <Users className="w-6 h-6" style={{color:'var(--brand-accent)'}} />
                <div>
                  <p className="text-xs opacity-60 font-semibold uppercase tracking-wide">Supplier verification</p>
                  <p className="text-2xl font-bold">{loading ? '…' : pending.length} <span className="text-xs font-normal opacity-65">applications awaiting a decision</span></p>
                </div>
              </div>
              <button type="button" onClick={refresh} disabled={loading} className="inline-flex gap-2 items-center px-3 py-2 text-xs rounded-lg border disabled:opacity-50" style={{borderColor:'var(--border-subtle)'}}>
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
            {error && <p role="alert" className="mt-4 text-sm text-red-600 flex gap-2 items-center"><AlertTriangle className="w-4 h-4" /> {error}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              {['PENDING_REVIEW','UNDER_REVIEW','MORE_INFORMATION_REQUIRED'].map(status => {
                const count = pending.filter(s=>s.verification_status===status).length;
                return <span key={status} className="text-xs px-3 py-1.5 rounded-full border" style={{borderColor:'var(--border-subtle)'}}>{status.replaceAll('_',' ')}: <strong>{count}</strong></span>;
              })}
            </div>
            <Link to="/admin/verifications" className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold" style={{background:'var(--brand-accent)',color:'var(--text-on-champagne)'}}>
              Review suppliers <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {canCatalog && <Link to="/admin/catalog" className="rounded-2xl border p-6 hover:shadow-lg transition-shadow space-y-3" style={{background:'var(--bg-surface)',borderColor:'var(--border-subtle)'}}>
            <FolderCheck className="w-7 h-7" style={{color:'var(--brand-accent)'}} />
            <h2 className="text-lg font-bold">Catalog governance</h2>
            <p className="text-sm opacity-70">Moderate supplier catalog requests, families and categories.</p>
            <span className="text-xs font-bold inline-flex items-center gap-1">Open catalog <ArrowRight className="w-3.5 h-3.5" /></span>
          </Link>}
          {canVerify && <Link to="/admin/verifications" className="rounded-2xl border p-6 hover:shadow-lg transition-shadow space-y-3" style={{background:'var(--bg-surface)',borderColor:'var(--border-subtle)'}}>
            <ShieldCheck className="w-7 h-7" style={{color:'var(--brand-accent)'}} />
            <h2 className="text-lg font-bold">Business verification</h2>
            <p className="text-sm opacity-70">Inspect business details, choose verification level and approve or reject with an audit trail.</p>
            <span className="text-xs font-bold inline-flex items-center gap-1">Open verification <ArrowRight className="w-3.5 h-3.5" /></span>
          </Link>}
        </div>
        <p className="text-xs opacity-60">All approval operations are enforced by the backend. Suppliers cannot approve their own application.</p>
      </main>
    </AppShell>
  );
}
export default AdminDashboardPage;
