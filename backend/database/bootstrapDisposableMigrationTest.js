'use strict';
// TEST ONLY: reconstructs the minimal legacy seeded baseline expected by 004.
// Does not touch or attempt to reproduce any user's actual production data.
// NEVER call against miljor_db, miljor_sandbox_db, or nonempty databases.
const fs=require('fs'),path=require('path'),mysql=require('mysql2/promise');
async function main(){
 const target=process.env.DB_NAME, testDb=process.env.TEST_DB_NAME;
 if(process.env.NODE_ENV!=='test'||process.env.MILJOR_TEST_ONLY_MIGRATIONS!=='1'||
    target!=='miljor_test_db'||testDb!=='miljor_test_db')
   throw Error('TEST_BOOTSTRAP_PROTECTED_DB_BLOCKED: only disposable miljor_test_db in test mode');
 const db=await mysql.createConnection({
   host:process.env.DB_HOST||'127.0.0.1',user:process.env.DB_USER||'root',
   password:process.env.DB_PASSWORD||'',database:target
 });
 try{
   const [existing]=await db.query(
     'SELECT table_name FROM information_schema.tables WHERE table_schema=? LIMIT 1',[target]
   );
   if(existing.length)throw Error('TEST_BOOTSTRAP_REQUIRES_EMPTY_DB: refuse to touch existing schema');
   // The actual historical pre-migration environment had the old schema.sql
   // (17 legacy tables) + sample reference users/products. Migration 001 alone
   // only creates 2 tables and therefore is NOT a valid upgrade-path fixture.
   // Extract CREATE TABLE statements ONLY. Explicitly ignore USE miljor_db,
   // DROP TABLE, foreign-key toggles and any other destructive SQL.
   const legacy=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
   const createStatements=legacy.replace(/--.*$/gm,'').split(';')
     .map(x=>x.trim()).filter(x=>/^CREATE TABLE\s+/i.test(x));
   if(createStatements.length<15)throw Error('Unexpected historical baseline schema; fixture is invalid');
   for(const statement of createStatements)await db.query(statement);
   // Legacy snapshot before 004 historically contained users #1–7 and products #1–5.
   // Synthetic names and disabled real payment integration; no actual credentials.
   const users=[
     [1,'Test Admin','SUPER_ADMIN'],
     [2,'Test Supplier A','SUPPLIER'],
     [3,'Test Supplier B','SUPPLIER'],
     [4,'Test Supplier C','SUPPLIER'],
     [5,'Test Buyer A','BUYER'],
     [6,'Test Buyer B','BUYER'],
     [7,'Test Buyer C','BUYER']
   ];
   for(const [id,name,role] of users){
     await db.query(
       `INSERT INTO users (id,full_name,business_name,email,role,city,is_verified,verification_status)
        VALUES (?,?,?,?,?,'Lahore',1,'VERIFIED')`,
       [id,name,'CI Dummy '+id,'ci-user-'+id+'@invalid.example',role]
     );
   }
   const products=[
     [1,'Basmati Rice Premium','Grains & Rice','Akbari Brand','1121 Extra Long Grain','Double Polished','Grade A','50kg Bag','kg'],
     [2,'Chakki Atta Wheat Flour','Flour & Grain','Akbari Mills','Whole Wheat Chakki','Stone Ground','Grade A','10kg Bag','kg'],
     [3,'Canola Cooking Oil','Oils & Fats','Sufi','Pure Canola','Refined','Food Grade','16L Tin','litre'],
     [4,'Refined White Sugar','Sugar & Sweeteners','JDW Sugar','ICUMSA 45','Refined Crystal','Premium','50kg Bag','kg'],
     [5,'Masoor Dal Red Lentil','Pulses & Legumes','National Brand','Split Red Lentil','Dehusked & Split','Grade A','25kg Bag','kg']
   ];
   for(const p of products)await db.query(
     `INSERT INTO products (id,title,category,brand,variety,processing_type,grade,pack_size,unit)
      VALUES (?,?,?,?,?,?,?,?,?)`,p
   );
   console.log('TEST_BASELINE_PRE_004_READY:',createStatements.length,'legacy tables,',users.length,'synthetic users +',products.length,'legacy products');
 }finally{await db.end();}
}
if(require.main===module)main().catch(e=>{
 console.error('TEST_BOOTSTRAP_BLOCKED:',String(e?.message||e).slice(0,400));
 process.exitCode=1;
});
module.exports={main};
