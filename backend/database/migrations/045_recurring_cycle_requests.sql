-- B6-M: link an idempotently prepared recurring cycle to its fresh buyer draft.
-- Additive after migration 044; test DB only, never mutate miljor_db.
ALTER TABLE procurement_recurring_cycles
  ADD COLUMN generated_request_id BIGINT NULL DEFAULT NULL,
  ADD CONSTRAINT fk_proc_cycle_generated_request FOREIGN KEY (generated_request_id)
    REFERENCES procurement_requests(id),
  ADD UNIQUE KEY uq_proc_cycle_generated_request (generated_request_id);
