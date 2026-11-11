# MilJor — Concurrent Migration Reconciliation Safety Gate
Date: 2026-11-11
Branch: `fix/independent-backend-integrity`
Result: SAFETY GUARD IMPLEMENTED; SCHEMA RECONCILIATION BLOCKED / NOT TESTED.

## Actual collision observed on remote branches
| Version | Independent catalog-hardening branch | Concurrent B6 Phase 2 branch |
| --- | --- | --- |
| 046 | `046_expand_canonical_product_families.sql` | `046_recurring_collective_cycles.sql` |
| 047 | `047_demand_requester_role.sql` | `047_procurement_delivery_runs.sql` |
| 048 | Not in independent branch | `048_procurement_notification_outbox.sql` |

Comparing branch file names and SQL heads proves a collision, **not** that any version was applied to a database. No direct merge is authorized. Do not force-push or overwrite B6/other-chat work.

## Current fail-closed mechanism
- `database/migrationCollisionGuard.js` records the unresolved version ownership conflicts.
- `database/runMigrations.js` calls this check directly after local manifest validation, **before opening a MySQL connection**.
- If migration version 046 or 047 still corresponds to either known conflicting filename, abort with `MIGRATION_BRANCH_COLLISION_UNRESOLVED`.
- No bypass environment variable, implicit migration name mapping or auto-renumbering exists.
- Deferred unit gate: `tests/migration_collision_preflight_gate.js`.

## Safe reconciliation procedure (not executed)
1. Freeze only migration application (not concurrent development); notify B6 Phase 2 chat/agent that 046/047 are reserved differently on the separate fix branch.
2. Collect current Git SHAs and full SQL checksums, plus a read-only backup/restore plan.
3. Inspect *both* target databases' **actual** schema and history via read-only queries, only with appropriate credentials, e.g.:
   ```sql
   SELECT DATABASE();
   SHOW TABLES LIKE 'schema_migrations';
   SELECT version, name, applied_at FROM schema_migrations
     WHERE version IN ('045','046','047','048') ORDER BY version;
   SHOW TABLES LIKE 'procurement_recurring_collectives';
   SHOW TABLES LIKE 'procurement_order_delivery_runs';
   SHOW TABLES LIKE 'procurement_notifications';
   SELECT COUNT(*) FROM catalog_product_families
     WHERE is_active=1 AND approval_status='APPROVED';
   ```
   Do not assume these tables exist; avoid running selects against absent tables.
4. Classify each version in each database: NOT_APPLIED, APPLIED_CATALOG, APPLIED_B6, PARTIAL_OR_UNKNOWN. Confirm effects using schema and business data, not version numbers alone.
5. If neither branch's conflicting migrations were ever applied anywhere, agree a single append-only migration order and publish *new* uniquely numbered migration files on an approved integration branch. Do not rewrite historical migrations.
6. If either version was applied, preserve its original SQL filename/name/checksum and journal. Create separate future migrations for the missing changes, with explicit reconciliation after verifying current schema; never falsify `schema_migrations`.
7. Rehearse from backed-up isolated `miljor_test_db`; check existing orders, supplier SKUs, inventory, pools, collective bids and data counts for regressions.
8. Only after proof and both branch owners' coordination, update the collision guard to the reconciled filenames, and run the final integrated acceptance gate. Do not use real financial transfers.

## Verification status
No runtime tests, SQL, migrations or schema writes executed in this task. Source commits only. The guard intentionally blocks all normal migration attempts on this isolated branch while its unresolved names remain.

CAN START NEXT PHASE: NO — migration numbering and state still require reconciliation.
