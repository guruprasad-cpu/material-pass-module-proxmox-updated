# Client Observation Update

## Included in this package
- Added the supplied Indian Navy Project Seabird logo to the login screen (large) and application header (small, top-left).
- Added the logo to generated pass PDFs.
- PDF signature boxes for Contractor, Engineer and PIMT now appear when the pass is first created, rather than waiting for completion.
- Replaced `items.total_qty` with `items.approved_qty` throughout the application and schema.
- Added a migration that copies legacy `total_qty` values into `approved_qty` and attempts to drop the old column.
- Removed `passes.pending_count` from the new schema and application writes. Pending return quantity is calculated from item quantities during hydration.
- Added vehicle/driver fields to return transactions and exposed the same vehicle detail form for return submissions.

## Deployment safety
Back up the live database before deploying any schema change. Test login, create pass, arrival submission/approval, return submission/approval, rejection, PDF, and report exports on a test copy first.


## Client observations 4 and 5 — implemented

- Arrival and return headers are stored in the unified `transactions` table with `type_of_transaction` set to `arrival` or `return`.
- Item-level quantities are stored in the unified `transaction_items` table with one quantity column named `qty`, plus transaction/item references and remarks.
- Existing databases are migrated on application startup: legacy arrival/return records are copied into the unified tables, approval-history and attachment transaction references are remapped, and legacy split tables are dropped after successful copying.
- The API continues to provide arrival and return arrays for the current UI while sourcing both from the unified table.
- Transaction item quantities are held pending in `transaction_items.qty`; the current item totals in `items` are updated when an approver approves the corresponding transaction. Rejected transactions do not apply their pending quantities to current item totals.
- Before production rollout, back up the SQLite database and test the migration on a copy.
