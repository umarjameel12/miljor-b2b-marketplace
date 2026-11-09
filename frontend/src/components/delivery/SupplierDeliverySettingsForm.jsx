// =============================================================================
// src/components/delivery/SupplierDeliverySettingsForm.jsx
// MilJor Package D: Refined Supplier Delivery Modes & Cluster Pricing
// Consistent Quiet-Luxury Design Tokens, Compact Rate Tables & 0% Commission
// =============================================================================
import React, { useState, useEffect } from 'react';
import { Truck, Store, Zap, ShieldCheck, AlertCircle, Plus, Save, Info, CheckCircle2 } from 'lucide-react';
import { geoApi } from '../../api/geo';
import { deliveryApi } from '../../api/delivery';

export default function SupplierDeliverySettingsForm({ onSaved }) {
  const [clusters, setClusters] = useState([]);
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Form State
  const [standardEnabled, setStandardEnabled] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(false);
  const [expressEnabled, setExpressEnabled] = useState(false);
  const [clusterRates, setClusterRates] = useState({});
  const [expressRates, setExpressRates] = useState({});

  // Pickup Point Modal State
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [newPointName, setNewPointName] = useState('');
  const [newPointCluster, setNewPointCluster] = useState('');
  const [newPointAddress, setNewPointAddress] = useState('');
  const [newPointHours, setNewPointHours] = useState('Mon-Sat 09:00 - 18:00');
  const [newPointFee, setNewPointFee] = useState('0');

  useEffect(() => {
    async function loadData() {
      try {
        const [clustersRes, settingsRes] = await Promise.all([
          geoApi.getClusters(),
          deliveryApi.getSupplierDeliverySettings(),
        ]);

        if (clustersRes?.success) {
          setClusters(clustersRes.data.clusters || []);
        }

        if (settingsRes?.success) {
          const cfg = settingsRes.data.configuration || {};
          setSettings(settingsRes.data);
          setStandardEnabled(cfg.standard_delivery_enabled !== false);
          setPickupEnabled(Boolean(cfg.pickup_enabled));
          setExpressEnabled(Boolean(cfg.express_enabled));

          // Map cluster rates
          const stdMap = {};
          const expMap = {};
          (settingsRes.data.cluster_rates || []).forEach((r) => {
            if (r.mode === 'STANDARD_CLUSTERED') {
              stdMap[r.cluster_id] = r.fee_pkr;
            } else if (r.mode === 'EXPRESS') {
              expMap[r.cluster_id] = r.fee_pkr;
            }
          });
          setClusterRates(stdMap);
          setExpressRates(expMap);
        }
      } catch (err) {
        console.error('[SupplierDeliverySettingsForm] Load error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setStatusMessage(null);

    // Invariant: At least one mode must be enabled
    if (!standardEnabled && !pickupEnabled && !expressEnabled) {
      setStatusMessage({
        type: 'error',
        text: 'You must offer at least one fulfillment mode (Standard, Pickup, or Express).',
      });
      return;
    }

    setIsSaving(true);
    try {
      const formattedRates = [];
      clusters.forEach((c) => {
        if (standardEnabled) {
          const fee = Number(clusterRates[c.id]) || 0;
          formattedRates.push({
            cluster_id: c.id,
            mode: 'STANDARD_CLUSTERED',
            fee_pkr: fee,
            is_eligible: true,
          });
        }
        if (expressEnabled) {
          const fee = Number(expressRates[c.id]) || 0;
          formattedRates.push({
            cluster_id: c.id,
            mode: 'EXPRESS',
            fee_pkr: fee,
            is_eligible: fee > 0,
          });
        }
      });

      const payload = {
        standard_delivery_enabled: standardEnabled,
        pickup_enabled: pickupEnabled,
        express_enabled: expressEnabled,
        cluster_rates: formattedRates,
      };

      const res = await deliveryApi.updateSupplierDeliverySettings(payload);
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: 'Fulfillment modes and cluster rates successfully updated.',
        });
        setSettings(res.data);
        if (onSaved) onSaved(res.data);
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.error?.message || err.message || 'Failed to save delivery settings.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreatePickupPoint = async (e) => {
    e.preventDefault();
    if (!newPointName || !newPointCluster || !newPointAddress) return;

    try {
      const res = await deliveryApi.addPickupPoint({
        point_name: newPointName,
        cluster_id: Number(newPointCluster),
        address_line: newPointAddress,
        operating_hours: newPointHours,
        pickup_handling_fee_pkr: Number(newPointFee) || 0.0,
      });

      if (res.success) {
        setShowPickupModal(false);
        setNewPointName('');
        setNewPointAddress('');
        setNewPointFee('0');
        // Refresh settings
        const fresh = await deliveryApi.getSupplierDeliverySettings();
        if (fresh?.success) setSettings(fresh.data);
      }
    } catch (err) {
      alert(err.response?.data?.error?.message || err.message || 'Failed to add pickup point.');
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        Loading fulfillment configuration and Lahore cluster rates...
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-4xl mx-auto rounded-3xl border shadow-lg overflow-hidden transition-colors"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div
        className="px-6 py-5 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div>
          <h3 className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Supplier Fulfillment & Cluster Delivery Settings
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Configure delivery modes, warehouse pickup depots, and independent rates across all 12 Lahore clusters.
          </p>
        </div>

        {/* 0% Commission Indicator Badge */}
        <div
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border shrink-0"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--brand-accent)',
            color: 'var(--brand-accent)',
          }}
          title="MilJor does not take any percentage cut from delivery charges"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>0% MilJor Delivery Fee Commission</span>
        </div>
      </div>

      <form onSubmit={handleSave} className="p-6 space-y-6">
        {/* Status Alert */}
        {statusMessage && (
          <div
            className="p-3.5 rounded-2xl border text-xs flex items-center gap-2.5 animate-in fade-in duration-200"
            style={{
              backgroundColor: statusMessage.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
              borderColor: statusMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
              color: statusMessage.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
            }}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* 1. Fulfillment Mode Selection Cards */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              1. Offered Fulfillment Modes (Select At Least One)
            </h4>
            <span className="text-[11px] text-stone-400">At least one required</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Mode A: Standard Delivery */}
            <div
              onClick={() => setStandardEnabled(!standardEnabled)}
              className="p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between"
              style={{
                backgroundColor: standardEnabled ? 'var(--bg-elevated)' : 'var(--bg-input)',
                borderColor: standardEnabled ? 'var(--brand-accent)' : 'var(--border-subtle)',
                boxShadow: standardEnabled ? 'var(--shadow-xs)' : 'none',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <Truck
                  className="w-5 h-5"
                  style={{ color: standardEnabled ? 'var(--brand-accent)' : 'var(--text-muted)' }}
                />
                <input
                  type="checkbox"
                  checked={standardEnabled}
                  onChange={() => {}}
                  className="w-4 h-4 rounded text-emerald-700 focus:ring-[var(--brand-accent)] cursor-pointer"
                />
              </div>
              <div>
                <h5 className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  Standard Clustered Delivery
                </h5>
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Scheduled batch delivery to buyers' cluster drop addresses.
                </p>
              </div>
            </div>

            {/* Mode B: Pickup */}
            <div
              onClick={() => setPickupEnabled(!pickupEnabled)}
              className="p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between"
              style={{
                backgroundColor: pickupEnabled ? 'var(--bg-elevated)' : 'var(--bg-input)',
                borderColor: pickupEnabled ? 'var(--brand-accent)' : 'var(--border-subtle)',
                boxShadow: pickupEnabled ? 'var(--shadow-xs)' : 'none',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <Store
                  className="w-5 h-5"
                  style={{ color: pickupEnabled ? 'var(--brand-accent)' : 'var(--text-muted)' }}
                />
                <input
                  type="checkbox"
                  checked={pickupEnabled}
                  onChange={() => {}}
                  className="w-4 h-4 rounded text-emerald-700 focus:ring-[var(--brand-accent)] cursor-pointer"
                />
              </div>
              <div>
                <h5 className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  Self Pickup (Depot)
                </h5>
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Buyers collect directly from your designated Lahore warehouse or godown.
                </p>
              </div>
            </div>

            {/* Mode C: Express */}
            <div
              onClick={() => setExpressEnabled(!expressEnabled)}
              className="p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between"
              style={{
                backgroundColor: expressEnabled ? 'var(--bg-elevated)' : 'var(--bg-input)',
                borderColor: expressEnabled ? 'var(--brand-accent)' : 'var(--border-subtle)',
                boxShadow: expressEnabled ? 'var(--shadow-xs)' : 'none',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <Zap
                  className="w-5 h-5"
                  style={{ color: expressEnabled ? 'var(--brand-accent)' : 'var(--text-muted)' }}
                />
                <input
                  type="checkbox"
                  checked={expressEnabled}
                  onChange={() => {}}
                  className="w-4 h-4 rounded text-emerald-700 focus:ring-[var(--brand-accent)] cursor-pointer"
                />
              </div>
              <div>
                <h5 className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  Express Delivery
                </h5>
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Dedicated rapid dispatch within a 4-hour window across eligible clusters.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Cluster Pricing Rate Grid */}
        {standardEnabled && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500">
                  2. Delivery Charges per Lahore Cluster (PKR)
                </h4>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  100% of these charges are remitted directly to you without marketplace deduction.
                </p>
              </div>
              <span className="text-[11px] text-stone-400">12 Active Clusters</span>
            </div>

            <div
              className="border rounded-2xl overflow-hidden shadow-xs"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <table className="w-full text-xs text-left">
                <thead
                  className="border-b text-stone-500 font-semibold"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)',
                  }}
                >
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Cluster Name</th>
                    <th className="py-2.5 px-4 font-semibold">District Hub</th>
                    <th className="py-2.5 px-4 font-semibold w-40">Standard Rate (PKR)</th>
                    {expressEnabled && <th className="py-2.5 px-4 font-semibold w-40">Express Rate (PKR)</th>}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {clusters.map((cluster) => (
                    <tr
                      key={cluster.id}
                      className="hover:opacity-90 transition-colors"
                      style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                      <td className="py-2.5 px-4">
                        <span className="font-semibold block" style={{ color: 'var(--text-primary)' }}>
                          {cluster.name}
                        </span>
                        <span className="text-[10px] text-stone-400 font-mono">
                          {cluster.cluster_code}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-stone-500">
                        {cluster.hub_name}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-[11px]">Rs.</span>
                          <input
                            type="number"
                            min="0"
                            step="10"
                            value={clusterRates[cluster.id] !== undefined ? clusterRates[cluster.id] : '250'}
                            onChange={(e) => setClusterRates({ ...clusterRates, [cluster.id]: e.target.value })}
                            className="w-full pl-8 pr-2 py-1 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)] font-medium"
                            style={{
                              backgroundColor: 'var(--bg-input)',
                              borderColor: 'var(--border-default)',
                              color: 'var(--text-primary)',
                            }}
                          />
                        </div>
                      </td>
                      {expressEnabled && (
                        <td className="py-2.5 px-4">
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-[11px]">Rs.</span>
                            <input
                              type="number"
                              min="0"
                              step="25"
                              value={expressRates[cluster.id] !== undefined ? expressRates[cluster.id] : '600'}
                              onChange={(e) => setExpressRates({ ...expressRates, [cluster.id]: e.target.value })}
                              className="w-full pl-8 pr-2 py-1 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)] font-medium"
                              style={{
                                backgroundColor: 'var(--bg-input)',
                                borderColor: 'var(--border-default)',
                                color: 'var(--text-primary)',
                              }}
                            />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. Pickup Points Management (when Pickup enabled) */}
        {pickupEnabled && (
          <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500">
                  3. Authorized Warehouse Pickup Depots
                </h4>
                <p className="text-[11px] text-stone-400">
                  Buyers may collect orders from these authorized facilities regardless of buyer cluster.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPickupModal(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-default)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--brand-accent)',
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Pickup Depot</span>
              </button>
            </div>

            {settings?.pickup_points?.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {settings.pickup_points.map((pt) => (
                  <div
                    key={pt.id}
                    className="p-3.5 rounded-2xl border text-xs flex flex-col justify-between"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    <div className="flex items-center justify-between font-bold" style={{ color: 'var(--text-primary)' }}>
                      <span>{pt.point_name}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-md font-mono bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                        Handling: Rs. {pt.pickup_handling_fee_pkr}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-500 mt-1">{pt.address_line}</p>
                    <p className="text-[10px] text-stone-400 mt-0.5">Hours: {pt.operating_hours}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="p-5 rounded-2xl border border-dashed text-center text-xs text-stone-400"
                style={{ borderColor: 'var(--border-default)' }}
              >
                No pickup depots configured yet. Click "Add Pickup Depot" to register a mill or godown for self-pickup.
              </div>
            )}
          </div>
        )}

        {/* Submit Bar */}
        <div className="flex items-center justify-end pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl text-xs font-bold transition shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            style={{
              backgroundColor: 'var(--brand-accent)',
              color: 'var(--text-on-champagne)',
            }}
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving Settings...' : 'Save Fulfillment Settings'}</span>
          </button>
        </div>
      </form>

      {/* Pickup Point Creation Modal */}
      {showPickupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div
            className="w-full max-w-md rounded-3xl p-6 border shadow-2xl space-y-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <h4 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Add Authorized Pickup Depot
            </h4>

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Depot / Godown Name
              </label>
              <input
                type="text"
                value={newPointName}
                onChange={(e) => setNewPointName(e.target.value)}
                placeholder="e.g. Badami Bagh Central Grain Depot #4"
                className="w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Lahore Cluster
              </label>
              <select
                value={newPointCluster}
                onChange={(e) => setNewPointCluster(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">Select Lahore Cluster...</option>
                {clusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.cluster_code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Full Physical Address
              </label>
              <textarea
                rows={2}
                value={newPointAddress}
                onChange={(e) => setNewPointAddress(e.target.value)}
                placeholder="Gate #, Street, Landmark..."
                className="w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)] resize-none"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Operating Hours
                </label>
                <input
                  type="text"
                  value={newPointHours}
                  onChange={(e) => setNewPointHours(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Handling Fee (PKR)
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={newPointFee}
                  onChange={(e) => setNewPointFee(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setShowPickupModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreatePickupPoint}
                className="px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
                style={{
                  backgroundColor: 'var(--brand-accent)',
                  color: 'var(--text-on-champagne)',
                }}
              >
                Add Pickup Depot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
