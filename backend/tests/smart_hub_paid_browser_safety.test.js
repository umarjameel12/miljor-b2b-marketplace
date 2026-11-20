'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const runner=path.join(__dirname,'smart_hub_paid_browser_journey.js');
const safe={...process.env,NODE_ENV:'test',DB_NAME:'miljor_test_db',TEST_DB_NAME:'miljor_test_db',DB_HOST:'127.0.0.1',MILJOR_TEST_ONLY_MIGRATIONS:'1',SAFEPAY_ENV:'sandbox',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',JWT_SECRET:'isolated_test_jwt_secret_at_least_32_chars'};
for(const [key,value] of Object.entries({NODE_ENV:'production',DB_NAME:'miljor_db',TEST_DB_NAME:'miljor_sandbox_db',DB_HOST:'remote.invalid',MILJOR_TEST_ONLY_MIGRATIONS:'0',SAFEPAY_ENV:'production',ALLOW_EXTERNAL_MONEY_MOVEMENT:'true',JWT_SECRET:''})){
  test('runner rejects unsafe '+key+' before loading browser, server or database',()=>{
    const result=spawnSync(process.execPath,[runner],{cwd:path.resolve(__dirname,'..'),env:{...safe,[key]:value},encoding:'utf8',timeout:5000});
    assert.equal(result.error,undefined);assert.notEqual(result.status,0);
    assert.match(result.stderr,key==='DB_HOST'?/Local disposable MySQL only/:key==='JWT_SECRET'?/Explicit disposable JWT secret required/:new RegExp('Unsafe environment: '+key));
    assert.doesNotMatch(result.stdout,/MySQL|PASS/);
    assert.doesNotMatch(result.stderr,/Cannot find module|SMART_HUB_PAID_BROWSER_FAILED/);
  });
}
