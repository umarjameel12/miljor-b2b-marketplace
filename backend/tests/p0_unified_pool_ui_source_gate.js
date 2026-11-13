'use strict';
// Static integration guard: buyer/supplier UX is one public pool experience.
// B4/B5 stock and payment engines intentionally remain contract-specific.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../../frontend/src');
const read=p=>fs.readFileSync(path.join(dir,p),'utf8');
const buyer=read('pages/PoolsPage.jsx'),card=read('components/pools/BuyerPoolCard.jsx');
const supplier=read('pages/SupplierPoolsPage.jsx'),legacy=read('pages/FlashPoolsPage.jsx');
assert.match(legacy,/to="\/pools"/);
assert.doesNotMatch(legacy,/type=FLASH/);
assert.match(buyer,/\[poolType,setPoolType\]=useState\('ALL'\)/);
assert.match(buyer,/Unified Pool subcategories/);
assert.match(buyer,/\['REGULAR','Regular'\]/);
assert.match(buyer,/\['FLASH','Flash'\]/);
assert.doesNotMatch(buyer,/Choose pool type|Regular Pools|Flash Pools/);
assert.match(card,/>Pool<\/span>/);
assert.match(card,/>Pool participation<\/h3>/);
assert.match(card,/holdFlash\(/,'Preserve real ready-stock hold contract');
assert.match(card,/apiClient.post\('\/reservations'/,'Preserve real grouped reservation contract');
assert.match(card,/15-minute stock hold/,'Do not hide actual hold duration');
assert.match(supplier,/Pool Management/);
assert.match(supplier,/Create.*Pool Draft/);
assert.match(supplier,/Regular Pool/);
assert.match(supplier,/Flash Pool/);
assert.match(supplier,/saveRegularDraft/);
assert.match(supplier,/saveFlashDraft/);
assert.doesNotMatch(supplier,/two independent supplier-owned pool engines/);
const orders=read('pages/OrdersPage.jsx');
const readyOrders=read('components/pools/FlashBuyerOrdersPanel.jsx');
const supplierDashboard=read('pages/SupplierDashboardPage.jsx');
const supplierOperations=read('components/supplier/SupplierPoolOperationsPanel.jsx');
assert.doesNotMatch(orders,/Your Regular Pool Payments|No Regular Pool Orders Yet/);
assert.doesNotMatch(readyOrders,/Flash Pool Orders/);
assert.doesNotMatch(supplierDashboard,/Manage Regular & Flash Pools/);
assert.doesNotMatch(supplierOperations,/>Regular Pools<|>Flash Pools</);

console.log('PASS unified buyer/supplier pool UX source contract; no separate public discovery route, backend-specific financial invariants preserved');
