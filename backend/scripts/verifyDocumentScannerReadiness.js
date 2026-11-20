'use strict';
// Operational ClamAV readiness probe for private supplier KYC uploads.
// Read-only: scans ONLY bundled benign bytes, never touches user files,
// MySQL, provider networks, or stores secrets. CLEAN is a connectivity
// signal, NOT evidence of updated AV signatures or production approval.
const {scan}=require('../src/services/documentMalwareScanService');
const benignDocument=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n','ascii');
const failure=(code,message)=>Object.assign(new Error(message),{code,statusCode:503});
async function inspect({env=process.env,scanDocument=scan}={}){
  if(env.NODE_ENV!=='production'&&env.UPLOAD_SCAN_REQUIRED!=='true')
    throw failure('UPLOAD_SCAN_NOT_ENFORCED','Required malware scanning is not enabled');
  if(typeof env.CLAMAV_HOST!=='string'||!env.CLAMAV_HOST.trim())
    throw failure('UPLOAD_SCANNER_NOT_CONFIGURED','Private ClamAV scanner hostname missing');
  const port=Number(env.CLAMAV_PORT||3310);
  if(!Number.isInteger(port)||port<1||port>65535)
    throw failure('UPLOAD_SCANNER_NOT_CONFIGURED','Private ClamAV scanner port invalid');
  const result=await scanDocument(benignDocument,{host:env.CLAMAV_HOST,port});
  if(result?.verified!==true||result.status!=='CLEAN')
    throw failure('UPLOAD_SCANNER_NOT_VERIFIED','Private ClamAV did not confirm a clean INSTREAM scan');
  return Object.freeze({
    scanner_readiness:'CLEAN_INSTREAM_PROBE_PASSED',
    sample:'BUNDLED_BENIGN_NON_USER_DATA',
    av_signature_freshness:'NOT_VERIFIED',
    real_malware_detection:'NOT_VERIFIED',
    production_security_signoff:'NOT_OBTAINED',
    no_business_data_scanned:true,
    no_db_writes:true
  });
}
if(require.main===module){
  inspect().then(status=>{console.log(JSON.stringify(status));})
    .catch(err=>{
      // Never print clamd response, hostname or any secret in error text.
      console.error(JSON.stringify({scanner_readiness:'BLOCKED',
        code:/^UPLOAD_/.test(String(err.code||''))?err.code:'UPLOAD_SCANNER_UNAVAILABLE',
        production_security_signoff:'NOT_OBTAINED'}));
      process.exitCode=2;
    });
}
module.exports={inspect};
