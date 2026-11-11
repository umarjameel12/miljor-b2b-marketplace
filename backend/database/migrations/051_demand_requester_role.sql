-- Integration sequence 051 (original demand 047): Preserve historical buyer_id FK while distinguishing the role of a pool requester.
-- Supplier-side "Request a Pool" was historically written to buyer_id, causing semantic confusion.
-- Non-destructive additive migration; old rows are classified using authoritative users.role.
ALTER TABLE demand_pool_requests
  ADD COLUMN requester_role ENUM('BUYER','SUPPLIER') NOT NULL DEFAULT 'BUYER' AFTER buyer_id;
UPDATE demand_pool_requests dpr
JOIN users u ON u.id=dpr.buyer_id
SET dpr.requester_role='SUPPLIER'
WHERE u.role='SUPPLIER';
-- Existing buyer_id remains a legacy requester foreign-key alias; do not drop or remap IDs.
