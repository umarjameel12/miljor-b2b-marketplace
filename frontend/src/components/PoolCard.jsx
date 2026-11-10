// =============================================================================
// src/components/PoolCard.jsx
// MilJor Package D: Premium Quiet-Luxury B2B Commodity Pool Card
// Un-slopped hierarchy, fulfillment mode availability indicators,
// clean progress mechanics, and responsive card rhythm
// =============================================================================
import React, { useState } from 'react';
import { Package, Truck, Store, Zap, ShieldCheck, MapPin, Clock, Lock } from 'lucide-react';
import FLAGS from '../config/featureFlags';
import { CountdownTimer } from './ui/CountdownTimer';

const formatLahoreTimestamp = (ts) => {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return null;
  }
};

// Curated high-fidelity food imagery matching Quiet Luxury aesthetic
const DEFAULT_CARD_IMAGES = {
  tomatoes: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=500&q=80',
  rice: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=500&q=80',
  dal: 'https://images.unsplash.com/photo-1585994192701-f1a505c817ea?auto=format&fit=crop&w=500&q=80',
  flour: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=500&q=80',
  oil: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=500&q=80',
  sugar: 'https://images.unsplash.com/photo-1581441363689-1f3c3c414635?auto=format&fit=crop&w=500&q=80',
};

export const PoolCard = ({ pool, onSelect }) => {
  const [imgError, setImgError] = useState(false);

  // Safe progress percentage clamped between 0 and 100
  const progressPercent = Math.min(
    100,
    Math.max(0, parseFloat(pool.fill_percentage || pool.progress_percentage || 0))
  );

  const isClosed = pool.status === 'CLOSED';
  const estimatedPrice = pool.estimated_unit_price || pool.current_unit_price || pool.current_price_per_unit || pool.base_unit_price;
  const unit = pool.pack_unit || pool.pool_unit || 'kg';
  const buyerMoq = pool.min_order_qty || pool.buyer_min_qty || pool.moq_buyer || 1;
  const grade = pool.quality_spec_grade || pool.quality_grade || pool.grade || null;
  const brandLabel = pool.brand ? pool.brand : (pool.is_unbranded ? 'Unbranded' : null);
  const committedQty = pool.committed_quantity !== undefined ? pool.committed_quantity : (pool.current_qty !== undefined ? Number(pool.current_qty) : Math.round((progressPercent / 100) * (pool.target_quantity || pool.target_qty || 1000)));
  const targetQty = Number(pool.target_quantity || pool.target_qty || 1000);
  const cutoffFormatted = formatLahoreTimestamp(pool.scheduled_close_at || pool.expires_at);
  const promisedDeliveryFormatted = formatLahoreTimestamp(pool.promised_delivery_at);

  // Fulfillment Availability Indicators (Phase 6D.3 / Package D Invariant)
  const hasStandard = Boolean(
    pool.standard_delivery_available ||
    pool.delivery_type === 'DOORSTEP_ONLY' ||
    pool.delivery_type === 'BOTH' ||
    (pool.fulfillment_modes_available && pool.fulfillment_modes_available.includes('STANDARD_CLUSTERED'))
  );

  const hasExpress = Boolean(
    pool.express_delivery_available ||
    (pool.fulfillment_modes_available && pool.fulfillment_modes_available.includes('EXPRESS'))
  );

  const hasPickup = Boolean(
    pool.pickup_available ||
    pool.delivery_type === 'SUPPLIER_PICKUP' ||
    pool.delivery_type === 'BOTH' ||
    (pool.fulfillment_modes_available && pool.fulfillment_modes_available.includes('PICKUP'))
  );

  // Determine appropriate fallback image
  let imageUrl = pool.image_url;
  if (!imageUrl) {
    const nameLower = (pool.product_name || pool.title || '').toLowerCase();
    if (nameLower.includes('rice') || nameLower.includes('basmati') || nameLower.includes('kainat') || nameLower.includes('sella')) {
      imageUrl = DEFAULT_CARD_IMAGES.rice;
    } else if (nameLower.includes('dal') || nameLower.includes('lentil') || nameLower.includes('masoor') || nameLower.includes('chana') || nameLower.includes('moong')) {
      imageUrl = DEFAULT_CARD_IMAGES.dal;
    } else if (nameLower.includes('flour') || nameLower.includes('atta') || nameLower.includes('maida') || nameLower.includes('chakki')) {
      imageUrl = DEFAULT_CARD_IMAGES.flour;
    } else if (nameLower.includes('oil') || nameLower.includes('ghee') || nameLower.includes('olein')) {
      imageUrl = DEFAULT_CARD_IMAGES.oil;
    } else if (nameLower.includes('sugar') || nameLower.includes('shakar')) {
      imageUrl = DEFAULT_CARD_IMAGES.sugar;
    } else {
      imageUrl = DEFAULT_CARD_IMAGES.rice;
    }
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
      }}
      className="rounded-3xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md flex flex-col overflow-hidden group select-none"
    >
      {/* Top Banner Photo */}
      <div className="relative h-28 sm:h-32 w-full overflow-hidden bg-stone-200 dark:bg-stone-900">
        {!imgError ? (
          <img
            src={imageUrl}
            alt={pool.product_name || 'Commodity'}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--brand-primary)' }}
          >
            <Package className="w-8 h-8 text-stone-300" />
          </div>
        )}

        {/* Live Status Badge Overlay */}
        <div className="absolute top-2.5 right-2.5">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-md shadow-xs"
            style={{
              backgroundColor: isClosed
                ? 'rgba(163, 34, 34, 0.92)'
                : FLAGS.dynamicDemandBadges && progressPercent >= 75
                ? 'rgba(7, 42, 33, 0.92)'
                : FLAGS.dynamicDemandBadges && progressPercent >= 50
                ? 'rgba(180, 83, 9, 0.90)'
                : 'rgba(7, 42, 33, 0.88)',
              color: '#f7f3e8',
              border: `1px solid ${
                FLAGS.dynamicDemandBadges && progressPercent >= 75
                  ? 'rgba(200, 178, 118, 0.6)'
                  : 'rgba(200, 178, 118, 0.3)'
              }`,
            }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isClosed
                  ? 'bg-red-400'
                  : FLAGS.dynamicDemandBadges && progressPercent >= 50
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400'
              }`}
            />
            <span>
              {isClosed
                ? 'Concluded'
                : FLAGS.dynamicDemandBadges && progressPercent >= 75
                ? 'Wholesale Tier 2'
                : FLAGS.dynamicDemandBadges && progressPercent >= 50
                ? 'Filling Fast'
                : 'Live Pool'}
            </span>
          </span>
        </div>

        {/* Spec Code / Pool Code pill */}
        <div className="absolute bottom-2 left-2.5">
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium backdrop-blur-md bg-black/60 text-stone-200 border border-white/10">
            {pool.pool_code || (pool.spec_code ? `SPEC-${pool.spec_code}` : 'POOL')}
          </span>
        </div>
      </div>

      {/* Card Content Body */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          {/* Product Title */}
          <h3
            className="font-sans font-bold text-sm sm:text-base tracking-tight truncate"
            style={{ color: 'var(--text-primary)' }}
            title={pool.product_name || pool.title}
          >
            {pool.product_name || pool.title || 'Wholesale Commodity'}
          </h3>

          {/* Supplier Info & Grade Line */}
          <div className="flex items-center justify-between text-[11px] font-sans text-stone-500 dark:text-stone-400 mt-0.5">
            <span className="truncate max-w-[170px]" title={pool.supplier_name || pool.supplier_business_name}>
              {pool.supplier_name || pool.supplier_business_name ? `By ${pool.supplier_name || pool.supplier_business_name}` : 'Verified Lahore Mill'}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {brandLabel && (
                <>
                  <span>{brandLabel}</span>
                  <span>•</span>
                </>
              )}
              {grade && (
                <>
                  <span>{grade}</span>
                  <span>•</span>
                </>
              )}
              <span>Min {buyerMoq} {unit}</span>
            </div>
          </div>

          {/* Participation Cutoff & Promised 1-3 Day Delivery SLA */}
          {(cutoffFormatted || promisedDeliveryFormatted) && (
            <div className="mt-2 p-2 rounded-xl border text-[10px] space-y-1" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              {cutoffFormatted && (
                <div className="flex items-center justify-between text-stone-500 dark:text-stone-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-600" />
                    <span>Closes (PKT):</span>
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <CountdownTimer deadline={pool.scheduled_close_at || pool.expires_at} compact label="Closes in" />
                    <strong className="font-mono text-[10px] text-stone-700 dark:text-stone-200">{cutoffFormatted}</strong>
                  </div>
                </div>
              )}
              {promisedDeliveryFormatted && (
                <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Truck className="w-3 h-3" />
                    <span>Promised Delivery:</span>
                  </span>
                  <strong className="font-mono">{promisedDeliveryFormatted}</strong>
                </div>
              )}
              <div className="flex items-center justify-between text-[9px] text-stone-400 pt-0.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 text-emerald-600" />
                  <span>Immutable Published Terms</span>
                </span>
                <span>1–3 Day SLA</span>
              </div>
            </div>
          )}

          {/* Clean Fulfillment Mode Availability Indicators */}
          <div className="flex flex-wrap items-center gap-1 mt-2.5">
            {hasStandard && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
                title="Clustered doorstep delivery available across Lahore clusters"
              >
                <Truck className="w-3 h-3 text-emerald-600" />
                <span>Doorstep</span>
              </span>
            )}
            {hasPickup && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
                title="Self-collection available from authorized supplier depots"
              >
                <Store className="w-3 h-3 text-amber-600" />
                <span>Pickup</span>
              </span>
            )}
            {hasExpress && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
                title="Expedited dedicated dispatch available"
              >
                <Zap className="w-3 h-3 text-indigo-500" />
                <span>Express</span>
              </span>
            )}
          </div>

          {/* Price & Fill Percentage Row */}
          <div className="mt-3 flex items-baseline justify-between" title="Current Price Per Unit">
            <div className="flex items-baseline gap-1">
              <span className="font-sans font-bold text-base sm:text-lg tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {estimatedPrice ? `Rs. ${Number(estimatedPrice).toLocaleString()}` : 'Price on Tier'}
              </span>
              <span className="text-[11px] font-sans text-stone-500">
                / {unit}
              </span>
            </div>

            {/* Percentage pill on right side */}
            <span className="text-xs font-sans font-semibold tabular-nums text-stone-600 dark:text-stone-300">
              {progressPercent}%
            </span>
          </div>

          {/* Volume Progress Bar */}
          <div className="mt-1.5">
            <div
              className="relative w-full h-1.5 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--bg-input)' }}
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: 'var(--brand-emerald)',
                }}
              />
              {FLAGS.tierNotchesOnProgress && Array.isArray(pool.pricing_tiers) && pool.pricing_tiers.length > 0 && targetQty > 0 && (
                pool.pricing_tiers.map((t, idx) => {
                  const pct = Math.min(100, Math.max(0, Math.round((Number(t.min_qty || t.threshold_qty || 0) / targetQty) * 100)));
                  if (pct <= 0 || pct >= 100) return null;
                  return (
                    <div
                      key={idx}
                      className="absolute top-0 bottom-0 w-[1.5px] bg-white/60 dark:bg-black/50 z-10"
                      style={{ left: `${pct}%` }}
                      title={`Tier ${idx + 1} Target: ${t.min_qty || t.threshold_qty} ${unit} (${pct}%)`}
                    />
                  );
                })
              )}
            </div>

            {/* Current vs Target volume text */}
            <div className="mt-1 flex items-center justify-between text-[10px] font-sans text-stone-500 dark:text-stone-400 tabular-nums">
              <span>{committedQty.toLocaleString()} {unit} pledged</span>
              <span>Target: {targetQty.toLocaleString()} {unit}</span>
            </div>
          </div>
        </div>

        {/* Action Button: Reserve Quantity */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => onSelect && onSelect(pool)}
            disabled={isClosed}
            className="w-full py-2 px-3 rounded-xl font-sans font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
            style={{
              backgroundColor: 'var(--brand-primary)',
              color: 'var(--text-on-emerald)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span>{isClosed ? 'Pool Concluded' : 'Join Wholesale Pool'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default PoolCard;
