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
  const [buyerMode,setBuyerMode] = useState('SINGLE_BUYER');
  const [purchaseCadence,setPurchaseCadence] = useState('ONE_TIME');
  const [joinDeadline,setJoinDeadline] = useState('');
  const [minimumBuyers,setMinimumBuyers] = useState(2);
  const [collectiveGroup,setCollectiveGroup] = useState(null);
  const [myCollectiveInvites,setMyCollectiveInvites] = useState([]);
  const [inviteBuyerId,setInviteBuyerId] = useState('');
  const [joinQuantities,setJoinQuantities] = useState({});
  const [recurringContracts,setRecurringContracts] = useState([]);
  const [recurringCadenceDay,setRecurringCadenceDay] = useState(1);
  const [recurringTime,setRecurringTime] = useState('09:00');
  const [recurringStart,setRecurringStart] = useState('');
  const [recurringEnd,setRecurringEnd] = useState('');
  const [recurringUpcoming,setRecurringUpcoming] = useState(null);
  const [reviewedAwardLines,setReviewedAwardLines] = useState({});
  const [awardPreview,setAwardPreview] = useState(null);
  const [familyChoices, setFamilyChoices] = useState([]);
  const [savedRequests, setSavedRequests] = useState([]);
  const [activeRequest, setActiveRequest] = useState(null);
  const [shoppingBusy, setShoppingBusy] = useState(false);
  const [shoppingError, setShoppingError] = useState('');
  const [selectedMatchRequest, setSelectedMatchRequest] = useState(null);
  const [supplierMatches, setSupplierMatches] = useState([]);
  const [supplierInvitations, setSupplierInvitations] = useState([]);
  const [supplierInbox, setSupplierInbox] = useState([]);
  const [matchingBusy, setMatchingBusy] = useState(false);
  const [selectedQuotesRequest,setSelectedQuotesRequest] = useState(null);
  const [buyerQuotes,setBuyerQuotes] = useState([]);
  const [supplierQuoteDrafts,setSupplierQuoteDrafts] = useState({});
  const [quoteBusy,setQuoteBusy] = useState(false);
  const [mySmartQuotes,setMySmartQuotes] = useState([]);
  const [quoteHistory,setQuoteHistory] = useState(null);
  const [quoteComparison,setQuoteComparison]=useState(null);
  const [compareRequestId,setCompareRequestId]=useState(null);
  const [improvementNotes,setImprovementNotes]=useState({});
  const [improvementTargets,setImprovementTargets]=useState({});
  const [buyerNegotiations,setBuyerNegotiations]=useState([]);
  const [supplierNegotiations,setSupplierNegotiations]=useState([]);



  const availableUnits = familyId => {
    const family = familyChoices.find(choice => String(choice.id) === String(familyId));
    if (!family) return ['kg','g','l','ml','bag','tin','carton','sack','pack'];
    const listed = [...(family.allowed_pack_units || []), ...(family.allowed_purchasing_units || [])]
      .filter(x => typeof x === 'string').map(x => x.toLowerCase().trim());
    return [...new Set(listed)].filter(x => ['kg','g','l','ml','bag','tin','carton','sack','pack'].includes(x));
  };
  const newRequestKey = () => `buyer-${crypto.randomUUID()}`;
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
      setBuyerMode(request.ownership||'SINGLE_BUYER');
      setPurchaseCadence(request.frequency||'ONE_TIME');
      setJoinDeadline(toLocalInput(request.join_deadline));
    } catch (error) {
      setShoppingError(error.message);
    } finally { setShoppingBusy(false); }
  };

  const submitShoppingList = async publish => {
    if (!token) return;
    setShoppingError('');
    setShoppingBusy(true);
    try {
      if (publish && (buyerMode!=='SINGLE_BUYER'||purchaseCadence!=='ONE_TIME'))
        throw Error('Group and recurring requests use their dedicated consent setup, not one-time publishing.');
      if (publish && !quoteDeadline) throw Error('Please choose a quotation closing time.');
      const payload = {
        ownership: buyerMode, frequency: purchaseCadence,
        award_policy: 'SPLIT_ALLOWED', priority: 'BEST_VALUE',
        delivery_area: deliveryArea,
        quote_deadline: quoteDeadline ? new Date(quoteDeadline).toISOString() : null,
        join_deadline: buyerMode==='COLLECTIVE' && joinDeadline
          ? new Date(joinDeadline).toISOString() : null,
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
      toast.success(publish ? 'Shopping list published. Supplier quotations are the next rollout stage.' : 'Shopping list draft saved');
    } catch (error) {
      setShoppingError(error.message);
    } finally { setShoppingBusy(false); }
  };

  // B6-D invitation workflow: no buyer contact/address is returned to suppliers.
  const procurementApi = async (url, options={}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(body.error?.message || 'Supplier request failed');
    return body.data || {};
  };

  const viewSupplierMatches = async requestId => {
    setMatchingBusy(true);
    setShoppingError('');
    try {
      const [matches, invitations] = await Promise.all([
        procurementApi(`/api/v1/procurement/requests/${requestId}/matches`),
        procurementApi(`/api/v1/procurement/requests/${requestId}/invitations`)
      ]);
      setSelectedMatchRequest(requestId);
      setSupplierMatches(matches.matches || []);
      setSupplierInvitations(invitations.invitations || []);
    } catch(err) {setShoppingError(err.message);}
    finally {setMatchingBusy(false);}
  };

  const inviteSupplier = async supplierId => {
    if (!selectedMatchRequest) return;
    setMatchingBusy(true);
    setShoppingError('');
    try {
      await procurementApi(`/api/v1/procurement/requests/${selectedMatchRequest}/invitations`, {
        method:'POST',body:JSON.stringify({supplier_id:supplierId})
      });
      const result = await procurementApi(`/api/v1/procurement/requests/${selectedMatchRequest}/invitations`);
      setSupplierInvitations(result.invitations || []);
      toast.success('Invitation sent to eligible supplier');
    } catch(err){setShoppingError(err.message);}
    finally{setMatchingBusy(false);}
  };

  const refreshSupplierInbox = async () => {
    if(!token || user?.role!=='SUPPLIER')return;
    try{
      const result=await procurementApi('/api/v1/procurement/supplier/invitations');
      setSupplierInbox(result.invitations || []);
    }catch(err){toast.error(err.message);}
  };

  useEffect(()=>{
    if(token && user?.role==='SUPPLIER')refreshSupplierInbox();
  },[token,user?.role]);

  const respondInvitation = async (invitationId, decision) => {
    setMatchingBusy(true);
    try{
      await procurementApi(`/api/v1/procurement/supplier/invitations/${invitationId}/respond`,{
        method:'POST',body:JSON.stringify({decision})
      });
      await refreshSupplierInbox();
      toast.success(decision==='INTERESTED'?'Interest registered':'Invitation declined');
    }catch(err){toast.error(err.message);}
    finally{setMatchingBusy(false);}
  };

  const refreshMySmartQuotes = async () => {
    if (!token || user?.role!=='SUPPLIER') return;
    const response=await procurementApi('/api/v1/procurement/supplier/quotes');
    setMySmartQuotes(response.quotes||[]);
  };

  const withdrawSmartQuote = async quoteId => {
    setQuoteBusy(true);
    try{
      await procurementApi(`/api/v1/procurement/supplier/quotes/${quoteId}/withdraw`,{
        method:'POST',headers:{'X-Idempotency-Key':newRequestKey()},
        body:JSON.stringify({})
      });
      await refreshMySmartQuotes();
      await refreshSupplierNegotiations();
      toast.success('Quotation withdrawn; historical versions retained');
    }catch(error){toast.error(error.message);}
    finally{setQuoteBusy(false);}
  };

  const viewQuoteHistory = async (requestId,quoteId) => {
    setQuoteBusy(true);
    try{
      const data=await procurementApi(`/api/v1/procurement/requests/${requestId}/quotes/${quoteId}/versions`);
      setQuoteHistory(data);
    }catch(error){setShoppingError(error.message);}
    finally{setQuoteBusy(false);}
  };

  const viewBuyerQuotes = async requestId => {
    setQuoteBusy(true);
    setShoppingError('');
    try {
      const data=await procurementApi(`/api/v1/procurement/requests/${requestId}/quotes`);
      setSelectedQuotesRequest(requestId);
      setBuyerQuotes(data.quotes || []);
    }catch(error){setShoppingError(error.message);}
    finally{setQuoteBusy(false);}
  };

  // B6-G/H: explicit physical SKU consent and server-side read-only preview.
  const previewSmartAward = async option => {
    if(!compareRequestId)return;
    setQuoteBusy(true);setShoppingError('');
    try{
      const selections=(option.lines||[]).map(line=>{
        const version=buyerQuotes.find(q=>Number(q.id)===Number(line.quote_id))?.current_version;
        const snapshot=line.supplier_sku_snapshot||{};
        const key=`${line.quote_id}:${line.request_item_id}:${version}`;
        if(!reviewedAwardLines[key])throw Error('Review and accept every selected physical SKU and packaging first.');
        return {
          request_item_id:Number(line.request_item_id),quote_id:Number(line.quote_id),
          version_number:Number(version),supplier_sku_id:Number(snapshot.supplier_sku_id),
          product_spec_id:Number(snapshot.product_spec_id),
          physical_specifications_accepted:true
        };
      });
      const data=await procurementApi(`/api/v1/procurement/requests/${compareRequestId}/checkout-preview`,{
        method:'POST',body:JSON.stringify({selections})
      });
      setAwardPreview(data.preview);
      toast.success('Fee-inclusive nonbinding preview created. Real checkout remains gated.');
    }catch(e){setShoppingError(e.message);}
    finally{setQuoteBusy(false);}
  };

  // B6-F — read-only server-ranked quote combinations, not an acceptance.
  const viewSmartComparison = async requestId => {
    setQuoteBusy(true);
    setShoppingError('');
    try{
      const [compared,negotiations,currentQuotes]=await Promise.all([
        procurementApi(`/api/v1/procurement/requests/${requestId}/compare`),
        procurementApi(`/api/v1/procurement/requests/${requestId}/negotiations`),
        procurementApi(`/api/v1/procurement/requests/${requestId}/quotes`)
      ]);
      setCompareRequestId(requestId);
      setQuoteComparison(compared);
      setBuyerNegotiations(negotiations.negotiations||[]);
      setBuyerQuotes(currentQuotes.quotes||[]);
      setReviewedAwardLines({});
      setAwardPreview(null);
    }catch(e){setShoppingError(e.message);}
    finally{setQuoteBusy(false);}
  };

  const requestBetterSmartOffer = async (quoteId,versionNumber) => {
    if(!compareRequestId)return;
    const message=improvementNotes[quoteId]?.trim()||'';
    if(message.length<5){setShoppingError('Describe the requested improvement (at least 5 characters).');return;}
    setQuoteBusy(true);
    setShoppingError('');
    try{
      await procurementApi(`/api/v1/procurement/requests/${compareRequestId}/quotes/${quoteId}/improve`,{
        method:'POST',headers:{'X-Idempotency-Key':newRequestKey()},
        body:JSON.stringify({message,target_total:improvementTargets[quoteId]||null,
          version_number:versionNumber})
      });
      const data=await procurementApi(`/api/v1/procurement/requests/${compareRequestId}/negotiations`);
      setBuyerNegotiations(data.negotiations||[]);
      toast.success('Request for a better quote sent. No order or payment created.');
    }catch(e){setShoppingError(e.message);}
    finally{setQuoteBusy(false);}
  };

  const refreshSupplierNegotiations = async () => {
    if(!token||user?.role!=='SUPPLIER')return;
    const data=await procurementApi('/api/v1/procurement/supplier/negotiations');
    setSupplierNegotiations(data.negotiations||[]);
  };

  const updateQuoteDraft = (invitationId,patch) => {
    setSupplierQuoteDrafts(old=>({
      ...old,[invitationId]:{...(old[invitationId]||{}),...patch}
    }));
  };

  const submitSmartSupplierQuote = async invitation => {
    setQuoteBusy(true);
    try {
      const saved=supplierQuoteDrafts[invitation.invitation_id]||{};
      const lines=(invitation.items||[]).flatMap(item=>{
        const line=saved.lines?.[item.id];
        return line?.supplier_listing_id && line?.unit_price ? [{
          request_item_id:item.id,
          supplier_listing_id:Number(line.supplier_listing_id),
          quantity:String(item.quantity),
          unit_price:String(line.unit_price)
        }] : [];
      });
      if(!lines.length)throw Error('Select an eligible listing and price for at least one item.');
      const deadline=saved.valid_until || new Date(Date.now()+24*60*60*1000).toISOString();
      const result=await procurementApi(`/api/v1/procurement/supplier/requests/${invitation.request_id}/quotes`,{
        method:'POST',
        headers:{'X-Idempotency-Key':newRequestKey()},
        body:JSON.stringify({
          lines,delivery_fee:saved.delivery_fee||'0',
          delivery_lead_days:Number(saved.delivery_lead_days??2),
          valid_until:new Date(deadline).toISOString(),
          supplier_notes:saved.supplier_notes||''
        })
      });
      toast.success(`Quotation version ${result.quote.version_number} submitted`);
      await refreshMySmartQuotes();
      await refreshSupplierNegotiations();
      setSupplierQuoteDrafts(old=>({...old,[invitation.invitation_id]:{}}));
    }catch(error){toast.error(error.message);}
    finally{setQuoteBusy(false);}
  };

  useEffect(()=>{
    if(token && user?.role==='SUPPLIER'){
      refreshMySmartQuotes().catch(error=>toast.error(error.message));
      refreshSupplierNegotiations().catch(error=>toast.error(error.message));
    }
  },[token,user?.role]);

  const refreshProcurementModes = async () => {
    if(!token||user?.role!=='BUYER')return;
    const [invites,contracts]=await Promise.all([
      procurementApi('/api/v1/procurement/collectives/my-invitations'),
      procurementApi('/api/v1/procurement/recurring')
    ]);
    setMyCollectiveInvites(invites.invitations||[]);
    setRecurringContracts(contracts.contracts||[]);
  };

  useEffect(()=>{
    if(token&&user?.role==='BUYER'){
      refreshProcurementModes().catch(error=>setShoppingError(error.message));
    }
  },[token,user?.role]);

  const createCollectiveFromDraft = async request => {
    setShoppingBusy(true);setShoppingError('');
    try{
      const result=await procurementApi(`/api/v1/procurement/requests/${request.id}/collective`,{
        method:'POST',body:JSON.stringify({visibility:'PRIVATE_INVITE',minimum_buyers:Number(minimumBuyers)})
      });
      setCollectiveGroup(result.group);
      await refreshProcurementModes();
      toast.success('Private collective created. Every buyer must join with explicit quantities.');
    }catch(e){setShoppingError(e.message);}
    finally{setShoppingBusy(false);}
  };

  const inviteCollectiveBuyer = async () => {
    if(!collectiveGroup)return;
    setShoppingBusy(true);setShoppingError('');
    try{
      await procurementApi(`/api/v1/procurement/collectives/${collectiveGroup.id}/invitations`,{
        method:'POST',body:JSON.stringify({buyer_id:Number(inviteBuyerId)})
      });
      setInviteBuyerId('');
      toast.success('Verified business invited. No obligation until they explicitly join.');
    }catch(e){setShoppingError(e.message);}
    finally{setShoppingBusy(false);}
  };

  const joinCollective = async invite => {
    setShoppingBusy(true);setShoppingError('');
    try{
      const lines=(invite.items||[]).flatMap(item=>{
        const qty=joinQuantities[`${invite.group_id}:${item.id}`];
        return qty?[{request_item_id:item.id,quantity:qty}]:[];
      });
      if(!lines.length)throw Error('Choose quantities for at least one requested item.');
      await procurementApi(`/api/v1/procurement/collectives/${invite.group_id}/join`,{
        method:'POST',headers:{'X-Idempotency-Key':newRequestKey()},
        body:JSON.stringify({lines})
      });
      await refreshProcurementModes();
      toast.success('Your independent group participation has been recorded; no payment taken.');
    }catch(e){setShoppingError(e.message);}
    finally{setShoppingBusy(false);}
  };

  const createRecurringFromDraft = async request => {
    if(!recurringStart)throw setShoppingError('Choose a recurring start date.');
    setShoppingBusy(true);setShoppingError('');
    try{
      const cadence=request.frequency;
      const rule={
        cadence,timezone_name:'Asia/Karachi',local_run_time:recurringTime,
        starts_on:recurringStart,ends_on:recurringEnd||null,
        payment_policy:'EXPLICIT_PER_CYCLE',pricing_policy:'REQUOTE_EACH_CYCLE',
        ...(cadence==='WEEKLY'?{weekday_number:Number(recurringCadenceDay)}
          :{month_day:Number(recurringCadenceDay),month_end_policy:'LAST_DAY'})
      };
      await procurementApi(`/api/v1/procurement/requests/${request.id}/recurring`,{
        method:'POST',headers:{'X-Idempotency-Key':newRequestKey()},
        body:JSON.stringify(rule)
      });
      await refreshProcurementModes();
      toast.success('Recurring draft created. Activate only after reviewing the schedule.');
    }catch(e){setShoppingError(e.message);}
    finally{setShoppingBusy(false);}
  };

  const updateRecurringStatus=async(contract,action)=>{
    setShoppingBusy(true);setShoppingError('');
    try{
      await procurementApi(`/api/v1/procurement/recurring/${contract.id}/${action.toLowerCase()}`,{
        method:'POST',body:JSON.stringify({version_number:contract.version_number,
          explicit_consent:action==='ACTIVATE'})
      });
      await refreshProcurementModes();
      toast.success('Recurring schedule updated without an automatic payment.');
    }catch(e){setShoppingError(e.message);}
    finally{setShoppingBusy(false);}
  };

  const previewRecurringCycles=async contractId=>{
    setShoppingBusy(true);setShoppingError('');
    try{
      const result=await procurementApi(`/api/v1/procurement/recurring/${contractId}/upcoming`);
      setRecurringUpcoming(result);
    }catch(e){setShoppingError(e.message);}
    finally{setShoppingBusy(false);}
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
      } else if (res.status !== 404) {
        throw new Error(data.error?.message || 'Could not load legacy RFQs');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load legacy RFQs');
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
      toast.success('Single-item RFQ saved.');
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
              Get Best Quotes
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              One shopping list, flexible suppliers, clearer wholesale comparisons. Start by creating a multi-product request below.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--brand-accent)] text-stone-900 text-sm font-semibold hover:opacity-95 shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Legacy Single-Item RFQ
            </button>
          </div>
        </div>

        {user?.role === 'BUYER' && (
          <section className="mb-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6 space-y-4" aria-label="Get Best Quotes">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-accent)]">Smart Procurement Hub</p>
              <h2 className="text-xl font-serif font-bold text-[var(--text-primary)]">Get Best Quotes — Your Shopping List</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Choose solo or group purchasing, one product or a complete shopping list, and one-time or recurring procurement. Payments require a later explicit buyer confirmation.</p>
            </div>
            {shoppingError && <p role="alert" className="text-sm text-red-600">{shoppingError}</p>}
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-semibold">How would you like to buy?
                <select value={buyerMode}
                  onChange={e=>{setBuyerMode(e.target.value);if(e.target.value==='COLLECTIVE')setPurchaseCadence('ONE_TIME');}}
                  className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  <option value="SINGLE_BUYER">Buy Alone — My Business</option>
                  <option value="COLLECTIVE">Buy Together — Verified Businesses</option>
                </select>
              </label>
              <label className="text-xs font-semibold">How often?
                <select value={purchaseCadence} onChange={e=>setPurchaseCadence(e.target.value)}
                  className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  <option value="ONE_TIME">One-Time Purchase</option>
                  <option value="WEEKLY" disabled={buyerMode==='COLLECTIVE'}>Weekly Recurring</option>
                  <option value="MONTHLY" disabled={buyerMode==='COLLECTIVE'}>Monthly Recurring</option>
                </select>
              </label>
            </div>
            {buyerMode==='COLLECTIVE' && (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs font-semibold">Group join cutoff (Pakistan local time)
                  <input type="datetime-local" value={joinDeadline}
                    onChange={e=>setJoinDeadline(e.target.value)}
                    className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                </label>
                <label className="text-xs font-semibold">Minimum participating businesses
                  <input type="number" min="2" max="1000" value={minimumBuyers}
                    onChange={e=>setMinimumBuyers(Number(e.target.value))}
                    className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                </label>
                <p className="sm:col-span-2 text-xs text-[var(--text-muted)]">
                  Private invitations and individual quantity consent are available in this stage.
                  Collective supplier bids, group checkout and collective recurring follow their financial gates.
                </p>
              </div>
            )}
            {buyerMode==='SINGLE_BUYER' && purchaseCadence!=='ONE_TIME' && (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs font-semibold">
                  {purchaseCadence==='WEEKLY'?'Day of week (0 Sun, 1 Mon)':'Day of month (1–31)'}
                  <input type="number" min={purchaseCadence==='WEEKLY'?0:1}
                    max={purchaseCadence==='WEEKLY'?6:31} value={recurringCadenceDay}
                    onChange={e=>setRecurringCadenceDay(e.target.value)}
                    className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                </label>
                <label className="text-xs font-semibold">Local time (Pakistan)
                  <input type="time" value={recurringTime}
                    onChange={e=>setRecurringTime(e.target.value)}
                    className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                </label>
                <label className="text-xs font-semibold">Start date
                  <input type="date" value={recurringStart}
                    onChange={e=>setRecurringStart(e.target.value)}
                    className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                </label>
                <label className="text-xs font-semibold">End date (optional)
                  <input type="date" value={recurringEnd}
                    onChange={e=>setRecurringEnd(e.target.value)}
                    className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                </label>
                <p className="sm:col-span-2 text-xs text-[var(--text-muted)]">
                  Every cycle requires fresh pricing and explicit payment approval. No automatic charges.
                </p>
              </div>
            )}
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
              <button type="button" disabled={shoppingBusy||!quoteDeadline||buyerMode!=='SINGLE_BUYER'||purchaseCadence!=='ONE_TIME'}
                onClick={()=>submitShoppingList(true)}
                className="rounded-xl px-4 py-2 bg-[var(--brand-accent)] text-stone-900 text-sm font-semibold disabled:opacity-50">
                Publish Shopping List
              </button>
              {activeRequest && <button type="button" disabled={shoppingBusy}
                onClick={()=>{setActiveRequest(null);setShoppingList([emptyItem()]);setDeliveryArea('');setQuoteDeadline('');setShoppingError('');}}
                className="text-sm px-3 py-2 underline">Start New</button>}
            </div>
            <p className="text-xs text-[var(--text-muted)]">No payment or inventory reservation happens when you publish or create a schedule/group. Solo one-time requests can receive supplier quotes now. Group bids and recurring payment remain gated until their completion tests.</p>
            {savedRequests.length>0 && (
              <div className="border-t border-[var(--border-subtle)] pt-3">
                <p className="text-sm font-semibold mb-2">My Shopping Requests</p>
                <div className="space-y-2">
                  {savedRequests.map(request=>(
                    <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{request.request_code} · {request.status} · {request.delivery_area}</span>
                      <div className="flex gap-3">
                        {request.status==='DRAFT' &&
                          <button type="button" disabled={shoppingBusy} onClick={()=>loadShoppingDraft(request.id)}
                            className="text-[var(--brand-accent)] underline text-xs">Edit Draft</button>}
                        {request.status==='DRAFT'&&request.ownership==='COLLECTIVE'&&request.frequency==='ONE_TIME' &&
                          <button type="button" disabled={shoppingBusy} onClick={()=>createCollectiveFromDraft(request)}
                            className="text-[var(--brand-accent)] underline text-xs">Set Up Private Group</button>}
                        {request.status==='DRAFT'&&request.ownership==='SINGLE_BUYER'&&request.frequency!=='ONE_TIME' &&
                          <button type="button" disabled={shoppingBusy} onClick={()=>createRecurringFromDraft(request)}
                            className="text-[var(--brand-accent)] underline text-xs">Create Recurring Schedule</button>}
                        {request.status==='OPEN' &&
                          <button type="button" disabled={matchingBusy} onClick={()=>viewSupplierMatches(request.id)}
                            className="text-[var(--brand-accent)] underline text-xs">Find suppliers</button>}
                        {request.status==='OPEN' &&
                          <button type="button" disabled={quoteBusy} onClick={()=>viewBuyerQuotes(request.id)}
                            className="text-[var(--brand-accent)] underline text-xs">View quotes</button>}
                        {request.status==='OPEN' &&
                          <button type="button" disabled={quoteBusy} onClick={()=>viewSmartComparison(request.id)}
                            className="text-[var(--brand-accent)] underline text-xs">Compare offers</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {collectiveGroup && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
                <p className="text-sm font-semibold">Private Group #{collectiveGroup.id}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Organizer must join too. An invitation does not authorize an order or payment.
                </p>
                <label className="text-xs font-semibold">Invite verified business by buyer ID
                  <div className="flex gap-2 mt-1">
                    <input type="number" min="1" value={inviteBuyerId}
                      onChange={e=>setInviteBuyerId(e.target.value)}
                      className="w-full p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                    <button type="button" disabled={shoppingBusy||!inviteBuyerId}
                      onClick={inviteCollectiveBuyer}
                      className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-xs">
                      Invite
                    </button>
                  </div>
                </label>
                <button type="button" className="text-xs underline" onClick={()=>setCollectiveGroup(null)}>
                  Close Group Setup
                </button>
              </div>
            )}
            {myCollectiveInvites.length>0 && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
                <h3 className="text-sm font-semibold">My Collective Invitations</h3>
                {myCollectiveInvites.map(invite=>(
                  <div key={invite.participant_id} className="space-y-2 border-t border-[var(--border-subtle)] pt-2">
                    <p className="text-xs font-semibold">
                      Group #{invite.group_id} · {invite.status} · Join by {String(invite.join_deadline)}
                    </p>
                    {invite.status==='INVITED'&&invite.group_status==='FORMING' && <>
                      {(invite.items||[]).map(item=>(
                        <label key={item.id} className="block text-xs">
                          Product family #{item.family_id} · {item.unit}
                          {item.requirements?' · '+item.requirements:''}
                          <input inputMode="decimal" placeholder="Your own quantity"
                            value={joinQuantities[`${invite.group_id}:${item.id}`]||''}
                            onChange={e=>setJoinQuantities(old=>({
                              ...old,[`${invite.group_id}:${item.id}`]:e.target.value
                            }))}
                            className="block w-full p-2 mt-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                        </label>
                      ))}
                      <button type="button" disabled={shoppingBusy} onClick={()=>joinCollective(invite)}
                        className="rounded-lg px-3 py-2 bg-[var(--brand-accent)] text-stone-900 text-xs font-semibold disabled:opacity-50">
                        Confirm My Quantities (No Payment)
                      </button>
                    </>}
                  </div>
                ))}
              </div>
            )}
            {recurringContracts.length>0 && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
                <h3 className="text-sm font-semibold">My Recurring Procurement</h3>
                {recurringContracts.map(contract=>(
                  <div key={contract.id} className="space-y-2 border-t border-[var(--border-subtle)] pt-2">
                    <p className="text-xs font-semibold">
                      {contract.contract_code} · {contract.cadence} · {contract.status} ·
                      {String(contract.local_run_time).slice(0,5)} PKT
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      New quote and separate buyer payment approval for every cycle. No automatic charge.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {contract.status==='DRAFT' &&
                        <button type="button" disabled={shoppingBusy}
                          onClick={()=>updateRecurringStatus(contract,'ACTIVATE')}
                          className="text-xs underline">Activate With Consent</button>}
                      {contract.status==='ACTIVE' &&
                        <button type="button" disabled={shoppingBusy}
                          onClick={()=>updateRecurringStatus(contract,'PAUSE')}
                          className="text-xs underline">Pause</button>}
                      {contract.status==='PAUSED' &&
                        <button type="button" disabled={shoppingBusy}
                          onClick={()=>updateRecurringStatus(contract,'RESUME')}
                          className="text-xs underline">Resume</button>}
                      {contract.status!=='CANCELLED' &&
                        <button type="button" disabled={shoppingBusy}
                          onClick={()=>updateRecurringStatus(contract,'CANCEL')}
                          className="text-xs underline">Cancel Future Cycles</button>}
                      <button type="button" disabled={shoppingBusy}
                        onClick={()=>previewRecurringCycles(contract.id)}
                        className="text-xs underline">Preview Schedule</button>
                    </div>
                  </div>
                ))}
                {recurringUpcoming && (
                  <div className="rounded-lg bg-[var(--bg-surface)] p-3 text-xs space-y-1">
                    <p className="font-semibold">Upcoming cycles (not payable orders)</p>
                    {(recurringUpcoming.upcoming||[]).map(cycle=>(
                      <p key={cycle.cycle_key}>{cycle.local_date} · {cycle.local_run_time} PKT</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {compareRequestId && quoteComparison && (
              <section className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3" aria-label="Compare supplier quotations">
                <div className="flex justify-between items-center gap-3">
                  <h3 className="text-sm font-semibold">Compare Delivered Quotes</h3>
                  <button type="button" className="text-xs underline"
                    onClick={()=>{setCompareRequestId(null);setQuoteComparison(null);}}>Close</button>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Supplier-quoted prices include their stated delivery fees, but exclude MilJor processing fees and taxes.
                  Final stock, quality, shipping conditions and full payable amount are rechecked only during acceptance.
                </p>
                {quoteComparison.coverage_status &&
                  <p role="alert" className="text-xs text-amber-700">Comparison incomplete: {quoteComparison.coverage_status}. Refine quotes before selecting suppliers.</p>}
                {(!quoteComparison.options||quoteComparison.options.length===0) &&
                  <p className="text-sm text-[var(--text-muted)]">No complete eligible shopping-list quotation combination is available yet. Suppliers can still send partial quotations.</p>}
                <div className="grid sm:grid-cols-3 gap-3">
                  {[
                    ['Lowest supplier quote',quoteComparison.recommendations?.lowest_supplier_quoted_cost],
                    ['Fastest declared delivery',quoteComparison.recommendations?.fastest_supplier_estimated_delivery],
                    ['Best value — fewer suppliers',quoteComparison.recommendations?.best_value_transparent_rule]
                  ].map(([title,option])=>(
                    <div key={title} className="rounded-lg border border-[var(--border-subtle)] p-3 space-y-1">
                      <p className="text-xs font-semibold">{title}</p>
                      {option ? <>
                        <p className="text-base font-semibold">Rs. {option.total_delivered_cost}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {option.supplier_count} supplier(s), {option.estimated_delivery_days} day(s) estimated
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">Quotes: {option.quote_ids.join(', ')}</p>
                      </> : <p className="text-xs text-[var(--text-muted)]">No matching full basket</p>}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-muted)]">{quoteComparison.best_value_rule}</p>
                {(quoteComparison.options||[]).slice(0,3).map((option,index)=>(
                  <div key={option.quote_ids.join('-')+'-'+index}
                    className="rounded-lg border border-[var(--border-subtle)] p-3 space-y-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="text-sm font-semibold">Shopping-list combination {index+1}</p>
                      <p className="text-sm font-semibold">Supplier quoted: Rs. {option.total_delivered_cost}</p>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      Items Rs. {option.item_subtotal} + supplier delivery Rs. {option.delivery_fee_total}.
                      MilJor fees and taxes are not included.
                    </p>
                    {(option.lines||[]).map(line=>(
                      <div key={line.request_item_id} className="text-xs border-t border-[var(--border-subtle)] pt-2">
                        <p className="font-semibold">
                          {line.supplier_sku_snapshot?.product_title||'Supplier SKU'} ·
                          {line.quantity} {line.unit} · Rs. {line.subtotal}
                        </p>
                        <p className="text-[var(--text-muted)]">
                          Quote #{line.quote_id} · Supplier #{line.supplier_id} ·
                          Brand: {line.supplier_sku_snapshot?.brand||'Supplier specified'} ·
                          Grade: {line.supplier_sku_snapshot?.quality_grade||'Supplier specified'} ·
                          Pack: {line.supplier_sku_snapshot?.pack_size||'?'} {line.supplier_sku_snapshot?.pack_unit||''}
                        </p>
                        {line.buyer_requirements && (
                          <p className="text-amber-700">
                            Buyer requested: {line.buyer_requirements}. Check grade and packaging before accepting.
                          </p>
                        )}
                        <label className="flex items-center gap-2 mt-2 font-medium">
                          <input type="checkbox"
                            checked={Boolean(reviewedAwardLines[
                              `${line.quote_id}:${line.request_item_id}:${buyerQuotes.find(q=>Number(q.id)===Number(line.quote_id))?.current_version}`
                            ])}
                            onChange={e=>{
                              const key=`${line.quote_id}:${line.request_item_id}:${buyerQuotes.find(q=>Number(q.id)===Number(line.quote_id))?.current_version}`;
                              setReviewedAwardLines(old=>({...old,[key]:e.target.checked}));
                            }}/>
                          I reviewed this physical SKU, grade and pack for my order preview
                        </label>
                      </div>
                    ))}
                    <button type="button" disabled={quoteBusy}
                      onClick={()=>previewSmartAward(option)}
                      className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold disabled:opacity-50">
                      Review Seller-Specific Order Breakdown
                    </button>
                  </div>
                ))}
                {awardPreview && (
                  <section className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-2" aria-label="Order preview only">
                    <p className="text-sm font-semibold">Order Breakdown — Preview Only</p>
                    <p className="text-xs text-[var(--text-muted)]">{awardPreview.warning}</p>
                    {(awardPreview.groups||[]).map(group=>(
                      <div key={group.supplier_id} className="border-t border-[var(--border-subtle)] pt-2 text-xs">
                        <p className="font-semibold">Supplier #{group.supplier_id} · Quote #{group.quote_id} v{group.version_number}</p>
                        <p>{group.lines?.length} products · Items Rs. {group.item_subtotal} + Delivery Rs. {group.delivery_fee}</p>
                        <p className="font-semibold">Supplier quoted Rs. {group.supplier_quote_total}</p>
                      </div>
                    ))}
                    <p className="text-sm font-semibold">Supplier quote total: Rs. {awardPreview.supplier_quoted_total}</p>
                    <p className="text-sm font-semibold">MilJor buyer processing fee: Rs. {awardPreview.buyer_platform_fee_total}</p>
                    <p className="text-base font-semibold">Calculated basket payable: Rs. {awardPreview.total_payable}</p>
                    <p className="text-xs text-amber-700">
                      Nonbinding preflight only. Tax policy and authoritative inventory checkout gate are not yet approved.
                      No stock is reserved, order created or payment requested.
                    </p>
                  </section>
                )}
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Ask a supplier for a better offer</p>
                  {buyerQuotes.filter(q=>q.status==='ACTIVE').map(quote=>(
                    <div key={quote.id} className="border-t border-[var(--border-subtle)] pt-2 space-y-2">
                      <p className="text-xs font-semibold">{quote.supplier_name} · Quote #{quote.id} (v{quote.current_version})</p>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <input value={improvementNotes[quote.id]||''}
                          onChange={e=>setImprovementNotes(old=>({...old,[quote.id]:e.target.value}))}
                          maxLength={1000} placeholder="e.g. Can you improve the delivery fee?"
                          aria-label={`Requested improvement for quote ${quote.id}`}
                          className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs"/>
                        <input value={improvementTargets[quote.id]||''}
                          onChange={e=>setImprovementTargets(old=>({...old,[quote.id]:e.target.value}))}
                          placeholder="Optional target total (Rs.)" inputMode="decimal"
                          aria-label={`Optional target for quote ${quote.id}`}
                          className="p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs"/>
                      </div>
                      <button type="button" disabled={quoteBusy ||
                        buyerNegotiations.some(n=>Number(n.quote_id)===Number(quote.id) &&
                          Number(n.requested_version)===Number(quote.current_version))}
                        onClick={()=>requestBetterSmartOffer(quote.id,quote.current_version)}
                        className="text-xs underline disabled:opacity-40">
                        {buyerNegotiations.some(n=>Number(n.quote_id)===Number(quote.id) &&
                          Number(n.requested_version)===Number(quote.current_version))
                          ? 'Improvement already requested for this version' : 'Request Better Offer'}
                      </button>
                    </div>
                  ))}
                </div>
                {buyerNegotiations.length>0 && (
                  <div className="space-y-1 border-t border-[var(--border-subtle)] pt-3">
                    <p className="text-xs font-semibold">Negotiation history</p>
                    {buyerNegotiations.map(n=>(
                      <p key={n.id} className="text-xs text-[var(--text-muted)]">
                        Quote #{n.quote_id} · v{n.requested_version} · {n.status} · {n.buyer_message}
                        {n.responded_version ? ` · Supplier revised to v${n.responded_version}`:''}
                      </p>
                    ))}
                  </div>
                )}
              </section>
            )}
            {selectedQuotesRequest && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Supplier Quotations</p>
                  <button type="button" className="text-xs underline"
                    onClick={()=>{setSelectedQuotesRequest(null);setBuyerQuotes([]);}}>Close</button>
                </div>
                {buyerQuotes.length===0 && <p className="text-xs text-[var(--text-muted)]">No quotations received yet.</p>}
                {buyerQuotes.map(quote=>(
                  <article key={quote.id} className="border-t border-[var(--border-subtle)] pt-3">
                    <p className="text-sm font-semibold">{quote.supplier_name} · Version {quote.current_version}</p>
                    <p className="text-xs text-[var(--text-muted)]">{quote.coverage} · {quote.quote_snapshot?.lines?.length||0} lines</p>
                    {(quote.quote_snapshot?.lines||[]).map(line=>(
                      <p key={line.request_item_id} className="text-xs">
                        {line.snapshot?.product_title} · {line.quantity} {line.snapshot?.purchasing_unit}
                        · Rs. {line.subtotal} (Grade: {line.snapshot?.quality_grade||'Supplier-specified'})
                      </p>
                    ))}
                    <p className="text-sm font-semibold mt-1">
                      Items Rs. {quote.items_total} + Delivery Rs. {quote.delivery_fee}
                      = Rs. {quote.quoted_total}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">Valid until {String(quote.valid_until)}. Supplier quotation excludes MilJor processing fees; final payable amount is calculated only at order acceptance.</p>
                    <button type="button" className="text-xs underline mt-1" disabled={quoteBusy}
                      onClick={()=>viewQuoteHistory(selectedQuotesRequest,quote.id)}>View version history</button>
                  </article>
                ))}
                {quoteHistory && (
                  <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <p className="text-xs font-semibold">Quotation #{quoteHistory.quote_id} history</p>
                      <button type="button" onClick={()=>setQuoteHistory(null)} className="text-xs underline">Close history</button>
                    </div>
                    {(quoteHistory.versions||[]).map(version=>(
                      <p key={version.version_number} className="text-xs">
                        Version {version.version_number} · {version.coverage} · Rs. {version.quoted_total} · Valid until {String(version.valid_until)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {selectedMatchRequest && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">Matching suppliers</p>
                  <button type="button" onClick={()=>{setSelectedMatchRequest(null);setSupplierMatches([]);setSupplierInvitations([]);}}
                    className="text-xs underline">Close</button>
                </div>
                <p className="text-xs text-[var(--text-muted)]">Matches reflect compatible listed items and declared delivery zones. Final stock, specifications and terms will be checked when suppliers submit quotes.</p>
                {supplierMatches.length===0 && <p className="text-sm text-[var(--text-muted)]">No eligible suppliers currently match this request.</p>}
                {supplierMatches.map(supplier=>{
                  const invite=supplierInvitations.find(row=>Number(row.supplier_id)===Number(supplier.supplier_id));
                  return <div key={supplier.supplier_id} className="flex justify-between gap-3 items-center border-t border-[var(--border-subtle)] pt-3">
                    <div>
                      <p className="text-sm font-semibold">{supplier.supplier_name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{supplier.covered_item_count} of {supplier.total_item_count} product lines match</p>
                    </div>
                    <button type="button" disabled={matchingBusy||Boolean(invite)}
                      onClick={()=>inviteSupplier(supplier.supplier_id)}
                      className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-xs font-semibold disabled:opacity-50">
                      {invite ? invite.status : 'Invite'}
                    </button>
                  </div>;
                })}
              </div>
            )}
          </section>
        )}

        {user?.role === 'SUPPLIER' && (
          <section aria-label="Supplier procurement invitations" className="mb-8 rounded-2xl border border-[var(--border-subtle)] p-5 space-y-3">
            <div className="flex justify-between items-center gap-3">
              <h2 className="text-lg font-serif font-semibold">Procurement Invitations</h2>
              <button type="button" onClick={refreshSupplierInbox} className="text-xs underline">Refresh</button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">Buyers' business contact details and delivery addresses are private. Your interest is not a binding quotation.</p>
            {supplierNegotiations.length>0 && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-2">
                <p className="text-sm font-semibold">Requests for Better Offers</p>
                {supplierNegotiations.map(n=>(
                  <div key={n.id} className="border-t border-[var(--border-subtle)] pt-2">
                    <p className="text-xs font-semibold">Quote #{n.quote_id} · Request #{n.request_id} · {n.status}</p>
                    <p className="text-xs">{n.buyer_message}</p>
                    {n.buyer_target_total && <p className="text-xs">Buyer suggested total: Rs. {n.buyer_target_total}</p>}
                    <p className="text-xs text-[var(--text-muted)]">
                      {n.status==='OPEN'?'To respond, submit a revised quote using the existing invitation quotation form.':
                        `Responded with quote version ${n.responded_version||'pending'}.`}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {mySmartQuotes.length>0 && (
              <div className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-2">
                <p className="text-sm font-semibold">My submitted quotations</p>
                {mySmartQuotes.map(quote=>(
                  <div key={quote.id} className="flex flex-wrap justify-between gap-2 text-xs">
                    <span>Quote #{quote.id} · RFQ #{quote.request_id} · v{quote.current_version} · {quote.status} · Rs. {quote.quoted_total}</span>
                    {quote.status==='ACTIVE' && <button type="button" disabled={quoteBusy}
                      onClick={()=>withdrawSmartQuote(quote.id)} className="underline text-red-600">
                      Withdraw
                    </button>}
                  </div>
                ))}
              </div>
            )}
            {supplierInbox.length===0 && <p className="text-sm text-[var(--text-muted)]">No open invitations yet.</p>}
            {supplierInbox.map(invitation=>(
              <article key={invitation.invitation_id} className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
                <p className="text-sm font-semibold">{invitation.request_code} · {invitation.status}</p>
                <div className="space-y-1">
                  {(invitation.items||[]).map((item,index)=>(
                    <p key={index} className="text-xs text-[var(--text-muted)]">
                      Product family #{item.family_id}: {item.quantity} {item.unit}
                      {item.requirements ? ` · ${item.requirements}` : ''}
                    </p>
                  ))}
                </div>
                {invitation.status==='INTERESTED' && (
                  <div className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-3">
                    <p className="text-sm font-semibold">Submit a supplier quotation</p>
                    <p className="text-xs text-[var(--text-muted)]">Choose which requested items you can supply. Your exact physical SKU, price and delivery will be shown to the buyer. Leave an item blank to omit it.</p>
                    {(invitation.items||[]).map(item=>{
                      const eligible=(invitation.eligible_offers||[]).filter(offer=>Number(offer.request_item_id)===Number(item.id));
                      const draft=supplierQuoteDrafts[invitation.invitation_id]||{};
                      const line=draft.lines?.[item.id]||{};
                      return <div key={item.id} className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-[var(--border-subtle)] pt-2">
                        <label className="text-xs font-semibold">Product family #{item.family_id} — {item.quantity} {item.unit}
                          <select value={line.supplier_listing_id||''}
                            onChange={event=>updateQuoteDraft(invitation.invitation_id,{
                              lines:{...(draft.lines||{}),[item.id]:{...line,supplier_listing_id:event.target.value}}
                            })}
                            className="block w-full mt-1 rounded-lg p-2 border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                            <option value="">Do not quote this item</option>
                            {eligible.map(offer=><option key={offer.supplier_listing_id} value={offer.supplier_listing_id}>
                              {offer.product_title} · {offer.pack_size}{offer.pack_unit} · listing #{offer.supplier_listing_id}
                            </option>)}
                          </select>
                        </label>
                        <label className="text-xs font-semibold">Price per {item.unit} (Rs.)
                          <input inputMode="decimal" value={line.unit_price||''} placeholder="0.00"
                            onChange={event=>updateQuoteDraft(invitation.invitation_id,{
                              lines:{...(draft.lines||{}),[item.id]:{...line,unit_price:event.target.value}}
                            })}
                            className="block w-full mt-1 rounded-lg p-2 border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                        </label>
                      </div>;
                    })}
                    <div className="grid sm:grid-cols-2 gap-2">
                      <label className="text-xs font-semibold">Delivery fee (Rs.)
                        <input value={(supplierQuoteDrafts[invitation.invitation_id]||{}).delivery_fee??'0'}
                          onChange={event=>updateQuoteDraft(invitation.invitation_id,{delivery_fee:event.target.value})}
                          className="block w-full mt-1 p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                      </label>
                      <label className="text-xs font-semibold">Lead time (days)
                        <input type="number" min="0" max="90" value={(supplierQuoteDrafts[invitation.invitation_id]||{}).delivery_lead_days??2}
                          onChange={event=>updateQuoteDraft(invitation.invitation_id,{delivery_lead_days:event.target.value})}
                          className="block w-full mt-1 p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                      </label>
                      <label className="text-xs font-semibold">Quote valid until
                        <input type="datetime-local" value={(supplierQuoteDrafts[invitation.invitation_id]||{}).valid_until||''}
                          onChange={event=>updateQuoteDraft(invitation.invitation_id,{valid_until:event.target.value})}
                          className="block w-full mt-1 p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"/>
                      </label>
                    </div>
                    <button type="button" disabled={quoteBusy}
                      onClick={()=>submitSmartSupplierQuote(invitation)}
                      className="rounded-lg px-4 py-2 bg-[var(--brand-accent)] text-stone-900 text-xs font-semibold disabled:opacity-50">
                      {quoteBusy?'Submitting...':'Submit Quotation'}
                    </button>
                  </div>
                )}
                {invitation.status==='INVITED' && <div className="flex gap-2">
                  <button type="button" disabled={matchingBusy} onClick={()=>respondInvitation(invitation.invitation_id,'INTERESTED')}
                    className="text-xs font-semibold rounded-lg px-3 py-2 border border-[var(--border-subtle)]">I'm interested</button>
                  <button type="button" disabled={matchingBusy} onClick={()=>respondInvitation(invitation.invitation_id,'DECLINED')}
                    className="text-xs rounded-lg px-3 py-2 border border-[var(--border-subtle)]">Decline</button>
                </div>}
              </article>
            ))}
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
