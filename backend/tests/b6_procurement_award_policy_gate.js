'use strict';
// B6 combined Phase 1 G/H — no-DB financial preflight safety gate.
const assert=require('node:assert/strict');
const {buildAwardPreview}=require('../src/services/procurementAwardPolicy');
let n=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+(++n)+': '+name)};
const rejected=(code,fn)=>assert.throws(fn,error=>error.code===code);

const now='2026-11-11T00:00:00Z';
const items=[
{id:1,quantity:'2',unit:'bag',requirements:'Grade A Rice'},
{id:2,quantity:'5',unit:'tin',requirements:'Grade 2 Oil'},
{id:3,quantity:'1',unit:'bag',requirements:'Fine Flour'}
];
const rice={supplier_sku_id:11,product_spec_id:21,purchasing_unit:'bag',brand:'Rice Supplier',quality_grade:'A'};
const oil={supplier_sku_id:12,product_spec_id:22,purchasing_unit:'tin',brand:'Oil Supplier',quality_grade:'2'};
const flour={supplier_sku_id:13,product_spec_id:23,purchasing_unit:'bag',brand:'Flour Supplier',quality_grade:'Fine'};
const line=(id,quantity,unit_price,snapshot)=>({
request_item_id:id,quantity,unit_price,snapshot
});
const quotes=[
{quote_id:101,supplier_id:7,version_number:1,status:'ACTIVE',
 valid_until:'2026-12-01T00:00:00Z',delivery_fee:'500',
 lines:[line(1,'2','4000.00',rice),line(2,'5','7000.00',oil),line(3,'1','2000.00',flour)]},
{quote_id:102,supplier_id:8,version_number:1,status:'ACTIVE',
 valid_until:'2026-12-01T00:00:00Z',delivery_fee:'300',
 lines:[line(2,'5','6900.00',oil),line(3,'1','1800.00',flour)]}
];
const choose=(itemId,quoteId,snapshot)=>({
 request_item_id:itemId,quote_id:quoteId,version_number:1,
 supplier_sku_id:snapshot.supplier_sku_id,product_spec_id:snapshot.product_spec_id,
 physical_specifications_accepted:true
});
const all=[choose(1,101,rice),choose(2,101,oil),choose(3,101,flour)];
const full=buildAwardPreview({requestItems:items,quoteVersions:quotes,selections:all,now});
check('Full basket generates one supplier group',full.supplier_count===1);
check('Full basket fee charged only once',full.supplier_delivery_total==='500.00');
check('Exact one-supplier price',full.supplier_quoted_total==='45500.00');
const split=buildAwardPreview({requestItems:items,quoteVersions:quotes,
 selections:[choose(1,101,rice),choose(2,102,oil),choose(3,102,flour)],now});
check('Split basket has two supplier groups',split.supplier_count===2);
check('Split basket sums two shipping charges once each',split.supplier_delivery_total==='800.00');
check('Exact supplier-quoted split cost',split.supplier_quoted_total==='45100.00');
check('No premature charge, order or stock lock',split.checkout_started===false&&
 split.inventory_reserved===false&&split.final_payable_authorized===false);
rejected('DUPLICATE_AWARD_LINE',()=>buildAwardPreview({requestItems:items,quoteVersions:quotes,
 selections:[choose(1,101,rice),choose(1,101,rice),choose(3,101,flour)],now}));
check('Duplicate line denied',true);
rejected('INCOMPLETE_AWARD_COVERAGE',()=>buildAwardPreview({requestItems:items,
 quoteVersions:quotes,selections:all.slice(0,2),now}));
check('Missing product denied',true);
rejected('SPECIFICATION_REAPPROVAL_REQUIRED',()=>buildAwardPreview({requestItems:items,
 quoteVersions:quotes,selections:[{...all[0],supplier_sku_id:999},...all.slice(1)],now}));
check('SKU identity changed requires reapproval',true);
rejected('EXPLICIT_SPEC_CONSENT_REQUIRED',()=>buildAwardPreview({requestItems:items,
 quoteVersions:quotes,selections:[{...all[0],physical_specifications_accepted:false},...all.slice(1)],now}));
check('Physical spec acceptance must be explicit',true);
rejected('QUOTE_VERSION_CHANGED',()=>buildAwardPreview({requestItems:items,
 quoteVersions:quotes,selections:[{...all[0],version_number:2},...all.slice(1)],now}));
check('Stale quote version denied',true);
rejected('QUOTE_NOT_AVAILABLE',()=>buildAwardPreview({requestItems:items,
 quoteVersions:[{...quotes[0],status:'WITHDRAWN'},quotes[1]],
 selections:all,now}));
check('Withdrawn quote denied',true);
rejected('QUOTE_NOT_AVAILABLE',()=>buildAwardPreview({requestItems:items,
 quoteVersions:[{...quotes[0],valid_until:'2026-10-01T00:00:00Z'},quotes[1]],
 selections:all,now}));
check('Expired quote denied',true);
console.log('B6 AWARD PREFLIGHT: '+n+'/'+n+' PASS (pure policy only)');
