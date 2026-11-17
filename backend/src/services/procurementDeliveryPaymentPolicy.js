'use strict';
// Only an explicit rejected request is safe to retry without a provider lookup.
// A timeout/5xx/returned tracker can conceal an initialized session.
function initializationDisposition(error,knownTracker){return !knownTracker&&[400,401,403,404,422].includes(Number(error?.providerStatusCode))?'DEFINITELY_REJECTED':'RECONCILIATION_REQUIRED';}
module.exports={initializationDisposition};
