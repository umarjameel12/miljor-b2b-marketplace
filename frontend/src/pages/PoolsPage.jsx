// =============================================================================
// src/pages/PoolsPage.jsx
// MilJor Package D: Real Marketplace Discovery & 16-Specification Alignment
// Full Cluster Filtering, Fulfillment Mode Pills, Remote Pickup Inclusion,
// Buyer Base Cluster Defaulting, and Quiet-Luxury B2B Aesthetic
// =============================================================================
import React, { useState, useEffect, useCallback } from 'react';
import {useSearchParams} from 'react-router-dom';
import {BuyerPoolCard} from '../components/pools/BuyerPoolCard';
import unifiedPoolsApi from '../api/unifiedPools';
import catalogApi from '../api/catalog';
import { geoApi } from '../api/geo';
import { useAuth } from '../context/AuthContext';
import { Skeleton } from '../components/ui/Skeleton';
import { AppShell } from '../components/layout/AppShell';
import {
  Search,
  Layers,
  AlertCircle,
  RefreshCw,
  X,
  Package,
  ShieldCheck,
  MapPin,
  Truck,
  Store,
  Zap,
  Filter
} from 'lucide-react';
import FLAGS from '../config/featureFlags';

const CATEGORIES = [
  'All Commodities',
  'Grains & Rice',
  'Flour & Grain',
  'Pulses & Legumes',
  'Oils & Fats',
  'Sugar & Sweeteners',
];

const FULFILLMENT_MODES = [
  { id: 'ALL', label: 'All Modes' },
  { id: 'STANDARD_CLUSTERED', label: 'Doorstep Delivery', icon: Truck },
  { id: 'PICKUP', label: 'Self Pickup', icon: Store },
  { id: 'EXPRESS', label: 'Express Delivery', icon: Zap },
];

export const PoolsPage = () => {
  const { user } = useAuth();
  const [searchParams,setSearchParams]=useSearchParams();
  const initialType=String(searchParams.get('type')||'ALL').toUpperCase();
  const [poolType,setPoolType]=useState(['ALL','REGULAR','FLASH'].includes(initialType)?initialType:'ALL');
  const [serverTime,setServerTime]=useState(null);

  const [pools, setPools] = useState([]);
  const [families, setFamilies] = useState([]);
  const [catalogCategories, setCatalogCategories] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filter States
  const [selectedCategory, setSelectedCategory] = useState('All Commodities');
  const [selectedClusterId, setSelectedClusterId] = useState(user?.base_cluster_id ? String(user.base_cluster_id) : '');
  const [selectedFulfillmentMode, setSelectedFulfillmentMode] = useState('ALL');
  const [includeAllPickup, setIncludeAllPickup] = useState(true);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search')||'');
  const [viewMode, setViewMode] = useState('pools'); // 'pools' or 'catalog'

  // Update default cluster if user logs in or profile changes
  useEffect(() => {
    if (user?.base_cluster_id && !selectedClusterId) {
      setSelectedClusterId(String(user.base_cluster_id));
    }
  }, [user, selectedClusterId]);

  // Load Clusters once
  useEffect(() => {
    async function loadClusters() {
      try {
        const res = await geoApi.getClusters();
        if (res?.success && res.data?.clusters) {
          setClusters(res.data.clusters);
        }
      } catch (err) {
        console.warn('Could not load clusters for filter:', err.message);
      }
    }
    loadClusters();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const categoryParam = selectedCategory !== 'All Commodities' ? Number(selectedCategory) : undefined;
      const clusterParam = selectedClusterId ? Number(selectedClusterId) : undefined;
      const modeParam = selectedFulfillmentMode === 'ALL' ? undefined : selectedFulfillmentMode;

      const [poolsRes, familiesRes, categoriesRes] = await Promise.all([
        unifiedPoolsApi.discover({
          type:poolType,
          category_id:categoryParam,
          cluster_id:clusterParam,
          fulfillment_mode:modeParam,
          include_all_pickup:includeAllPickup,
          search:searchQuery.trim()||undefined,
          limit:100
        }),
        catalogApi.getFamilies(),
        catalogApi.getCategories()
      ]);
      setPools(poolsRes.success&&Array.isArray(poolsRes.data?.pools)?poolsRes.data.pools:[]);
      setServerTime(poolsRes.data?.server_time||null);

      setFamilies(familiesRes.success && Array.isArray(familiesRes.data?.families) ? familiesRes.data.families : []);
      setCatalogCategories(categoriesRes.success && Array.isArray(categoriesRes.data?.categories) ? categoriesRes.data.categories : []);
    } catch (err) {
      console.warn('Could not fetch marketplace data:', err.message);
      setError(err.response?.data?.error?.message || 'Unable to connect to MilJor procurement service.');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, selectedClusterId, selectedFulfillmentMode, includeAllPickup, viewMode, poolType, searchQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Type/category/cluster/search have already been server-filtered.
  const filteredPools = pools;

  const filteredFamilies = families.filter((family) => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const terms = [family.name, family.description, family.family_code,
      ...(Array.isArray(family.aliases) ? family.aliases : [])];
    return (!query || terms.some(term => String(term || '').toLocaleLowerCase().includes(query)))
      && (selectedCategory === 'All Commodities' || String(family.category_id) === selectedCategory);
  });
  const categoryOptions = [{ id: 'All Commodities', name: 'All Commodities' },
    ...catalogCategories.map(c=>({id:String(c.id),name:c.name}))];
  const handleViewChange = (nextView) => {
    setViewMode(nextView);
    setSelectedCategory('All Commodities');
    setSearchQuery('');
  };

  const selectedClusterObj = clusters.find((c) => String(c.id) === String(selectedClusterId));

  return (
    <AppShell title="Wholesale Procurement Pools">
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        {/* Marketplace Search & Discovery Controls */}
        <div
          className="p-5 sm:p-6 rounded-3xl border shadow-xs space-y-4"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {/* Top Row: Mode Toggle & Refresh */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* View Mode Toggle: Live Pools vs Staple Catalog */}
            <div
              className="inline-flex p-1 rounded-2xl border text-xs font-semibold self-start"
              style={{
                backgroundColor: 'var(--bg-input)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <button
                type="button"
                onClick={() => handleViewChange('pools')}
                className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'pools' ? 'shadow-xs font-bold' : 'hover:text-[var(--text-primary)]'
                }`}
                style={{
                  backgroundColor: viewMode === 'pools' ? 'var(--bg-surface)' : 'transparent',
                  color: viewMode === 'pools' ? 'var(--brand-accent)' : 'var(--text-muted)',
                  border: viewMode === 'pools' ? '1px solid var(--border-default)' : '1px solid transparent',
                }}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Live Wholesale Pools</span>
                {pools.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                    {pools.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleViewChange('catalog')}
                className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'catalog' ? 'shadow-xs font-bold' : 'hover:text-[var(--text-primary)]'
                }`}
                style={{
                  backgroundColor: viewMode === 'catalog' ? 'var(--bg-surface)' : 'transparent',
                  color: viewMode === 'catalog' ? 'var(--brand-accent)' : 'var(--text-muted)',
                  border: viewMode === 'catalog' ? '1px solid var(--border-default)' : '1px solid transparent',
                }}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Product Families</span>
                {products.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                    {families.length}
                  </span>
                )}
              </button>
            </div>

            {/* Refresh Button */}
            <button
              onClick={fetchData}
              title="Refresh marketplace"
              aria-label="Refresh marketplace"
              className="px-3.5 py-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-2 hover:bg-stone-50 dark:hover:bg-stone-800 transition cursor-pointer self-end sm:self-auto"
              style={{
                borderColor: 'var(--border-default)',
                color: 'var(--text-secondary)',
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Search Bar & Cluster Filter */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Search Input */}
            <div className="relative md:col-span-7">
              <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder={
                  viewMode === 'pools'
                    ? 'Search pools by commodity, spec code, or variety (e.g. Basmati, 1121, SPEC-001)...'
                    : 'Search product families (e.g. Rice, Daal Chana, Cooking Oil)...'
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-9 py-2 rounded-xl border text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />
              {FLAGS.searchClearButton && searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition rounded-full cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Lahore Cluster Filter Dropdown */}
            <div className="md:col-span-5 flex items-center gap-2">
              <div className="relative flex-1">
                <MapPin className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={selectedClusterId}
                  onChange={(e) => setSelectedClusterId(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)] cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                  title="Filter pools eligible for delivery to your Lahore cluster"
                >
                  <option value="">All Lahore Clusters (Whole District)</option>
                  {clusters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.cluster_code})
                    </option>
                  ))}
                </select>
              </div>

              {selectedClusterId && (
                <button
                  type="button"
                  onClick={() => setSelectedClusterId('')}
                  className="text-stone-400 hover:text-stone-600 p-1.5 rounded-lg border text-xs shrink-0 cursor-pointer"
                  style={{ borderColor: 'var(--border-subtle)' }}
                  title="Clear cluster filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Fulfillment Modes & Remote Pickup Toggle (When viewing live pools) */}
          {viewMode === 'pools' && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              {/* Mode Pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-semibold text-stone-500 mr-1 flex items-center gap-1">
                  <Filter className="w-3 h-3" />
                  <span>Mode:</span>
                </span>
                {FULFILLMENT_MODES.map((mode) => {
                  const active = selectedFulfillmentMode === mode.id;
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setSelectedFulfillmentMode(mode.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                        active ? 'font-semibold shadow-xs' : 'hover:opacity-80'
                      }`}
                      style={{
                        backgroundColor: active ? 'var(--brand-accent)' : 'var(--bg-input)',
                        color: active ? 'var(--text-on-champagne)' : 'var(--text-secondary)',
                        border: `1px solid ${active ? 'var(--brand-accent)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      {Icon && <Icon className="w-3 h-3" />}
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Remote Pickup Inclusion Checkbox */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-stone-500 hover:text-stone-700 dark:hover:text-stone-300">
                <input
                  type="checkbox"
                  checked={includeAllPickup}
                  onChange={(e) => setIncludeAllPickup(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-emerald-700 focus:ring-[var(--brand-accent)] cursor-pointer"
                />
                <span className="text-[11px]">Include all depot pickup points across Lahore</span>
              </label>
            </div>
          )}

          {/* Commodity Categories Scroll Strip */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 no-scrollbar border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            {categoryOptions.map((cat) => {
              const active = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 cursor-pointer ${
                    active ? 'shadow-xs font-semibold' : 'hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: active ? 'var(--brand-primary)' : 'var(--bg-elevated)',
                    color: active ? 'var(--text-on-emerald)' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <span>{cat.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Results Header Count & Active Filter Indicator */}
        {!loading && (
          <div className="flex flex-wrap items-center justify-between text-xs text-stone-500 font-sans px-1 gap-2">
            <div className="flex items-center gap-2">
              <span>
                Showing{' '}
                <strong className="font-semibold text-stone-700 dark:text-stone-300">
                  {viewMode === 'pools' ? filteredPools.length : filteredFamilies.length}
                </strong>{' '}
                {viewMode === 'pools' ? 'wholesale pools' : 'product families'}
              </span>

              {selectedClusterObj && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[11px]">
                  <MapPin className="w-3 h-3 text-amber-500" />
                  <span>Filtered to {selectedClusterObj.name}</span>
                </span>
              )}

              {selectedFulfillmentMode !== 'ALL' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-[11px]">
                  <span>Mode: {selectedFulfillmentMode}</span>
                </span>
              )}
            </div>

            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
              {viewMode === 'pools' ? '● Real-Time Volume Pooling' : '✓ MilJor-governed product families'}
            </span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div
            className="p-4 rounded-2xl border flex items-center justify-between animate-in fade-in duration-200"
            style={{
              backgroundColor: 'var(--status-danger-bg)',
              borderColor: 'var(--status-danger)',
              color: 'var(--status-danger)',
            }}
          >
            <div className="flex items-center gap-2.5 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={fetchData}
              className="text-xs font-semibold underline hover:opacity-80 cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}

        {viewMode==='pools'&&<div className="flex flex-wrap gap-2" aria-label="Choose pool type">
          {['ALL','REGULAR','FLASH'].map(t=><button type="button" key={t} onClick={()=>{
            setPoolType(t);
            const next=new URLSearchParams(searchParams);
            if(t==='ALL')next.delete('type');else next.set('type',t);
            setSearchParams(next);
          }} aria-pressed={poolType===t}
            className={`rounded-xl px-4 py-2 text-xs font-semibold border ${poolType===t?'border-emerald-600 bg-emerald-500/10 text-emerald-600':'border-[var(--border-subtle)]'}`}>
            {t==='ALL'?'All Pools':t==='REGULAR'?'Regular Pools':'Flash Pools'}
          </button>)}
        </div>}
        {/* Content Grid: Pools vs Catalog */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="rounded-3xl border p-4 space-y-4"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <Skeleton className="h-32 w-full rounded-2xl" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-8 w-full rounded-xl" />
              </div>
            ))}
          </div>
        ) : viewMode === 'pools' ? (
          filteredPools.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPools.map((pool) => (
                <BuyerPoolCard key={pool.type+'-'+pool.id} pool={pool}
                  serverTime={serverTime} clusterId={selectedClusterId} onChange={fetchData}/>
              ))}
            </div>
          ) : (
            <div
              className="p-12 text-center rounded-3xl border max-w-lg mx-auto"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <Layers className="w-10 h-10 mx-auto text-stone-300 dark:text-stone-600 mb-3" />
              <h3 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                No Pools Match Filter Criteria
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                {selectedClusterId
                  ? `No active pools are currently offering fulfillment to ${selectedClusterObj?.name || 'this cluster'}. Try switching to "All Lahore Clusters" or including pickup.`
                  : 'Try selecting another commodity category, clearing your search filter, or resetting mode.'}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {selectedClusterId && (
                  <button
                    onClick={() => setSelectedClusterId('')}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer border"
                    style={{
                      borderColor: 'var(--border-default)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    View All Clusters
                  </button>
                )}
                {selectedCategory !== 'All Commodities' && (
                  <button
                    onClick={() => setSelectedCategory('All Commodities')}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                    style={{
                      backgroundColor: 'var(--brand-accent)',
                      color: 'var(--text-on-champagne)',
                    }}
                  >
                    All Commodities
                  </button>
                )}
              </div>
            </div>
          )
        ) : (
          /* Canonical families: never display legacy spec brands, fixed packs or invented MOQ. */
          filteredFamilies.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredFamilies.map((family) => (
                <div key={family.id} className="p-5 rounded-3xl border shadow-xs flex flex-col gap-4"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">{family.category_name}</span>
                    <span className="text-[10px] text-stone-500 font-mono">{family.family_code}</span>
                  </div>
                  <div>
                    <h3 className="font-sans font-bold text-base" style={{ color: 'var(--text-primary)' }}>{family.name}</h3>
                    <p className="text-xs text-stone-500 mt-2">{family.description}</p>
                  </div>
                  <div className="mt-auto border-t pt-3 text-xs text-stone-500"
                    style={{ borderColor: 'var(--border-subtle)' }}>
                    Brand, grade, pack size, price and MOQ depend on each supplier's actual SKU and offer.
                  </div>
                  <button type="button" onClick={() => {
                    setViewMode('pools');
                    setSelectedCategory('All Commodities');
                    setSearchQuery(family.name);
                  }} className="px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                    style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--text-on-champagne)' }}>
                    Find Live Pools
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="p-12 text-center rounded-3xl border max-w-lg mx-auto"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <Package className="w-10 h-10 mx-auto text-stone-300 dark:text-stone-600 mb-3" />
              <h3 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                No Product Families Found
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                Try another category or clear your search. Product families are maintained by MilJor.
              </p>
            </div>
          )
        )}
      </div>
    </AppShell>
  );
};

export default PoolsPage;
