import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import {
  FileText,
  Plus,
  Send,
  CheckCircle,
  Clock,
  Building,
  DollarSign,
  Truck,
  ArrowRight,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';
import { toast } from 'react-toastify';

export const RfqPage = () => {
  const { user, token } = useAuth();
  const [activeTab, setActiveTab] = useState(user?.role === 'SUPPLIER' ? 'supplier' : 'buyer');
  const [rfqs, setRfqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [selectedRfq, setSelectedRfq] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // B6: Buyer-first multi-item shopping list, stored in the existing RFQ page.
  const emptyItem = () => ({ family_id: '', quantity: '', unit: 'kg', requirements: '' });
  const [shoppingList, setShoppingList] = useState([emptyItem()]);
  const [deliveryArea, setDeliveryArea] = useState('');
  const [quoteDeadline, setQuoteDeadline] = useState('');
  const [familyChoices, setFamilyChoices] = useState([]);
  const [savedRequests, setSavedRequests] = useState([]);
  const [activeRequest, setActiveRequest] = useState(null);
  const [shoppingBusy, setShoppingBusy] = useState(false);
  const [shoppingError, setShoppingError] = useState('');

  const availableUnits = familyId => {
    const family = familyChoices.find(choice => String(choice.id) === String(familyId));
    if (!family) return ['kg','g','l','ml','bag','tin','carton','sack','pack'];
    const listed = [...(family.allowed_pack_units || []), ...(family.allowed_purchasing_units || [])]
      .filter(x => typeof x === 'string').map(x => x.toLowerCase().trim());
    return [...new Set(listed)].filter(x => ['kg','g','l','ml','bag','tin','carton','sack','pack'].includes(x));
  };
  const newRequestKey = () => `buyer-${Date.now()}-${Math.random().toString(36).slice(2, 13)}`;
  const toLocalInput = value => {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  useEffect(() => {
    if (!token || user?.role !== 'BUYER') return;
    let alive = true;
    const refresh = async () => {
      try {
        const [catalogResponse, requestResponse] = await Promise.all([
          fetch('/api/v1/catalog/families'),
          fetch('/api/v1/procurement/requests', { headers: {Authorization: `Bearer ${token}`} })
        ]);
        const catalog = await catalogResponse.json();
        const requests = await requestResponse.json();
        if (!catalogResponse.ok || !requestResponse.ok) throw Error('Shopping list could not be loaded');
        if (alive) {
          setFamilyChoices((catalog.data?.families || []).filter(x => x.is_active && x.approval_status === 'APPROVED'));
          setSavedRequests(requests.data?.requests || []);
        }
      } catch (error) {
        if (alive) setShoppingError(error.message);
      }
    };
    refresh();
    return () => { alive = false; };
  }, [token, user?.role]);

  const refreshRequests = async () => {
    const response = await fetch('/api/v1/procurement/requests', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await response.json();
    if (!response.ok) throw Error(body.error?.message || 'Could not refresh requests');
    setSavedRequests(body.data?.requests || []);
  };

  const loadShoppingDraft = async requestId => {
    setShoppingBusy(true);
    setShoppingError('');
    try {
      const response = await fetch(`/api/v1/procurement/requests/${requestId}`, {
        headers: {Authorization: `Bearer ${token}`}
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message || 'Could not open request');
      const request = body.data.request;
      if (request.status !== 'DRAFT') throw Error('Published requests cannot be edited');
      setActiveRequest(request);
      setShoppingList(request.items.map(item => ({
        family_id: String(item.family_id), quantity: String(item.quantity),
        unit: item.unit, requirements: item.requirements || ''
      })));
      setDeliveryArea(request.delivery_area || '');
      setQuoteDeadline(toLocalInput(request.quote_deadline));
    } catch (error) {
      setShoppingError(error.message);
    } finally { setShoppingBusy(false); }
  };

  const submitShoppingList = async publish => {
    if (!token) return;
    setShoppingError('');
    setShoppingBusy(true);
    try {
      if (publish && !quoteDeadline) throw Error('Please choose a quotation closing time.');
      const payload = {
        ownership: 'SINGLE_BUYER', frequency: 'ONE_TIME',
        award_policy: 'SPLIT_ALLOWED', priority: 'BEST_VALUE',
        delivery_area: deliveryArea,
        quote_deadline: quoteDeadline ? new Date(quoteDeadline).toISOString() : null,
        items: shoppingList.map(item => ({
          family_id: Number(item.family_id),
          quantity: item.quantity,
          unit: item.unit,
          requirements: item.requirements,
          allow_substitutions: false
        }))
      };
      const editing = Boolean(activeRequest);
      const url = editing
        ? `/api/v1/procurement/requests/${activeRequest.id}`
        : '/api/v1/procurement/requests';
      const response = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': newRequestKey()
        },
        body: JSON.stringify(editing ? {...payload, version_number: activeRequest.version_number} : payload)
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message || 'Could not save shopping list');
      let saved = body.data.request;
      if (publish) {
        const published = await fetch(`/api/v1/procurement/requests/${saved.id}/publish`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': newRequestKey()
          },
          body: JSON.stringify({version_number: saved.version_number})
        });
        const result = await published.json();
        if (!published.ok) {
          setActiveRequest(saved);
          throw Error(result.error?.message || 'Saved as draft; publication failed');
        }
        saved = result.data.request;
      }
      setActiveRequest(publish ? null : saved);
      if (publish) {
        setShoppingList([emptyItem()]);
        setDeliveryArea('');
        setQuoteDeadline('');
      }
      await refreshRequests();
      toast.success(publish ? 'Shopping list published for supplier quotations' : 'Shopping list draft saved');
    } catch (error) {
      setShoppingError(error.message);
    } finally { setShoppingBusy(false); }
  };

  // Buyer RFQ Form
  const [rfqForm, setRfqForm] = useState({
    product_name: '',
    required_specifications: '',
    quantity: '',
    unit: 'kg',
    delivery_address: '',
    target_price: ''
  });

  // Supplier Quote Form
  const [quoteForm, setQuoteForm] = useState({
    unit_price: '',
    quantity: '',
    delivery_fee: 0,
    supplier_notes: ''
  });

  const fetchRfqs = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/rfqs', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (res.ok) {
        setRfqs(data.data?.rfqs || []);
      }
    } catch (err) {
      toast.error('Failed to load RFQs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRfqs();
  }, [token]);

  const handleCreateRfq = async (e) => {
    e.preventDefault();
    if (!token) return toast.info('Please log in');
    try {
      setSubmitting(true);
      const res = await fetch('/api/v1/rfqs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(rfqForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'RFQ creation failed');
      toast.success('RFQ published! Suppliers have been notified.');
      setShowCreateModal(false);
      setRfqForm({
        product_name: '',
        required_specifications: '',
        quantity: '',
        unit: 'kg',
        delivery_address: '',
        target_price: ''
      });
      fetchRfqs();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitQuote = async (e) => {
    e.preventDefault();
    if (!token) return toast.info('Please log in');
    if (!selectedRfq) return;
    try {
      setSubmitting(true);
      const res = await fetch(`/api/v1/rfqs/${selectedRfq.id}/quotes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(quoteForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Quote submission failed');
      toast.success('Your quote was submitted to the buyer!');
      setShowQuoteModal(false);
      fetchRfqs();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptQuote = async (rfqId, quoteId) => {
    if (!confirm('Accept this quote and generate an order in Awaiting Payment?')) return;
    try {
      const res = await fetch(`/api/v1/rfqs/${rfqId}/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to accept quote');
      toast.success('Quote accepted! Order created successfully.');
      fetchRfqs();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <span className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-accent)] block mb-1">
              Custom Procurement Desk
            </span>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--text-primary)]">
              Requests for Quotation (RFQs)
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Direct B2B negotiation for customized specifications, non-standard quantities, and contract terms.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-sm font-semibold hover:opacity-95 shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create RFQ
            </button>
          </div>
        </div>

        {user?.role === 'BUYER' && (
          <section className="mb-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-4" aria-label="Get Best Quotes">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-accent)]">Smart Procurement Hub</p>
              <h2 className="text-xl font-serif font-bold text-[var(--text-primary)]">Get Best Quotes — Your Shopping List</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Add everything your business needs in one request. Start with one-time purchasing; collective and recurring modes will be available after their approval gates.</p>
            </div>
            {shoppingError && <p role="alert" className="text-sm text-red-600">{shoppingError}</p>}
            <div className="space-y-3">
              {shoppingList.map((item, index) => (
                <div key={index} className="rounded-xl border border-[var(--border-subtle)] p-3 grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <label className="sm:col-span-4 text-xs font-semibold">Product family
                    <select required value={item.family_id} onChange={e => setShoppingList(old => old.map((row,i)=>i===index?{...row,family_id:e.target.value,unit:availableUnits(e.target.value)[0]||'kg'}:row))}
                      className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm">
                      <option value="">Choose product</option>
                      {familyChoices.map(family => <option key={family.id} value={family.id}>{family.name}</option>)}
                    </select>
                  </label>
                  <label className="sm:col-span-2 text-xs font-semibold">Quantity
                    <input type="number" min="0.0001" step="any" value={item.quantity}
                      onChange={e=>setShoppingList(old=>old.map((row,i)=>i===index?{...row,quantity:e.target.value}:row))}
                      className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm"/>
                  </label>
                  <label className="sm:col-span-2 text-xs font-semibold">Unit
                    <select value={item.unit} onChange={e=>setShoppingList(old=>old.map((row,i)=>i===index?{...row,unit:e.target.value}:row))}
                      className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm">
                      {availableUnits(item.family_id).map(unit=><option key={unit} value={unit}>{unit}</option>)}
                    </select>
                  </label>
                  <label className="sm:col-span-3 text-xs font-semibold">Quality / packaging (optional)
                    <input value={item.requirements} maxLength={2000} placeholder="e.g. Premium Sella 25kg"
                      onChange={e=>setShoppingList(old=>old.map((row,i)=>i===index?{...row,requirements:e.target.value}:row))}
                      className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm"/>
                  </label>
                  <div className="sm:col-span-1 flex items-end">
                    <button type="button" disabled={shoppingList.length===1||shoppingBusy}
                      onClick={()=>setShoppingList(old=>old.filter((_,i)=>i!==index))}
                      className="rounded-lg border p-2 text-xs disabled:opacity-40" aria-label={`Remove item ${index+1}`}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" disabled={shoppingBusy||shoppingList.length>=50}
              onClick={()=>setShoppingList(old=>[...old,emptyItem()])}
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--brand-accent)] disabled:opacity-40">
              <Plus size={15}/> Add another product
            </button>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-semibold">Your delivery area
                <input value={deliveryArea} maxLength={255} placeholder="e.g. Johar Town, Lahore"
                  onChange={e=>setDeliveryArea(e.target.value)}
                  className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm"/>
              </label>
              <label className="text-xs font-semibold">Quotation closing time (Pakistan local time)
                <input type="datetime-local" value={quoteDeadline} onChange={e=>setQuoteDeadline(e.target.value)}
                  className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm"/>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={shoppingBusy}
                onClick={()=>submitShoppingList(false)}
                className="rounded-xl px-4 py-2 border border-[var(--border-subtle)] text-sm font-semibold disabled:opacity-50">
                {shoppingBusy?'Saving...':'Save Draft'}
              </button>
              <button type="button" disabled={shoppingBusy||!quoteDeadline}
                onClick={()=>submitShoppingList(true)}
                className="rounded-xl px-4 py-2 bg-[var(--brand-accent)] text-stone-900 text-sm font-semibold disabled:opacity-50">
                Publish Shopping List
              </button>
              {activeRequest && <button type="button" disabled={shoppingBusy}
                onClick={()=>{setActiveRequest(null);setShoppingList([emptyItem()]);setDeliveryArea('');setQuoteDeadline('');setShoppingError('');}}
                className="text-sm px-3 py-2 underline">Start New</button>}
            </div>
            <p className="text-xs text-[var(--text-muted)]">No payment or stock reservation happens when you publish. Supplier bidding and quote comparison will activate in the next verified implementation stage.</p>
            {savedRequests.length>0 && (
              <div className="border-t border-[var(--border-subtle)] pt-3">
                <p className="text-sm font-semibold mb-2">My Shopping Requests</p>
                <div className="space-y-2">
                  {savedRequests.map(request=>(
                    <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{request.request_code} · {request.status} · {request.delivery_area}</span>
                      {request.status==='DRAFT' &&
                        <button type="button" disabled={shoppingBusy} onClick={()=>loadShoppingDraft(request.id)}
                          className="text-[var(--brand-accent)] underline text-xs">Edit Draft</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Tab Controls */}
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] mb-8">
          <button
            type="button"
            onClick={() => setActiveTab('buyer')}
            className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'buyer'
                ? 'border-[var(--brand-accent)] text-[var(--brand-accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Buyer Requests
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('supplier')}
            className={`pb-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'supplier'
                ? 'border-[var(--brand-accent)] text-[var(--brand-accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Supplier Bidding Desk
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-accent)]" />
          </div>
        ) : rfqs.length === 0 ? (
          <div className="p-12 text-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] max-w-2xl mx-auto">
            <FileText className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-40" />
            <h3 className="text-lg font-serif font-bold text-[var(--text-primary)] mb-1">
              No Open RFQs
            </h3>
            <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto mb-6">
              Buyers can publish custom RFQs to invite direct competitive quotes from verified Lahore suppliers.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-95 cursor-pointer"
            >
              Post First RFQ
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rfqs.map((r) => (
              <div
                key={r.id}
                className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-card)] text-[var(--text-muted)]">
                      {r.rfq_code}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        r.status === 'ACCEPTED'
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-blue-500/10 text-blue-600'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>

                  <h3 className="text-lg font-serif font-bold text-[var(--text-primary)] mb-1">
                    {r.product_name}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mb-4">
                    Specs: {r.required_specifications || 'Standard Grade'}
                  </p>

                  <div className="p-3.5 rounded-2xl bg-[var(--bg-card)] space-y-2 mb-4">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Quantity:</span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {Number(r.quantity).toLocaleString()} {r.unit}
                      </span>
                    </div>
                    {r.target_price && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--text-muted)]">Target Price:</span>
                        <span className="font-semibold text-emerald-600">
                          Rs. {Number(r.target_price).toLocaleString()} / {r.unit}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Destination:</span>
                      <span className="font-medium text-[var(--text-primary)] truncate max-w-[150px]">
                        {r.delivery_address || 'Lahore'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  {user?.role === 'SUPPLIER' && r.status === 'OPEN' && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRfq(r);
                        setQuoteForm({
                          unit_price: r.target_price || '',
                          quantity: r.quantity,
                          delivery_fee: 500,
                          supplier_notes: ''
                        });
                        setShowQuoteModal(true);
                      }}
                      className="w-full py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-95 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      Submit Quotation <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create RFQ Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative">
              <h2 className="text-xl font-serif font-bold text-[var(--text-primary)] mb-1">
                Create Request for Quotation
              </h2>
              <p className="text-xs text-[var(--text-muted)] mb-6">
                Broadcast your procurement requirements to verified suppliers for custom volume bids.
              </p>

              <form onSubmit={handleCreateRfq} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Commodity / Product Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Canola Oil 16L Tin"
                    value={rfqForm.product_name}
                    onChange={(e) => setRfqForm({ ...rfqForm, product_name: e.target.value })}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                      Required Quantity
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="e.g. 50"
                      value={rfqForm.quantity}
                      onChange={(e) => setRfqForm({ ...rfqForm, quantity: e.target.value })}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                      Unit
                    </label>
                    <select
                      value={rfqForm.unit}
                      onChange={(e) => setRfqForm({ ...rfqForm, unit: e.target.value })}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                    >
                      <option value="kg">Kilogram (kg)</option>
                      <option value="tin">Tin (16L)</option>
                      <option value="bag">Bag (50kg)</option>
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
                    placeholder="e.g. 6200"
                    value={rfqForm.target_price}
                    onChange={(e) => setRfqForm({ ...rfqForm, target_price: e.target.value })}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Delivery Address in Lahore
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Shop 4, MM Alam Road, Gulberg III, Lahore"
                    value={rfqForm.delivery_address}
                    onChange={(e) => setRfqForm({ ...rfqForm, delivery_address: e.target.value })}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Required Quality Specifications
                  </label>
                  <textarea
                    rows="2"
                    placeholder="e.g. Refined, fresh batch 2026, food safety compliance certificate required"
                    value={rfqForm.required_specifications}
                    onChange={(e) => setRfqForm({ ...rfqForm, required_specifications: e.target.value })}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-card)] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-95 cursor-pointer shadow-xs"
                  >
                    {submitting ? 'Publishing...' : 'Publish RFQ'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Submit Quote Modal */}
        {showQuoteModal && selectedRfq && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative">
              <h2 className="text-xl font-serif font-bold text-[var(--text-primary)] mb-1">
                Submit Supplier Quotation
              </h2>
              <p className="text-xs text-[var(--text-muted)] mb-6">
                Bidding on: <strong className="text-[var(--text-primary)]">{selectedRfq.product_name}</strong> ({selectedRfq.quantity} {selectedRfq.unit})
              </p>

              <form onSubmit={handleSubmitQuote} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                      Offered Unit Price (PKR)
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="e.g. 6350"
                      value={quoteForm.unit_price}
                      onChange={(e) => setQuoteForm({ ...quoteForm, unit_price: e.target.value })}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                      Delivery Fee (PKR)
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 500"
                      value={quoteForm.delivery_fee}
                      onChange={(e) => setQuoteForm({ ...quoteForm, delivery_fee: e.target.value })}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                    Fulfillment & Delivery Notes
                  </label>
                  <textarea
                    rows="2"
                    placeholder="e.g. Dispatch from Gulberg depot within 24 hours of confirmation"
                    value={quoteForm.supplier_notes}
                    onChange={(e) => setQuoteForm({ ...quoteForm, supplier_notes: e.target.value })}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-accent)]"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setShowQuoteModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-card)] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-xs font-bold hover:opacity-95 cursor-pointer shadow-xs"
                  >
                    {submitting ? 'Submitting...' : 'Submit Quote'}
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
