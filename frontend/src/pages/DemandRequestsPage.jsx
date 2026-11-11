import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  Layers,
  Plus,
  Clock,
  MapPin,
  Tag,
  ArrowRight,
  Send,
  Building,
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { toast } from 'react-toastify';

export const DemandRequestsPage = () => {
  const { user, token } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    commodity_name: '',
    category_id: 1, // Rice & Grains
    family_id: 1, // Basmati Rice
    target_quantity: '',
    target_unit: 'kg',
    target_price_per_unit: '',
    notes: ''
  });

  const fetchDemandRequests = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/demand-requests');
      const data = await res.json();
      if (res.ok) {
        setRequests(data.data.demand_requests || []);
      }
    } catch (err) {
      toast.error('Failed to load demand requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDemandRequests();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      toast.info('Please log in to request a collective pool');
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch('/api/v1/demand-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to submit demand request');
      }
      toast.success('Your pool request has been published for supplier fulfillment!');
      setShowModal(false);
      setFormData({
        commodity_name: '',
        category_id: 1,
        family_id: 1,
        target_quantity: '',
        target_unit: 'kg',
        target_price_per_unit: '',
        notes: ''
      });
      fetchDemandRequests();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)] block mb-1">
              Buyer Demand Aggregation
            </span>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--text-primary)]">
              Buyer-Initiated Pools ("Request a Pool")
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Can't find your required grade or volume? Submit a demand request to rally neighboring Lahore businesses
              and trigger supplier fulfillment.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-sm font-semibold hover:opacity-95 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Request a Pool
          </button>
        </div>

        {/* Requests List */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-accent)]" />
          </div>
        ) : requests.length === 0 ? (
          <div className="p-12 text-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] max-w-2xl mx-auto">
            <Layers className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-40" />
            <h3 className="text-lg font-serif font-bold text-[var(--text-primary)] mb-1">
              No Open Pool Requests
            </h3>
            <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto mb-6">
              Be the first buyer to initiate a collective demand pool for your restaurant or cafe.
            </p>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="px-4 py-2 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-95 cursor-pointer"
            >
              Submit First Request
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {requests.map((r) => (
              <div
                key={r.id}
                className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-card)] text-[var(--text-muted)]">
                      {r.request_code}
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600">
                      {r.status}
                    </span>
                  </div>

                  <h3 className="text-lg font-serif font-bold text-[var(--text-primary)] mb-1">
                    {r.commodity_name}
                  </h3>
                  <div className="text-xs text-[var(--text-muted)] mb-4">
                    Category: {r.category_name} ({r.family_name})
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[var(--bg-card)] space-y-2 mb-4">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Target Volume:</span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {Number(r.target_quantity).toLocaleString()} {r.target_unit}
                      </span>
                    </div>
                    {r.target_price_per_unit && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--text-muted)]">Target Price:</span>
                        <span className="font-semibold text-emerald-600">
                          Rs. {Number(r.target_price_per_unit).toLocaleString()} / {r.target_unit}
                        </span>
                      </div>
                    )}
                    {r.cluster_name && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--text-muted)]">Cluster Hub:</span>
                        <span className="font-medium text-[var(--text-primary)] flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-[var(--brand-accent)]" /> {r.cluster_name}
                        </span>
                      </div>
                    )}
                  </div>

                  {r.notes && (
                    <p className="text-xs text-[var(--text-muted)] italic mb-4">
                      "{r.notes}"
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                  <span className="text-[var(--text-muted)]">
                    By {r.buyer_business_name || 'Verified Buyer'}
                  </span>
                  <Link
                    to="/pools"
                    className="text-[var(--brand-accent)] font-semibold hover:underline inline-flex items-center gap-1"
                  >
                    View Matching Pools <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal: Create Request */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative">
              <h2 className="text-xl font-serif font-bold text-[var(--text-primary)] mb-1">
                Request a Collective Pool
              </h2>
              <p className="text-xs text-[var(--text-muted)] mb-6">
                Tell us what commodity your business needs. Verified suppliers will be notified to open a group pool.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Commodity Title
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Super Kernel Basmati Rice 25kg"
                    value={formData.commodity_name}
                    onChange={(e) => setFormData({ ...formData, commodity_name: e.target.value })}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                      Target Quantity
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="e.g. 50"
                      value={formData.target_quantity}
                      onChange={(e) => setFormData({ ...formData, target_quantity: e.target.value })}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                      Unit
                    </label>
                    <select
                      value={formData.target_unit}
                      onChange={(e) => setFormData({ ...formData, target_unit: e.target.value })}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                    >
                      <option value="kg">Kilogram (kg)</option>
                      <option value="bag">Bag</option>
                      <option value="tin">Tin (16L)</option>
                      <option value="carton">Carton</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Target Unit Price (PKR, Optional)
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 340"
                    value={formData.target_price_per_unit}
                    onChange={(e) => setFormData({ ...formData, target_price_per_unit: e.target.value })}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Quality / Specification Notes
                  </label>
                  <textarea
                    rows="2"
                    placeholder="e.g. Max 2% broken grains, required by next Thursday"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-card)] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-95 cursor-pointer shadow-xs"
                  >
                    {submitting ? 'Publishing...' : 'Publish Request'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};
