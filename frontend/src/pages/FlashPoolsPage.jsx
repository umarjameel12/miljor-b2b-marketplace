import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  Zap,
  Clock,
  ShieldCheck,
  TrendingDown,
  ArrowRight,
  Package,
  Layers,
  Filter
} from 'lucide-react';
import { toast } from 'react-toastify';

export const FlashPoolsPage = () => {
  const { user, token } = useAuth();
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('');

  const fetchFlashPools = async () => {
    try {
      setLoading(true);
      const url = selectedCategory
        ? `/api/v1/flash-pools?category=${encodeURIComponent(selectedCategory)}`
        : '/api/v1/flash-pools';
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setPools(data.data.flash_pools || []);
      }
    } catch (err) {
      toast.error('Failed to load flash deals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlashPools();
  }, [selectedCategory]);

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Banner */}
        <div className="relative overflow-hidden rounded-3xl p-8 mb-8 border border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent">
          <div className="max-w-2xl relative z-10">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 mb-3">
              <Zap className="w-3.5 h-3.5 fill-current" /> Time-Limited Wholesale Clearance
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--text-primary)]">
              Flash Pools & Ready-Stock Clearance
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-2">
              Verified Lahore distributors offer direct volume discounts on high-demand staples for fast dispatch.
              Immediate allocation while warehouse lots last.
            </p>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-accent)]" />
          </div>
        ) : pools.length === 0 ? (
          <div className="p-12 text-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] max-w-2xl mx-auto">
            <Zap className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-40" />
            <h3 className="text-lg font-serif font-bold text-[var(--text-primary)] mb-1">
              No Active Flash Pools Right Now
            </h3>
            <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto mb-6">
              Verified suppliers publish flash clearance deals when bulk warehouse lots arrive. Check out regular collective pools or submit a demand request.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link
                to="/pools"
                className="px-4 py-2 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-95"
              >
                Browse Regular Pools
              </Link>
              <Link
                to="/demand-requests"
                className="px-4 py-2 rounded-xl border border-[var(--border-default)] text-xs font-semibold hover:bg-[var(--bg-card)]"
              >
                Request a Custom Pool
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pools.map((p) => {
              const discountPct = p.original_unit_price
                ? Math.round(((p.original_unit_price - p.discounted_unit_price) / p.original_unit_price) * 100)
                : 0;
              const remainingPct = Math.round((p.remaining_stock / p.total_stock) * 100);

              return (
                <div
                  key={p.id}
                  className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xs hover:border-[var(--border-default)] transition-colors flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        {p.flash_code}
                      </span>
                      {discountPct > 0 && (
                        <span className="text-xs font-bold text-emerald-600 flex items-center gap-0.5">
                          <TrendingDown className="w-3.5 h-3.5" /> {discountPct}% OFF
                        </span>
                      )}
                    </div>

                    <h3 className="text-lg font-serif font-bold text-[var(--text-primary)] mb-1">
                      {p.product_name}
                    </h3>
                    <div className="text-xs text-[var(--text-muted)] mb-4 flex items-center gap-1.5">
                      <span>By {p.supplier_name}</span>
                      {p.verification_status === 'VERIFIED' && (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      )}
                    </div>

                    <div className="p-3 rounded-2xl bg-[var(--bg-card)] mb-4">
                      <div className="text-xs text-[var(--text-muted)] mb-1">Clearance Reason:</div>
                      <div className="text-xs font-medium text-[var(--text-primary)]">
                        {p.clearance_reason || 'Bulk Dispatch Allocation'}
                      </div>
                    </div>

                    <div className="flex items-baseline gap-2 mb-4">
                      <span className="text-2xl font-serif font-bold text-[var(--text-primary)]">
                        Rs. {Number(p.discounted_unit_price).toLocaleString()}
                      </span>
                      {p.original_unit_price > p.discounted_unit_price && (
                        <span className="text-xs text-[var(--text-muted)] line-through">
                          Rs. {Number(p.original_unit_price).toLocaleString()}
                        </span>
                      )}
                      <span className="text-xs text-[var(--text-muted)]">/ unit</span>
                    </div>

                    {/* Stock remaining bar */}
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                        <span>Available Stock</span>
                        <span className="font-semibold text-[var(--text-primary)]">{p.remaining_stock} units left</span>
                      </div>
                      <div className="w-full bg-[var(--bg-card)] h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all"
                          style={{ width: `${remainingPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <Link
                    to={`/pools?search=${encodeURIComponent(p.product_name)}`}
                    className="w-full py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-95 text-center flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    View & Reserve <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
};
