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
    <AppShell title={isAdmin ? 'Admin Account Profile' : isSupplier ? 'Supplier Business Portal' : 'Buyer Account Profile'}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
        {/* Profile Header Banner */}
        <div
          className="p-6 sm:p-7 rounded-2xl border shadow-xs relative overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center font-display font-bold text-lg shrink-0"
                style={{
                  backgroundColor: 'var(--brand-accent)',
                  color: 'var(--text-on-champagne)',
                }}
              >
                {initials}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    {user?.business_name || user?.full_name || 'Verified Member'}
                  </h1>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                      isSupplier ? 'miljor-badge-supplier' : 'miljor-badge-verified'
                    }`}
                  >
                    {isSupplier ? <Truck className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                    <span>{isAdmin ? 'Administrator' : isSupplier ? 'Verified Supplier' : 'Verified Buyer'}</span>
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {isAdmin
                    ? 'Platform Governance & Operations — Lahore'
                    : isSupplier
                      ? 'Wholesale Commodity Supplier — Lahore'
                      : 'Commercial Food Procurement Partner — Lahore'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="miljor-profile-signout-btn px-4 py-2 rounded-xl text-xs font-semibold border flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Multi-Role Switcher Tabs (For Admin or Dual Access) */}
        {isAdmin && (
          <div className="flex border-b border-[var(--border-subtle)] gap-6 overflow-x-auto" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'buyer_addresses'}
              onClick={() => setActiveTab('buyer_addresses')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'buyer_addresses'
                  ? 'border-[var(--brand-accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Store className="w-3.5 h-3.5 shrink-0" />
              <span>Buyer Delivery Addresses</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'supplier_settings'}
              onClick={() => setActiveTab('supplier_settings')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'supplier_settings'
                  ? 'border-[var(--brand-accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Truck className="w-3.5 h-3.5 shrink-0" />
              <span>Supplier Delivery Settings</span>
            </button>
          </div>
        )}

        {/* Account Details Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div
            className="p-5 sm:p-6 rounded-2xl border space-y-4 transition-all duration-200"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <h3 className="miljor-section-kicker font-sans font-bold text-[11px] uppercase tracking-wider">
              Account &amp; Contact
            </h3>
            <div className="space-y-3.5 text-xs">
              <div className="flex items-center gap-3.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center border shrink-0"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <Mail className="w-4 h-4 text-[var(--brand-accent)]" />
                </div>
                <div className="min-w-0">
                  <span className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>Email Address</span>
                  <span className="font-semibold truncate block" style={{ color: 'var(--text-primary)' }}>
                    {user?.email || 'N/A'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center border shrink-0"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <Phone className="w-4 h-4 text-[var(--brand-accent)]" />
                </div>
                <div>
                  <span className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>SMS Notifications Mobile</span>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {user?.phone || '0300 1234567'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center border shrink-0"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <Building2 className="w-4 h-4 text-[var(--brand-accent)]" />
                </div>
                <div>
                  <span className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>Account Category</span>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {isAdmin ? 'Marketplace Administrator' : isSupplier ? 'Wholesale Commodity Supplier' : 'Restaurant / Commercial Kitchen'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div
            className="p-5 sm:p-6 rounded-2xl border space-y-4 transition-all duration-200"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="miljor-section-kicker font-sans font-bold text-[11px] uppercase tracking-wider">
                {isSupplier ? 'Primary Facility Hub' : 'Primary Operations Hub'}
              </h3>
              {!isSupplier && (
                <button
                  type="button"
                  onClick={() => {
                    setNewClusterId(user?.base_cluster_id ? String(user.base_cluster_id) : '');
                    setEditingCluster(!editingCluster);
                  }}
                  className="text-[11px] font-semibold text-emerald-800 dark:text-champagne hover:opacity-80 flex items-center gap-1 cursor-pointer transition-opacity"
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
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCluster}
                    disabled={savingCluster}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
                    style={{
                      background: 'linear-gradient(135deg, #d7b97d 0%, #b48c4c 100%)',
                      color: '#0d2219',
                    }}
                  >
                    {savingCluster ? 'Saving...' : 'Save Cluster'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5 text-xs">
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center border shrink-0"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <MapPin className="w-4 h-4 text-[var(--brand-accent)]" />
                  </div>
                  <div>
                    <span className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>Operational Cluster</span>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {user?.area || (user?.base_cluster_id ? `Lahore Cluster #${user.base_cluster_id}` : 'Lahore — Not Configured')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center border shrink-0"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <ShieldCheck className="w-4 h-4 text-[var(--brand-accent)]" />
                  </div>
                  <div>
                    <span className="text-[11px] font-medium block" style={{ color: 'var(--text-secondary)' }}>
                      {isAdmin ? 'Access Scope' : isSupplier ? 'Platform Verification' : 'Escrow Protection'}
                    </span>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {isAdmin ? 'Full Lahore Operations' : isSupplier ? 'Authoritative Lahore Supplier' : '100% Safepay Covered'}
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-base sm:text-lg tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  Lahore Delivery Addresses
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Saved Lahore cluster drop zones for fast RFQ and pool checkout.
                </p>
              </div>
              {!showAddressForm && (
                <button
                  type="button"
                  onClick={() => setShowAddressForm(true)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer shadow-xs"
                  style={{
                    background: 'linear-gradient(135deg, #d7b97d 0%, #b48c4c 100%)',
                    color: '#0d2219',
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
                  <div className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading saved addresses...</div>
                ) : addresses.length === 0 ? (
                  <div
                    className="p-6 rounded-2xl border text-center space-y-2"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    <MapPin className="w-6 h-6 mx-auto text-emerald-800 dark:text-champagne" />
                    <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      No delivery address saved yet
                    </p>
                    <p className="text-[11px] max-w-sm mx-auto" style={{ color: 'var(--text-muted)' }}>
                      Add your commercial kitchen, warehouse, or retail shop location to view cluster-based delivery options.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {addresses.map((addr) => (
                      <div
                        key={addr.id}
                        className="p-4 rounded-2xl border space-y-2.5 relative transition-all duration-200 hover:border-[var(--brand-accent)]"
                        style={{
                          backgroundColor: 'var(--bg-card)',
                          borderColor: addr.is_default ? 'var(--brand-accent)' : 'var(--border-subtle)',
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-xs flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                            <MapPin className="w-3.5 h-3.5 text-emerald-800 dark:text-champagne shrink-0" />
                            <span>{addr.society_area}</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            {addr.is_default ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border miljor-badge-verified">
                                Default
                              </span>
                            ) : null}
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                                addr.geographic_match_status === 'VERIFIED'
                                  ? 'miljor-badge-verified'
                                  : 'miljor-badge-provisional'
                              }`}
                            >
                              {addr.geographic_match_status === 'VERIFIED' ? 'Verified' : 'Provisional'}
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
                          <span style={{ color: 'var(--text-muted)' }}>{addr.city}</span>
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
            className="p-4 rounded-2xl border flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--brand-accent)]"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <ClipboardList className="w-5 h-5 text-emerald-800 dark:text-champagne" />
              </div>
              <div>
                <span className="font-semibold text-xs block" style={{ color: 'var(--text-primary)' }}>
                  View Orders & Reservations
                </span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Track batch milestones and delivery fulfillment
                </span>
              </div>
            </div>
          </Link>

          <Link
            to="/pools"
            className="p-4 rounded-2xl border flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--brand-accent)]"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="flex items-center gap-3.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <Layers className="w-5 h-5 text-emerald-800 dark:text-champagne" />
              </div>
              <div>
                <span className="font-semibold text-xs block" style={{ color: 'var(--text-primary)' }}>
                  Explore Wholesale Pools
                </span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
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
