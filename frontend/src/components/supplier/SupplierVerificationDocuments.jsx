import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import supplierApi from '../../api/supplier';

export const DOCUMENT_LABELS = {
  BUSINESS_LICENSE:'Business license',
  TAX_CERTIFICATE:'Tax certificate',
  WAREHOUSE_PROOF:'Warehouse proof',
  BANK_PROOF:'Bank proof'
};
export function SupplierVerificationDocuments({profile,requestedKinds=[],onUpload}) {
  const [documents,setDocuments]=useState([]);
  const [pending,setPending]=useState(null);
  const [error,setError]=useState('');
  const permitted=profile?.verification_status==='NOT_SUBMITTED'
    ? Object.keys(DOCUMENT_LABELS) : requestedKinds;
  const load=useCallback(async()=>{
    const res=await supplierApi.getVerificationDocuments();
    setDocuments(res.data?.documents||[]);
  },[]);
  useEffect(()=>{load().catch(()=>setError('Could not load document versions'));},[load,profile?.submitted_revision]);
  const latest=kind=>documents.filter(d=>d.kind===kind).sort((a,b)=>b.version-a.version)[0];
  async function submit(kind,file){
    if(!file)return;
    if(file.size>1048576 || !['application/pdf','image/jpeg','image/png'].includes(file.type)){
      setError('Only PDF, PNG or JPEG up to 1 MiB is supported');return;
    }
    setPending(kind);setError('');
    try{
      await supplierApi.uploadVerificationDocument(kind,file,crypto.randomUUID());
      await load();onUpload?.();toast.success('Evidence version saved without replacing older files');
    }catch(e){setError(e.response?.data?.error?.message||e.message||'Upload failed');}
    finally{setPending(null);}
  }
  return <section className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-3" aria-label="Supplier evidence">
    <div>
      <h3 className="font-semibold text-sm">Verification evidence</h3>
      <p className="text-xs text-[var(--text-muted)]">Private PDF, PNG or JPEG files · Maximum 1 MiB · Old versions remain unchanged</p>
    </div>
    {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
    {permitted.map(kind=><div key={kind} className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
      <label className="block text-sm font-medium" htmlFor={'evidence-'+kind}>{DOCUMENT_LABELS[kind]}</label>
      {latest(kind)&&<p className="text-xs text-[var(--text-muted)]">
        Latest v{latest(kind).version} · {latest(kind).filename} · SHA-256 verified on access
      </p>}
      <input id={'evidence-'+kind} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        disabled={Boolean(pending)}
        className="block w-full text-xs"
        onChange={e=>{const file=e.target.files?.[0];if(file)submit(kind,file);e.target.value='';}} />
    </div>)}
    {documents.length>0&&<details className="text-xs">
      <summary className="cursor-pointer font-medium">Document version history ({documents.length})</summary>
      <ul className="mt-2 space-y-2">
        {documents.map(doc=><li key={doc.id} className="flex justify-between gap-2">
          <span>{DOCUMENT_LABELS[doc.kind]} · v{doc.version} · {doc.filename}</span>
          <button type="button" className="underline text-[var(--brand-accent)]"
            onClick={async()=>{
              try{
                const blob=await supplierApi.downloadVerificationDocument(doc.id);
                const url=URL.createObjectURL(blob);
                const a=document.createElement('a');a.href=url;a.download=doc.filename;
                a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
              }catch{setError('Could not retrieve document');}
            }}>Download</button>
        </li>)}
      </ul>
    </details>}
    {pending&&<p role="status">Uploading {DOCUMENT_LABELS[pending]}…</p>}
  </section>;
}
