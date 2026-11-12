// =============================================================================
// src/components/geo/LahoreClusterSelector.jsx
// MilJor Package D: Integrated Single Form Control Cluster Selector
// Clean theme-consistent select control without nested boxes or duplicate cards
// =============================================================================
import React, { useState, useEffect } from 'react';
import { MapPin, RefreshCw, AlertCircle } from 'lucide-react';
import { geoApi } from '../../api/geo';

export default function LahoreClusterSelector({
  value,
  onChange,
  error,
  disabled = false,
  label = 'Marketplace Cluster',
  badge = 'Local District Only',
  required = true,
  helperText = ''
}) {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const fetchClusters = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await geoApi.getClusters();
      if (res?.success && res.data?.clusters) {
        const activeClusters = res.data.clusters.filter(c => c.is_active);
        setClusters(activeClusters);
      } else {
        setFetchError('Unable to load Lahore clusters.');
      }
    } catch (err) {
      console.error('[LahoreClusterSelector] Error loading clusters:', err);
      setFetchError('Unable to load Lahore clusters.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClusters();
  }, []);

  const handleChange = (e) => {
    const selectedId = e.target.value;
    const cluster = clusters.find(c => String(c.id) === String(selectedId));
    onChange({
      target: {
        name: 'cluster_id',
        value: selectedId,
        clusterCode: cluster?.cluster_code,
        clusterName: cluster?.name
      }
    }, cluster);
  };

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label className="text-xs font-sans font-medium flex items-center justify-between h-4" style={{ color: 'var(--text-secondary)' }}>
          <span className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-stone-500 shrink-0" />
            <span>{label}</span>
            {required && <span className="text-red-500">*</span>}
          </span>
          {badge && <span className="text-[10px] text-stone-400">{badge}</span>}
        </label>
      )}

      {loading ? (
        <div
          className="w-full px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between animate-pulse"
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-muted)'
          }}
        >
          <span>Loading authorized Lahore clusters...</span>
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-stone-400" />
        </div>
      ) : fetchError ? (
        <div
          className="w-full px-3.5 py-2 rounded-xl border text-xs flex items-center justify-between"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            borderColor: 'rgba(239, 68, 68, 0.3)',
            color: 'var(--text-primary)'
          }}
        >
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{fetchError}</span>
          </div>
          <button
            type="button"
            onClick={fetchClusters}
            className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:opacity-80 transition cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="relative">
          <select
            value={value || ''}
            onChange={handleChange}
            disabled={disabled}
            required={required}
            aria-label={label}
            className={`w-full px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] appearance-none cursor-pointer h-[42px] ${
              disabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: error ? 'var(--status-danger)' : 'var(--border-default)',
              color: value ? 'var(--text-primary)' : 'var(--text-muted)'
            }}
          >
            <option value="" disabled>Select predefined Lahore cluster...</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id} className="py-1">
                {c.name} ({c.cluster_code}){c.hub_name ? ` · Hub: ${c.hub_name}` : ''}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-stone-400">
            <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
              <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd" />
            </svg>
          </div>
        </div>
      )}

      {helperText && !error && (
        <p className="text-[11px] text-stone-500 mt-0.5">{helperText}</p>
      )}
      {error && (
        <p className="text-[11px] text-red-500 font-medium mt-0.5">{error}</p>
      )}
    </div>
  );
}
