import React, { useEffect, useState } from 'react';
import supplierApi from '../../api/supplier';
import { SupplierVerificationDocuments } from './SupplierVerificationDocuments';
import { toast } from 'react-toastify';

// Only server-selected fields can appear here. This component cannot edit other
// profile fields or trigger full-profile re-upload.
const labels = {
  business_name:'Business name',business_type:'Business type',business_description:'Description',
  contact_person_name:'Contact person',contact_person_phone:'Contact phone',
  warehouse_address:'Warehouse address',lahore_service_area:'Service area',
  tax_ntn:'National tax number',food_license_no:'Food license number',
  food_license_type:'Food license type',bank_name:'Bank name',
  bank_account_title:'Bank account title',bank_iban:'Bank IBAN'
};
export function SupplierVerificationCorrections({profile,onSubmitted}) {
  const fields = Array.isArray(profile?.correction_fields) ?
    profile.correction_fields.filter(field=>Object.prototype.hasOwnProperty.call(labels,field)) : [];
  const documents=Array.isArray(profile?.correction_fields)?profile.correction_fields.filter(f=>f.startsWith('document:')).map(f=>f.slice(9)):[];
  const notes=profile?.correction_notes || {};
  const [values,setValues] = useState({});
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  useEffect(()=>{
    const next={};
    for(const field of fields)next[field]=field==='bank_iban'?'':(profile?.[field]??'');
    setValues(next);
  },[profile?.submitted_revision,profile?.correction_fields?.join(',')]);
  async function submit(e){
    e.preventDefault();
    if((!fields.length&&!documents.length) || busy)return;
    setBusy(true);setError('');
    try{
      const changes=Object.fromEntries(fields.map(field=>[field,values[field]??'']));
      await supplierApi.submitCorrections(profile.submitted_revision,changes,crypto.randomUUID());
      toast.success('Corrections submitted. Your previously valid information is retained.');
      await onSubmitted();
    }catch(err){
      setError(err.response?.data?.error?.message||err.message||'Could not submit corrections');
    }finally{setBusy(false)}
  }
  return <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-4">
    <div>
      <h2 className="font-semibold text-lg text-[var(--text-primary)]">Requested verification corrections</h2>
      <p className="text-sm text-[var(--text-muted)]">Original submission revision {profile.submitted_revision} remains on record. Only the fields listed below need updating; all other details and documents remain saved.</p>
    </div>
    {!fields.length&&!documents.length?<p role="alert" className="text-sm">No field-specific correction request is available. Contact MilJor support instead of re-submitting your full application.</p>:
    <form onSubmit={submit} className="space-y-4">
      {documents.length>0&&<SupplierVerificationDocuments profile={profile} requestedKinds={documents}/>}

      {fields.map(field=><div key={field} className="space-y-1">
        <label htmlFor={'correction-'+field} className="text-sm font-semibold">{labels[field]}</label>
        <p className="text-xs text-[var(--text-muted)]">{notes[field]||'Update this requested field'}</p>
        <input id={'correction-'+field} value={values[field]??''} required
          placeholder={field==='bank_iban'?(profile.bank_iban_masked||'Enter the corrected IBAN'):undefined}
          onChange={e=>setValues(prev=>({...prev,[field]:e.target.value}))}
          autoComplete="off" className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm" />
      </div>)}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-xl bg-[var(--brand-accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-champagne)] disabled:opacity-50">
        {busy?'Submitting…':'Submit requested corrections'}
      </button>
    </form>}
  </section>;
}
