-- PR61 Part 2: bounded per-buyer stock holds for collective pending-payment orders.
-- Existing orders are preserved (NULL deadline); only newly prepared group orders receive a lease.
ALTER TABLE procurement_collective_buyer_orders
  ADD COLUMN payment_expires_at DATETIME NULL,
  ADD COLUMN payment_hold_status ENUM(
    'ACTIVE','PAYMENT_PENDING','RECONCILIATION_REQUIRED','COMMITTED','RELEASED'
  ) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN checkout_started_at DATETIME NULL,
  ADD COLUMN payment_hold_released_at DATETIME NULL,
  ADD COLUMN payment_hold_release_reason VARCHAR(120) NULL,
  ADD KEY idx_pr61_collective_payment_expiry (payment_hold_status,payment_expires_at),
  ADD KEY idx_pr61_collective_order_payment_expiry (order_id,payment_expires_at);
