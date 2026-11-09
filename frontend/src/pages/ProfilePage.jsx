import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import BuyerSmartAddressForm from '../components/delivery/BuyerSmartAddressForm';
import SupplierDeliverySettingsForm from '../components/delivery/SupplierDeliverySettingsForm';
import LahoreClusterSelector from '../components/geo/LahoreClusterSelector';
import { deliveryApi } from '../api/delivery';
import { toast } from 'react-toastify';
import {
  User,
  Building2,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  ClipboardList,
  Layers,
  LogOut,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Truck,
  Store,
  Sliders,
  Edit2
} from 'lucide-react';

export const ProfilePage = () => {
  const { user, isAuthenticated, logout, updateBaseCluster } = useAuth();
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingCluster, setEditingCluster] = useState(false);
  const [newClusterId, setNewClusterId] = useState('');
  const [savingCluster, setSavingCluster] = useState(false);

  const isSupplier = user?.role === 'SUPPLIER';
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  // Active view tab if role is ADMIN or has both capabilities
  const [activeTab, setActiveTab] = useState(isSupplier ? 'supplier_settings' : 'buyer_addresses');

  useEffect(() => {
    if (isSupplier) {
      setActiveTab('supplier_settings');
    } else {
      setActiveTab('buyer_addresses');
    }
  }, [isSupplier]);

  useEffect(() => {
    if (isAuthenticated && !isSupplier) {
      loadAddresses();
    }
  }, [isAuthenticated, isSupplier]);

  const loadAddresses = async () => {
    try {
      setLoadingAddresses(true);
      const res = await deliveryApi.getBuyerAddresses();
      if (res?.success && Array.isArray(res.data)) {
        setAddresses(res.data);
      }
    } catch (err) {
      console.error('[ProfilePage] Failed to load buyer addresses:', err);
    } finally {
      setLoadingAddresses(false);
    }
  };

  const handleSaveCluster = async () => {
    if (!newClusterId) {
      toast.error('Please select an authoritative Lahore cluster.');
      return;
    }
    setSavingCluster(true);
    try {
      await updateBaseCluster(newClusterId);
      toast.success('Marketplace base cluster updated successfully.');
      setEditingCluster(false);
    } catch (err) {
      toast.error(err.message || 'Failed to update base cluster');
    } finally {
      setSavingCluster(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!isAuthenticated) {
    return (
      <AppShell title="Account Profile">
        <div className="p-4 sm:p-6 lg:p-8 max-w-lg mx-auto text-center space-y-4 my-12">
          <div className="w-16 h-16 rounded-3xl mx-auto flex items-center justify-center border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
            <User className="w-8 h-8 text-[var(--brand-accent)]" />
          </div>
          <h2 className="font-display font-bold text-2xl" style={{ color: 'var(--text-primary)' }}>
            Sign In Required
          </h2>
          <p className="text-xs text-stone-500">
            Please sign in to view your business profile, order milestones, and volume procurement records.
          </p>
          <div className="pt-2">
            <Link to="/login">
              <button
                type="button"
                className="px-6 py-2.5 rounded-full text-xs font-semibold shadow-xs"
                style={{
                  backgroundColor: 'var(--brand-accent)',
                  color: 'var(--text-on-champagne)',
                }}
              >
                Sign In to Account
              </button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const initials = (user?.business_name || user?.full_name || user?.email || 'U').slice(0, 2).toUpperCase();

  return (
    <AppShell title={isSupplier ? 'Supplier Business Portal' : 'Buyer Account Profile'}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
        {/* Profile Header Banner */}
        <div
          className="p-6 sm:p-8 rounded-3xl border shadow-sm relative overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center font-display font-bold text-xl shrink-0 shadow-xs"
                style={{
                  backgroundColor: 'var(--brand-accent)',
                  color: '#072a21',
                }}
              >
                {initials}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display font-bold text-xl sm:text-2xl" style={{ color: 'var(--text-primary)' }}>
                    {user?.business_name || user?.full_name || 'Verified Member'}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                      isSupplier
                        ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                        : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                    }`}
                  >
                    {isSupplier ? <Truck className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                    <span>{isSupplier ? 'Verified Supplier' : 'Verified Buyer'}</span>
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {isSupplier
                    ? 'Wholesale Commodity Supplier & Distributor — Lahore District'
                    : 'Commercial Food Procurement Partner'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2 rounded-xl text-xs font-semibold border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Multi-Role Switcher Tabs (For Admin or Dual Access) */}
        {isAdmin && (
          <div
            className="grid grid-cols-2 p-1 rounded-2xl border text-xs font-semibold"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('buyer_addresses')}
              className={`py-2.5 text-center rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'buyer_addresses' ? 'shadow-xs font-bold' : 'hover:text-[var(--text-primary)]'
              }`}
              style={{
                backgroundColor: activeTab === 'buyer_addresses' ? 'var(--bg-surface)' : 'transparent',
                color: activeTab === 'buyer_addresses' ? 'var(--brand-accent)' : 'var(--text-muted)',
                border: activeTab === 'buyer_addresses' ? '1px solid var(--border-default)' : '1px solid transparent',
              }}
            >
              <Store className="w-3.5 h-3.5" />
              <span>Buyer Delivery Addresses</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('supplier_settings')}
              className={`py-2.5 text-center rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'supplier_settings' ? 'shadow-xs font-bold' : 'hover:text-[var(--text-primary)]'
              }`}
              style={{
                backgroundColor: activeTab === 'supplier_settings' ? 'var(--bg-surface)' : 'transparent',
                color: activeTab === 'supplier_settings' ? 'var(--brand-accent)' : 'var(--text-muted)',
                border: activeTab === 'supplier_settings' ? '1px solid var(--border-default)' : '1px solid transparent',
              }}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Supplier Delivery Settings</span>
            </button>
          </div>
        )}

        {/* Account Details Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div
            className="p-5 rounded-2xl border space-y-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <h3 className="font-sans font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>
              Business Contact
            </h3>
            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-stone-400 shrink-0" />
                <div>
                  <span className="text-[10px] text-stone-500 block">Email Address</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {user?.email || 'N/A'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-stone-400 shrink-0" />
                <div>
                  <span className="text-[10px] text-stone-500 block">SMS Notifications Mobile</span>
                  <span className="font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {user?.phone || '0300 1234567'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Building2 className="w-4 h-4 text-stone-400 shrink-0" />
                <div>
                  <span className="text-[10px] text-stone-500 block">Business Category</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {isSupplier ? 'Wholesale Commodity Supplier' : 'Restaurant / Commercial Kitchen'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div
            className="p-5 rounded-2xl border space-y-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-sans font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>
                {isSupplier ? 'Base Facility Location' : 'Marketplace Base Cluster'}
              </h3>
              {!isSupplier && (
                <button
                  type="button"
                  onClick={() => {
                    setNewClusterId(user?.base_cluster_id ? String(user.base_cluster_id) : '');
                    setEditingCluster(!editingCluster);
                  }}
                  className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>{editingCluster ? 'Cancel' : 'Change'}</span>
                </button>
              )}
            </div>

            {editingCluster ? (
              <div className="pt-1 space-y-3">
                <LahoreClusterSelector
                  value={newClusterId}
                  onChange={(e) => setNewClusterId(e.target.value)}
                  label="Update Discovery Base Cluster"
                  helperText="Select your primary operational drop zone in Lahore."
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditingCluster(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCluster}
                    disabled={savingCluster}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: 'var(--brand-accent)', color: 'var(--text-on-champagne)' }}
                  >
                    {savingCluster ? 'Saving...' : 'Save Cluster'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-stone-400 shrink-0" />
                  <div>
                    <span className="text-[10px] text-stone-500 block">Operational Cluster</span>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {user?.area || (user?.base_cluster_id ? `Lahore Cluster #${user.base_cluster_id}` : 'Lahore — Not Configured')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <span className="text-[10px] text-stone-500 block">
                      {isSupplier ? 'Platform Verification' : 'Escrow Protection'}
                    </span>
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                      {isSupplier ? 'Authoritative Lahore Supplier' : '100% Safepay Covered'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* VIEW 1: SUPPLIER DELIVERY CONFIGURATION */}
        {(isSupplier || activeTab === 'supplier_settings') && (
          <div className="space-y-4">
            <SupplierDeliverySettingsForm onSaved={() => {}} />
          </div>
        )}

        {/* VIEW 2: BUYER SAVED DELIVERY ADDRESSES (SMART LOCATION LITE) */}
        {(!isSupplier || activeTab === 'buyer_addresses') && (
          <div
            className="p-6 rounded-3xl border shadow-sm space-y-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold text-base sm:text-lg" style={{ color: 'var(--text-primary)' }}>
                  Lahore Delivery Addresses
                </h2>
                <p className="text-xs text-stone-500">
                  Predefined 12-cluster drop zones and Smart Location Lite delivery profiles.
                </p>
              </div>
              {!showAddressForm && (
                <button
                  type="button"
                  onClick={() => setShowAddressForm(true)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  style={{
                    backgroundColor: 'var(--brand-accent)',
                    color: 'var(--text-on-champagne)',
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Address</span>
                </button>
              )}
            </div>

            {showAddressForm ? (
              <div className="pt-2">
                <BuyerSmartAddressForm
                  onAddressSaved={(newAddr) => {
                    setShowAddressForm(false);
                    loadAddresses();
                  }}
                  onCancel={() => setShowAddressForm(false)}
                />
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                {loadingAddresses ? (
                  <div className="text-xs text-stone-400 py-4 text-center">Loading saved addresses...</div>
                ) : addresses.length === 0 ? (
                  <div
                    className="p-6 rounded-2xl border text-center space-y-2"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    <MapPin className="w-6 h-6 mx-auto text-stone-400" />
                    <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      No delivery address saved yet
                    </p>
                    <p className="text-[11px] text-stone-500 max-w-sm mx-auto">
                      Add your commercial kitchen, warehouse, or retail shop location to view cluster-based delivery options.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {addresses.map((addr) => (
                      <div
                        key={addr.id}
                        className="p-4 rounded-2xl border space-y-2 relative"
                        style={{
                          backgroundColor: 'var(--bg-card)',
                          borderColor: addr.is_default ? 'var(--brand-accent)' : 'var(--border-subtle)',
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>
                            {addr.society_area}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {addr.is_default ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                Default
                              </span>
                            ) : null}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                addr.geographic_match_status === 'VERIFIED'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                              }`}
                            >
                              {addr.geographic_match_status}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                          {addr.full_address}
                        </p>

                        <div className="pt-2 border-t flex items-center justify-between text-[11px]" style={{ borderColor: 'var(--border-subtle)' }}>
                          <span className="font-medium" style={{ color: 'var(--brand-accent)' }}>
                            {addr.cluster_name || `Cluster #${addr.cluster_id}`}
                          </span>
                          <span className="text-stone-400">{addr.city}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quick Nav Action Links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            to="/orders"
            className="p-4 rounded-2xl border flex items-center justify-between transition hover:opacity-90"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <ClipboardList className="w-5 h-5 text-emerald-800 dark:text-champagne" />
              </div>
              <div>
                <span className="font-semibold text-xs block" style={{ color: 'var(--text-primary)' }}>
                  View Orders & Reservations
                </span>
                <span className="text-[11px] text-stone-500">
                  Track batch milestones and delivery fulfillment
                </span>
              </div>
            </div>
          </Link>

          <Link
            to="/pools"
            className="p-4 rounded-2xl border flex items-center justify-between transition hover:opacity-90"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <Layers className="w-5 h-5 text-emerald-800 dark:text-champagne" />
              </div>
              <div>
                <span className="font-semibold text-xs block" style={{ color: 'var(--text-primary)' }}>
                  Explore Wholesale Pools
                </span>
                <span className="text-[11px] text-stone-500">
                  Browse live commodities and reserve volume
                </span>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </AppShell>
  );
};

export default ProfilePage;
