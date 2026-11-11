import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'VERIFICATION_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN'];

function homeFor(user) {
  if (!user) return { to: '/login', label: 'Sign in' };
  if (ADMIN_ROLES.includes(user.role)) return { to: '/admin', label: 'Go to admin console' };
  if (user.role === 'SUPPLIER') return { to: '/supplier/dashboard', label: 'Go to supplier dashboard' };
  return { to: '/orders', label: 'Go to my orders' };
}

export function NotFoundPage() {
  const { user, isAuthenticated } = useAuth();
  const home = homeFor(isAuthenticated ? user : null);

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20" aria-labelledby="nf-title">
      <div className="max-w-md text-center">
        <p className="text-xs font-sans font-semibold tracking-wider uppercase" style={{ color: 'var(--brand-accent)' }}>
          Error 404
        </p>
        <h1 id="nf-title" className="font-display font-bold text-3xl mt-2" style={{ color: 'var(--text-primary)' }}>
          This page does not exist
        </h1>
        <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>
          The address may be mistyped or the page may have moved. Nothing has been changed on your account.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/pools"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]"
            style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--text-on-champagne)' }}
          >
            Explore wholesale pools
          </Link>
          <Link
            to={home.to}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold border focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            {home.label}
          </Link>
        </div>
      </div>
    </main>
  );
}

export default NotFoundPage;
