'use strict';
// Disposable test users only. Never run against production/sandbox.
const bcrypt=require('bcryptjs');
const db=require('../src/config/db');
async function main(){
 const req={GITHUB_ACTIONS:'true',B7_CI_EPHEMERAL_DB:'YES',
 NODE_ENV:'test',DB_NAME:'miljor_test_db',TEST_DB_NAME:'miljor_test_db'};
 for(const [k,v] of Object.entries(req))if(process.env[k]!==v)throw Error('B7_BROWSER_USERS_BLOCKED '+k);
 const [[who]]=await db.query('SELECT DATABASE() AS name');
 if(who.name!=='miljor_test_db')throw Error('B7_PROTECTED_DB_BLOCK');
 const password=process.env.B7_EPHEMERAL_USER_PASSWORD;
 if(!password||password.length<12)throw Error('B7_TEST_PASSWORD_REQUIRED');
 const hash=await bcrypt.hash(password,12);
 const [updated]=await db.query(
  "UPDATE users SET password_hash=?,verification_status='VERIFIED',is_verified=1 WHERE id IN (2,5)",
  [hash]);
 if(updated.affectedRows!==2)throw Error('B7_TEST_USER_FIXTURES_MISSING');
 console.log('B7 ephemeral login credentials set for buyer5/supplier2; no real accounts.');
}
main().catch(e=>{console.error('B7_BROWSER_USER_FIXTURE_FAILED',e.message);process.exitCode=1})
 .finally(async()=>db.end().catch(()=>{}));
