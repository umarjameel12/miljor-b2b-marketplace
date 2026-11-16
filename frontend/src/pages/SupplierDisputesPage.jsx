// =============================================================================
// src/pages/SupplierDisputesPage.jsx
// MilJor Master Supplier Operations Center — Disputes & Quality Exceptions
// Direct Integration with /api/v1/disputes/supplier/list & Supplier Response Workflow
// =============================================================================
import React, { useState, useEffect, useCallback } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../context/AuthContext';
import {
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Clock,
  MessageSquare,
  ArrowRight,
  RefreshCw,
  X,
  Send,
  FileText,
  Info
} from 'lucide-react';
import { toast } from 'react-toastify';

export const SupplierDisputesPage = () => {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [disputes, setDisputes] = useState([]);
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [submittingResponse, setSubmittingResponse] = useState(false);

  // Form state for responding to dispute
  const [remediationProposal, setRemediationProposal] = useState('DELIVER_MISSING_QUANTITY');
  const [responseText, setResponseText] = useState('');
  const [remediationDetails, setRemediationDetails] = useState('');

  const fetchDisputes = useCallback(async (isRefresh = false) => {
    if (!token) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const res = await fetch('/api/v1/disputes/supplier/list', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const json = await res.json();
        setDisputes(json.data?.disputes || json.data || []);
      }
    } catch (err) {
      console.error('Error loading supplier disputes:', err);
      toast.error('Could not load disputes inbox');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const handleOpenResponse = (dispute) => {
    setSelectedDispute(dispute);
    setRemediationProposal('DELIVER_MISSING_QUANTITY');
    setResponseText('');
    setRemediationDetails('');
    setResponseModalOpen(true);
  };

  const handleSubmitResponse = async (e) => {
    e.preventDefault();
    if (!selectedDispute) return;
    if (!responseText.trim()) {
      toast.error('Please enter your response explanation');
      return;
    }

    try {
      setSubmittingResponse(true);
      const idempotencyKey = `disp_resp_${selectedDispute.id}_${Date.now()}`;
      const res = await fetch(`/api/v1/disputes/${selectedDispute.id}/supplier-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          remediation_proposal: remediationProposal,
          response_text: responseText.trim(),
          remediation_details: remediationDetails.trim() || undefined
        })
      });

      const json = await res.json();
      if (res.ok) {
        toast.success('Dispute response and remediation submitted successfully');
        setResponseModalOpen(false);
        fetchDisputes(true);
      } else {
        toast.error(json.error?.message || 'Failed to submit response');
      }
    } catch (err) {
      console.error('Error submitting dispute response:', err);
      toast.error('Network error submitting response');
    } finally {
      setSubmittingResponse(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)]">
                Quality & Order Assurance
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" /> Discrepancy & Shortage Hub
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--text-primary)]">
              Disputes & Discrepancies
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
              Review and remediate buyer shortage reports, damaged item claims, or quality questions with transparent resolution.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => fetchDisputes(true)}
              disabled={refreshing || loading}
              className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
              title="Refresh disputes"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[var(--brand-accent)]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Disputes List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Assigned Buyer Claims
            </h2>
            <span className="text-xs text-[var(--text-muted)]">
              {disputes.length} active case{disputes.length === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)]">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[var(--brand-accent)]" />
              Loading dispute records...
            </div>
          ) : disputes.length === 0 ? (
            <div className="p-8 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
              <h3 className="text-base font-bold text-[var(--text-primary)]">Zero Active Disputes</h3>
              <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
                No delivery shortages, damages, or discrepancies currently reported against your orders. Keep up the high fulfillment standard!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {disputes.map((disp) => {
                const canRespond = ['OPEN', 'AWAITING_SUPPLIER_RESPONSE'].includes(disp.status);
                return (
                  <div
                    key={disp.id}
                    className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs flex flex-col justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-mono text-xs font-bold text-[var(--text-primary)]">
                          {disp.dispute_code || `#DISP-${disp.id}`}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          canRespond ? 'bg-amber-500/15 text-amber-600' : 'bg-blue-500/15 text-blue-600'
                        }`}>
                          {disp.status}
                        </span>
                      </div>

                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        Reason: {disp.reason || disp.dispute_category || 'Delivery Discrepancy'}
                      </div>

                      <p className="text-xs text-[var(--text-muted)] mt-1.5 line-clamp-3">
                        {disp.description || 'No detailed description provided by claimant.'}
                      </p>

                      <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                        <div>
                          <span className="text-[11px] text-[var(--text-muted)] block">Disputed Quantity</span>
                          <span className="font-bold text-[var(--text-primary)]">{disp.disputed_quantity || '—'} units</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-[var(--text-muted)] block">Claimed Value</span>
                          <span className="font-bold text-[var(--text-primary)]">Rs. {Number(disp.claimed_amount || 0).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        Order #{disp.order_id}
                      </span>
                      {canRespond ? (
                        <button
                          type="button"
                          onClick={() => handleOpenResponse(disp)}
                          className="px-3 py-1.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-90 transition-opacity"
                        >
                          Respond & Remediate
                        </button>
                      ) : (
                        <span className="text-xs font-medium text-[var(--brand-accent)]">
                          Response Submitted
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Dispute Response Modal */}
        {responseModalOpen && selectedDispute && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    Respond to Dispute {selectedDispute.dispute_code}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Propose an authorized remediation plan to release the escrow hold.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setResponseModalOpen(false)}
                  className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmitResponse} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Remediation Proposal
                  </label>
                  <select
                    value={remediationProposal}
                    onChange={(e) => setRemediationProposal(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border bg-[var(--bg-card)] text-[var(--text-primary)]"
                    style={{ borderColor: 'var(--border-default)' }}
                  >
                    <option value="DELIVER_MISSING_QUANTITY">Deliver Missing Quantity (Dispatch Shortage)</option>
                    <option value="REPLACE_DAMAGED_GOODS">Replace Damaged Goods (Dispatch Fresh Units)</option>
                    <option value="EXPLANATION_CONTEST">Contest Claim (Provide Delivery Proof)</option>
                    <option value="ESCALATE_FOR_ADMIN_REVIEW">Escalate for Platform Admin Review</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Supplier Explanation / Response *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Provide details of your finding and steps taken..."
                    className="w-full text-xs p-2.5 rounded-xl border bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none"
                    style={{ borderColor: 'var(--border-default)' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Remediation Notes / Dispatch ETA
                  </label>
                  <input
                    type="text"
                    value={remediationDetails}
                    onChange={(e) => setRemediationDetails(e.target.value)}
                    placeholder="e.g. Dispatched rider via Lahore Express, ETA 2:00 PM"
                    className="w-full text-xs p-2.5 rounded-xl border bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none"
                    style={{ borderColor: 'var(--border-default)' }}
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <button
                    type="button"
                    onClick={() => setResponseModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-[var(--border-default)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingResponse}
                    className="px-4 py-2 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-90 inline-flex items-center gap-1.5"
                  >
                    {submittingResponse ? 'Submitting...' : 'Submit Resolution'}
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

export default SupplierDisputesPage;
