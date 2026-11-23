-- Rollback for 099_ucp_phase_c_delivery_reliability.sql (isolated test verification only)
DROP TABLE IF EXISTS delivery_amendments;
DROP TABLE IF EXISTS delivery_attempts;
DROP TABLE IF EXISTS delivery_run_stops;
DROP TABLE IF EXISTS delivery_runs;
