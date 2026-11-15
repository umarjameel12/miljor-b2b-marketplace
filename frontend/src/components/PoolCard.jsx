// =============================================================================
// src/components/PoolCard.jsx
// MilJor Package D: Premium Quiet-Luxury B2B Commodity Pool Card
// Un-slopped hierarchy, fulfillment mode availability indicators,
// clean progress mechanics, and responsive card rhythm
// =============================================================================
import React, { useEffect, useState } from 'react';
import { Package, Truck, Store, Zap, Clock, Lock } from 'lucide-react';
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

export const PoolCard = ({ pool, onSelect, isExample = false }) => {
  const [imgError, setImgError] = useState(false);
  const [deadlineExpired, setDeadlineExpired] = useState(false);
  const [showProductDetails, setShowProductDetails] = useState(false);
  useEffect(() => setDeadlineExpired(false), [pool.scheduled_close_at, pool.expires_at]);

  // Safe progress percentage clamped between 0 and 100
  const progressPercent = Math.min(
    100,
    Math.max(0, parseFloat(pool.fill_percentage || pool.progress_percentage || 0))
  );

  const isClosed = !isExample && (pool.status === 'CLOSED' || deadlineExpired);
  const estimatedPrice = pool.estimated_unit_price || pool.current_unit_price || pool.current_price_per_unit || pool.base_unit_price;
  const unit = pool.pool_unit || pool.unit || pool.pack_unit || 'kg';
  const buyerMoq = pool.min_order_qty || pool.buyer_min_qty || pool.moq_buyer || 1;
  const grade = pool.quality_spec_grade || pool.quality_grade || pool.grade || null;
  const brandLabel = pool.brand ? pool.brand : (pool.is_unbranded ? 'Unbranded' : null);
  const normalizedPack = pool.pack_size
    ? String(pool.pack_size).trim() + (/(kg|g|litres?|bags?|tins?|cartons?|\d\s*l)\b/i.test(String(pool.pack_size))
      ? '' : ' ' + (pool.pack_unit || unit))
    : null;
  const specification = [
    pool.variety || (isExample ? pool.category_name : null),
    pool.quality_spec_grade || pool.quality_grade || pool.grade,
    normalizedPack,
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' · ');
  const committedQty = pool.committed_quantity !== undefined ? pool.committed_quantity : (pool.current_qty !== undefined ? Number(pool.current_qty) : Math.round((progressPercent / 100) * (pool.target_quantity || pool.target_qty || 1000)));
  const targetQty = Number(pool.target_quantity || pool.target_qty || 1000);
  const cutoffFormatted = formatLahoreTimestamp(pool.scheduled_close_at || pool.expires_at);
  const deliveryTimestampMs = pool.promised_delivery_at ? new Date(pool.promised_delivery_at).getTime() : NaN;
  const closeTimestampMs = pool.scheduled_close_at || pool.expires_at ? new Date(pool.scheduled_close_at || pool.expires_at).getTime() : NaN;
  const deliveryDateConflict = Number.isFinite(deliveryTimestampMs) &&
    Number.isFinite(closeTimestampMs) && deliveryTimestampMs < closeTimestampMs;
  const promisedDeliveryFormatted = !deliveryDateConflict ? formatLahoreTimestamp(pool.promised_delivery_at) : null;
  const rawName = pool.product_name || pool.title || '';
  const varietyText = String(pool.variety || '').trim();
  const productName = rawName && !/^(wholesale commodity|commodity|product)$/i.test(rawName.trim())
    ? rawName
    : /1121|basmati|rice|sella|kernel|grain/i.test(varietyText)
      ? '1121 Basmati Rice'
      : pool.category_name || pool.family_name || 'Wholesale Commodity';
  const productLower = productName.toLowerCase();
  const sellerName = pool.supplier_business_name || pool.supplier_name;
  const sellerDisplay = sellerName ? (isExample ? `${sellerName} · Demo` : sellerName) : (isExample ? 'Demo supplier' : null);
  const categoryLabel = /rice|basmati|kainat|sella|grain/.test(productLower) ? 'Rice & Grains'
    : /oil|ghee|olein/.test(productLower) ? 'Cooking Oil & Ghee'
    : /flour|atta|maida|chakki|wheat/.test(productLower) ? 'Flour & Bakery'
    : /daal|dal|lentil|masoor|chana|moong|pulse/.test(productLower) ? 'Pulses & Lentils'
    : /sugar|shakar/.test(productLower) ? 'Sugar & Sweeteners' : 'Wholesale Essentials';

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
      className="h-full min-w-0 rounded-3xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md flex flex-col overflow-hidden group"
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
            style={{ backgroundColor: 'var(--bg-subtle)' }}
          >
            <Package className="w-8 h-8" style={{ color: 'var(--landing-accent-text, var(--brand-accent))' }} />
          </div>
        )}

        {/* Live Status Badge Overlay */}
        <div className="absolute top-2.5 right-2.5">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-md shadow-xs"
            style={{
              backgroundColor: isExample ? 'rgba(28, 56, 46, .94)' : isClosed ? 'rgba(95, 72, 62, 0.94)' : 'rgba(49, 39, 24, 0.9)',
              color: '#f7edd7',
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
                  : 'bg-amber-300'
              }`}
            />
            <span>
              {isClosed
                ? 'Concluded'
                : isExample ? 'Example Pool'
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
            {isExample ? 'ILLUSTRATIVE' : pool.pool_code || (pool.spec_code ? `SPEC-${pool.spec_code}` : 'POOL')}
          </span>
        </div>
      </div>

      {/* Card Content Body */}
      <div className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {/* Product Title */}
          <h3
            className="font-sans font-bold text-sm sm:text-base tracking-tight leading-snug line-clamp-2"
            style={{ color: 'var(--text-primary)' }}
            title={productName}
          >
            {productName}
          </h3>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold" style={{ color: 'var(--pool-detail-accent)', borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-subtle)' }}>{categoryLabel}</span>
            {sellerDisplay && <span className="text-[10px] font-medium truncate max-w-full" style={{ color: 'var(--text-secondary)' }} title={sellerDisplay}>By {sellerDisplay}</span>}
          </div>

          {/* Short, visible product specification for both real and demo offers. */}
          {specification && (
            <div className="rounded-xl border px-3 py-2.5 text-[11px] leading-[1.4rem]"
              style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--text-primary)' }}>Product Specifications</span>
              <p className="mt-0.5 break-words">{specification}</p>
            </div>
          )}
          {!isExample && !specification && (
            <div className="rounded-xl border px-3 py-2 text-[11px]" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Product grade and packaging details available in the published listing
            </div>
          )}

          {/* Participation cutoff and delivery promise. Example data is illustrative only. */}
          {(cutoffFormatted || promisedDeliveryFormatted || deliveryDateConflict) && (
            <div className="mt-2 p-2 rounded-xl border text-[10px] space-y-1" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
              {cutoffFormatted && (
                <div className="space-y-1">
                  <div className="flex items-center justify-end text-[10px] font-medium" style={{ color: 'var(--pool-detail-accent)' }}>
                    <CountdownTimer
                      deadline={pool.scheduled_close_at || pool.expires_at}
                      serverTime={pool.server_time || null}
                      compact
                      label="Closes in"
                      onExpire={() => setDeadlineExpired(true)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium">
                      <Clock className="w-3 h-3" style={{ color: 'var(--pool-detail-accent)' }} aria-hidden="true" />
                      Closes (PKT):
                    </span>
                    <strong className="text-right font-sans font-semibold tabular-nums" style={{ color: 'var(--pool-detail-accent)' }}>{cutoffFormatted}</strong>
                  </div>
                </div>
              )}
              {deliveryDateConflict && !isExample && (
                <div className="flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--pool-detail-accent)' }}>
                  <span className="inline-flex items-center gap-1"><Truck className="w-3 h-3" />Promised Delivery:</span>
                  <span className="font-medium text-right">Pending supplier confirmation</span>
                </div>
              )}
              {promisedDeliveryFormatted && (
                <div className="flex items-center justify-between gap-3" style={{ color: 'var(--pool-detail-accent)' }}>
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Truck className="w-3 h-3 shrink-0" style={{ color: 'var(--pool-detail-accent)' }} aria-hidden="true" />
                    <span>Promised Delivery:</span>
                  </span>
                  <strong className="font-sans font-semibold tabular-nums text-right" style={{ color: 'var(--pool-detail-accent)' }}>{promisedDeliveryFormatted}</strong>
                </div>
              )}
              <div className="flex items-center justify-between text-[9px] pt-0.5 border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" style={{ color: 'var(--pool-detail-accent)' }} />
                  <span>{isExample ? 'Demo Procurement Terms' : 'Immutable Published Terms'}</span>
                </span>
                <span>{isExample ? 'Illustrative terms' : '1–3 Day SLA'}</span>
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
                <Truck className="w-3 h-3" style={{ color: 'var(--pool-detail-accent)' }} />
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
                <Store className="w-3 h-3" style={{ color: 'var(--pool-detail-accent)' }} />
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
                <Zap className="w-3 h-3" style={{ color: 'var(--pool-detail-accent)' }} />
                <span>Express</span>
              </span>
            )}
          </div>

          {/* Price & Fill Percentage Row */}
          <div className="mt-3 flex items-baseline justify-between" title="Estimated Price">
            <div className="flex items-baseline gap-1">
              <span className="sr-only">Estimated Price: </span>
              <span className="font-sans font-bold text-base sm:text-lg tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {estimatedPrice ? `Rs. ${Number(estimatedPrice).toLocaleString()}` : 'Price on Tier'}
              </span>
              <span className="text-[11px] font-sans" style={{ color: 'var(--text-secondary)' }}>
                / {unit}
              </span>
            </div>

            {/* Percentage pill on right side */}
            <span className="text-xs font-sans font-semibold tabular-nums" style={{ color: 'var(--pool-detail-accent)' }}>
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
                  background: 'var(--pool-progress-gradient, linear-gradient(90deg, #b39156, #d8c48e))',
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
            <div className="mt-1 flex items-center justify-between text-[10px] font-sans tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              <span>{committedQty.toLocaleString()} {unit} pledged</span>
              <span>Target: {targetQty.toLocaleString()} {unit}</span>
            </div>
          </div>
        </div>

        {/* Action Button: Reserve Quantity */}
        <div className="mt-auto pt-2">
          <button
            type="button"
            onClick={() => { if (!isExample && onSelect) onSelect(pool); else if (!isExample) setShowProductDetails(true); }}
            disabled={isClosed || isExample}
            className="miljor-pool-join w-full py-2.5 px-3 rounded-xl font-sans font-semibold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs transition-all hover:brightness-105 hover:shadow-md"
            style={{
              background: 'var(--pool-join-gradient, linear-gradient(115deg, #e0cb94, #c8b276 55%, #b39357))',
              color: 'var(--pool-join-ink, #172b24)',
              border: '1px solid var(--pool-join-border, rgba(125, 93, 43, 0.28))',
            }}
          >
            <span>{isExample ? 'Demo Pool · Preview Only' : isClosed ? 'Pool Concluded' : 'Join Wholesale Pool'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default PoolCard;
