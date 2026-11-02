# Material Pass Module — SQLite Database Design

Database file: `data/material.db` (Docker path: `/app/data/material.db`). The application creates missing tables and adds compatible columns on startup. Keep a backup before deploying an updated server.

## Core operational tables

| Table | Purpose | Main fields / relationships |
|---|---|---|
| `users` | Login accounts and roles | `id`, `username`, `password_hash`, `role`, `company_name`, `contract_name`, `approver_name`, `created_at` |
| `passes` | One record per material pass | `id`, `pass_no`, company/contract, direction, type, return date, transport details, status, creation/approval/arrival/completion timestamps, rejection details |
| `items` | Material or asset lines on a pass; stores current totals | `id`, `pass_id`, description, unit, `approved_qty`, `arrived_qty`, `returned_qty`, status, IT asset fields |
| `duty_approvers` | Duty approver names and signature images | `id`, `name`, `signature_data`, active flag, creation timestamp |

## Unified transaction history

| Table | Purpose |
|---|---|
| `transactions` | One row per arrival or return submission. `type_of_transaction` is `arrival` or `return`; common fields store submitter, time, status, approver/rejection details, notes, and vehicle/driver details. |
| `transaction_items` | One row per material item included in a transaction. `qty` is the transaction quantity; `remarks` stores the item note. It intentionally does not store separate arrived/returned/cumulative/pending quantity columns. |

`transactions.id` is referenced by `transaction_items.transaction_id`. Each `transaction_items` row also references `items.id`. For arrival transactions, `qty` represents the submitted arrived quantity. For return transactions, `qty` represents the quantity returned in that transaction (the difference from the prior cumulative returned quantity). Current totals remain on `items.approved_qty`, `items.arrived_qty`, and `items.returned_qty`.

## Audit and supporting data

| Table | Purpose |
|---|---|
| `approval_history` | Append-only record of approval/rejection actions linked to the pass and relevant transaction |
| `audit_logs` | Key application actions, actor, timestamp, entity and structured details |
| `login_history` | Successful and failed login attempts with timestamp, username and request metadata |
| `app_settings` | Key/value application settings and update timestamp |
| `attachments` | Database-backed file content for future/implemented attachment workflows; binary content is stored as a BLOB |
| `sessions` | Express login sessions persisted in SQLite with expiry time |

## Data integrity notes

- The server creates these tables if they do not exist and retains the existing `users`, `passes`, `items`, and `duty_approvers` data.
- Existing databases only contain the historical detail that was previously saved. Earlier versions overwrote cumulative arrival/return quantities, so the exact sequence and timestamps of older partial transactions cannot be reconstructed from those totals alone. New submissions are recorded as separate transactions going forward.
- The current item totals are a convenience snapshot. `transactions` and `transaction_items` preserve per-submission history. On startup, the application migrates records from the legacy split transaction tables into the unified tables and then removes the legacy tables.
- Use the SQLite database file in the persistent `data` volume. Do not replace it with an empty database during deployment.
- Back up `material.db` before migration. Test the update on a copy before using it with official records.

## Useful inspection commands

```bash
sqlite3 data/material.db ".tables"
sqlite3 data/material.db ".schema"
sqlite3 data/material.db "PRAGMA foreign_key_check;"
```
