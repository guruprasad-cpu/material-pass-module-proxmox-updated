-- Material Pass Module SQLite schema. Runtime migrations are also applied in server.js.
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user','approver')), created_at TEXT NOT NULL, company_name TEXT, contract_name TEXT, approver_name TEXT);
CREATE TABLE IF NOT EXISTS passes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_no TEXT UNIQUE NOT NULL, contract_name TEXT, company_name TEXT,
 direction TEXT, type TEXT, return_date TEXT, mode TEXT, escort_name TEXT, driver_name TEXT, driver_id TEXT,
 vehicle_no TEXT, vehicle_pass_no TEXT, issued_by TEXT, destination TEXT, status TEXT NOT NULL,
 created_at TEXT NOT NULL, approved_at TEXT, arrival_at TEXT, completed_at TEXT, pending_count REAL DEFAULT 0, created_by TEXT, approved_by_name TEXT, approved_signature_data TEXT, approver_reviewed_by TEXT, approver_reviewed_at TEXT, officer_authority TEXT, rejected_by TEXT, rejected_at TEXT, rejection_remark TEXT
);
CREATE TABLE IF NOT EXISTS duty_approvers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, signature_data TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_id INTEGER NOT NULL, sl_no INTEGER, description TEXT, uom TEXT,
 total_qty REAL, remarks TEXT, arrived_qty REAL DEFAULT 0, returned_qty REAL DEFAULT 0, item_status TEXT DEFAULT 'Pending',
 category TEXT DEFAULT 'General', asset_type TEXT, asset_brand TEXT, asset_model TEXT, asset_serial TEXT, asset_tag TEXT, asset_condition TEXT, asset_owner TEXT, asset_purpose TEXT,
 FOREIGN KEY(pass_id) REFERENCES passes(id)
);
-- Durable transaction history: each submission is kept separately from current item totals.
CREATE TABLE IF NOT EXISTS arrival_transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_id INTEGER NOT NULL,
 transaction_at TEXT NOT NULL, submitted_by_user_id INTEGER, submitted_by TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Pending Approval', approved_by TEXT, approved_at TEXT,
 rejected_by TEXT, rejected_at TEXT, rejection_remark TEXT, notes TEXT,
 FOREIGN KEY(pass_id) REFERENCES passes(id)
);
CREATE TABLE IF NOT EXISTS arrival_transaction_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, arrival_transaction_id INTEGER NOT NULL, item_id INTEGER NOT NULL,
 quantity_arrived REAL NOT NULL DEFAULT 0, original_quantity REAL NOT NULL DEFAULT 0, previous_arrived_qty REAL NOT NULL DEFAULT 0,
 remarks TEXT, escort_name TEXT, driver_name TEXT, driver_id TEXT, vehicle_no TEXT, vehicle_pass_no TEXT,
 FOREIGN KEY(arrival_transaction_id) REFERENCES arrival_transactions(id), FOREIGN KEY(item_id) REFERENCES items(id)
);
CREATE TABLE IF NOT EXISTS return_transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_id INTEGER NOT NULL,
 transaction_at TEXT NOT NULL, submitted_by_user_id INTEGER, submitted_by TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Pending Approval', approved_by TEXT, approved_at TEXT,
 rejected_by TEXT, rejected_at TEXT, rejection_remark TEXT, notes TEXT,
 FOREIGN KEY(pass_id) REFERENCES passes(id)
);
CREATE TABLE IF NOT EXISTS return_transaction_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, return_transaction_id INTEGER NOT NULL, item_id INTEGER NOT NULL,
 quantity_returned REAL NOT NULL DEFAULT 0, cumulative_returned_after REAL NOT NULL DEFAULT 0, previous_returned_qty REAL NOT NULL DEFAULT 0,
 pending_quantity_after REAL NOT NULL DEFAULT 0, remarks TEXT,
 FOREIGN KEY(return_transaction_id) REFERENCES return_transactions(id), FOREIGN KEY(item_id) REFERENCES items(id)
);
CREATE TABLE IF NOT EXISTS approval_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_id INTEGER NOT NULL, transaction_type TEXT NOT NULL,
 transaction_id INTEGER, action TEXT NOT NULL, actor_user_id INTEGER, actor_name TEXT NOT NULL,
 action_at TEXT NOT NULL, remark TEXT,
 FOREIGN KEY(pass_id) REFERENCES passes(id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_at TEXT NOT NULL, actor_user_id INTEGER,
 actor_name TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER,
 details_json TEXT, ip_address TEXT,
 FOREIGN KEY(actor_user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS login_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username_attempted TEXT NOT NULL, user_id INTEGER,
 attempted_at TEXT NOT NULL, success INTEGER NOT NULL, ip_address TEXT, user_agent TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS app_settings (
 setting_key TEXT PRIMARY KEY, setting_value TEXT, updated_at TEXT NOT NULL, updated_by INTEGER
);
CREATE TABLE IF NOT EXISTS attachments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_id INTEGER, item_id INTEGER,
 transaction_type TEXT, transaction_id INTEGER, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
 content BLOB NOT NULL, uploaded_at TEXT NOT NULL, uploaded_by INTEGER,
 FOREIGN KEY(pass_id) REFERENCES passes(id), FOREIGN KEY(item_id) REFERENCES items(id)
);
CREATE TABLE IF NOT EXISTS sessions (
 sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_pass_id ON items(pass_id);
CREATE INDEX IF NOT EXISTS idx_arrival_transactions_pass_id ON arrival_transactions(pass_id, transaction_at);
CREATE INDEX IF NOT EXISTS idx_arrival_transaction_items_tx ON arrival_transaction_items(arrival_transaction_id);
CREATE INDEX IF NOT EXISTS idx_return_transactions_pass_id ON return_transactions(pass_id, transaction_at);
CREATE INDEX IF NOT EXISTS idx_return_transaction_items_tx ON return_transaction_items(return_transaction_id);
CREATE INDEX IF NOT EXISTS idx_approval_history_pass_id ON approval_history(pass_id, action_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, event_at);
