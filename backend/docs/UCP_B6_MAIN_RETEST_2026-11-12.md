# UCP + B6 clean main retest — 2026-11-12

Audit target: exact current main commit `f94825e2bcd5ce40e37b682fd7980c04478780ff`.

Purpose: fresh GitHub PR-triggered existing acceptance workflows, with no code changes, no migration edits and no protected MySQL writes. Test disposable `miljor_test_db` and UCP Regular/Flash business contracts, stock allocation concurrency, canonical migrations, supplier SKU ownership, B6 private RFQ/quotes/award/synthetic paid fulfillment, invoice and 100/80/20 dispute/refund safety. Record actual workflow run links and identify PASS vs BLOCKED; synthetic Safepay callback is not provider-originated evidence.

Forbidden: pushing to main, running against `miljor_db`/`miljor_sandbox_db`, external payouts, treating mock tests as real PSP certification, or merging unreviewed branches.
