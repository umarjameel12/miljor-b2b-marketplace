// =============================================================================
// src/pages/SupplierDeliveryPage.jsx
// MilJor Master Supplier Operations Center — Clustered Delivery & Logistics
// =============================================================================
import React, { useState, useEffect } from 'react';
import { AppShell } from '../components/layout/AppShell';
import SupplierDeliverySettingsForm from '../components/delivery/SupplierDeliverySettingsForm';
import { Truck, MapPin, Calendar, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';

export const SupplierDeliveryPage = () => {
  const { token } = useAuth();
  const [deliveryRuns, setDeliveryRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDeliveryRuns = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await fetch('/api/v1/supplier/pools/delivery-context', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        // Extract cluster and delivery data
      }
    } catch (err) {
      console.error('Error fetching delivery context:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveryRuns();
  }, [token]);

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)]">
                Logistics & Dispatch
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 font-medium">
                <MapPin className="w-3.5 h-3.5" /> Lahore Metropolitan Clusters
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-[var(--text-primary)]">
              Delivery Modes & Cluster Pricing
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
              Configure Standard Clustered delivery rates, self-managed pickup hubs, and delivery SLAs across Lahore districts.
            </p>
          </div>
        </div>

        {/* Embedded Complete Settings & Cluster Pricing Form */}
        <div className="bg-[var(--bg-surface)] rounded-3xl border border-[var(--border-subtle)] p-6 shadow-xs">
          <SupplierDeliverySettingsForm onSaved={() => toast.success('Delivery logistics updated successfully')} />
        </div>
      </div>
    </AppShell>
  );
};

export default SupplierDeliveryPage;
