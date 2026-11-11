'use strict';
// Explicit, ONE-TIME LOCAL installation. Never runs on server startup or CI.
// Usage after VERIFIED PRIVATE BACKUP:
//   MILJOR_BOOTSTRAP_ADMIN_EMAIL=... MILJOR_BOOTSTRAP_CONFIRM=I_HAVE_BACKED_UP_MY_DATABASE
//   NODE_ENV=development node scripts/bootstrap_first_admin.js
// Creates no user/password and does not allow supplier account self-approval.
// Instead, promotes an existing email-verified non-supplier account.
require('dotenv').config();
const db=require('../src/config/db');
async function main(){
  const email=String(process.env.MILJOR_BOOTSTRAP_ADMIN_EMAIL||'').trim().toLowerCase();
  const confirm=process.env.MILJOR_BOOTSTRAP_CONFIRM;
  if(process.env.NODE_ENV!=='development' || process.env.DB_NAME!=='miljor_db' ||
     process.env.MILJOR_BOOTSTRAP_TEST_MODE==='true' || confirm!=='I_HAVE_BACKED_UP_MY_DATABASE' ||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    throw new Error('BOOTSTRAP_BLOCKED: explicitly select development/miljor_db, existing admin email and verified backup confirmation');
  }
  const connection=await db.getConnection();
  let locked=false;
  try{
    const [[identity]]=await connection.query('SELECT DATABASE() AS db');
    if(identity.db!=='miljor_db')throw new Error('DATABASE_MISMATCH_ABORT');
    const [[gate]]=await connection.query("SELECT GET_LOCK('miljor_first_super_admin_bootstrap', 5) AS acquired");
    if(Number(gate.acquired)!==1)throw new Error('BOOTSTRAP_LOCK_UNAVAILABLE');
    locked=true;
    await connection.beginTransaction();
    const [admins]=await connection.query(
      "SELECT id FROM users WHERE role='SUPER_ADMIN' LIMIT 1 FOR UPDATE"
    );
    if(admins.length)throw new Error('SUPER_ADMIN_ALREADY_EXISTS: use existing super-admin; this is not a password reset');
    const [users]=await connection.query(
      "SELECT id,email,role,is_verified,verification_status,buyer_trust_status FROM users WHERE LOWER(email)=? FOR UPDATE",
      [email]
    );
    if(users.length!==1)throw new Error('EXISTING_VERIFIED_NON_SUPPLIER_ACCOUNT_REQUIRED');
    const account=users[0];
    if(account.role!=='BUYER' || Number(account.is_verified)!==1 ||
       account.verification_status==='BLOCKED' || account.verification_status==='PENDING_SUPPLIER_VERIFICATION' ||
       account.buyer_trust_status==='SUSPENDED'){
      throw new Error('ACCOUNT_NOT_ELIGIBLE: use a separate verified BUYER account, never your SUPPLIER account');
    }
    const [profiles]=await connection.query('SELECT supplier_id FROM supplier_profiles WHERE supplier_id=? FOR UPDATE',[account.id]);
    if(profiles.length)throw new Error('SELF_APPROVAL_SEPARATION_REQUIRED: admin must be a distinct account');
    await connection.query("UPDATE users SET role='SUPER_ADMIN' WHERE id=? AND role='BUYER'",[account.id]);
    await connection.query(
      "INSERT INTO system_audit_logs (actor_id,actor_role,action,entity_name,entity_id,previous_value,new_value) VALUES (?,?,'INITIAL_SUPER_ADMIN_BOOTSTRAP','users',?,?,?)",
      [account.id,'SUPER_ADMIN',account.id,
       JSON.stringify({role:'BUYER'}),JSON.stringify({role:'SUPER_ADMIN',source:'local_one_time_explicit_installation'})]
    );
    await connection.commit();
    console.log('BOOTSTRAP_SUCCESS: Existing verified account promoted. Log in with its existing password. No supplier profile was approved.');
  } catch(err){
    await connection.rollback();
    throw err;
  } finally{
    if(locked)await connection.query("SELECT RELEASE_LOCK('miljor_first_super_admin_bootstrap')").catch(()=>{});
    connection.release();
    await db.end();
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
