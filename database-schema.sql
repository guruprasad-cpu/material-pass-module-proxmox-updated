-- Material Pass Module SQLite schema. Runtime migrations are also applied in server.js.
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user','approver')), created_at TEXT NOT NULL, company_name TEXT, contract_name TEXT, approver_name TEXT);
CREATE TABLE IF NOT EXISTS passes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_no TEXT UNIQUE NOT NULL, contract_name TEXT, company_name TEXT,
 direction TEXT, type TEXT, return_date TEXT, mode TEXT, escort_name TEXT, driver_name TEXT, driver_id TEXT,
 vehicle_no TEXT, vehicle_pass_no TEXT, issued_by TEXT, destination TEXT, status TEXT NOT NULL,
 created_at TEXT NOT NULL, approved_at TEXT, arrival_at TEXT, completed_at TEXT, created_by TEXT, approved_by_name TEXT, approved_signature_data TEXT, approver_reviewed_by TEXT, approver_reviewed_at TEXT, officer_authority TEXT, rejected_by TEXT, rejected_at TEXT, rejection_remark TEXT
);
CREATE TABLE IF NOT EXISTS duty_approvers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, signature_data TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_id INTEGER NOT NULL, sl_no INTEGER, description TEXT, uom TEXT,
 approved_qty REAL, remarks TEXT, arrived_qty REAL DEFAULT 0, returned_qty REAL DEFAULT 0, item_status TEXT DEFAULT 'Pending',
 category TEXT DEFAULT 'General', asset_type TEXT, asset_brand TEXT, asset_model TEXT, asset_serial TEXT, asset_tag TEXT, asset_condition TEXT, asset_owner TEXT, asset_purpose TEXT,
 FOREIGN KEY(pass_id) REFERENCES passes(id)
);
-- Unified transaction history for both arrival and return submissions.
CREATE TABLE IF NOT EXISTS transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_id INTEGER NOT NULL,
 type_of_transaction TEXT NOT NULL CHECK(type_of_transaction IN ('arrival','return')),
 transaction_at TEXT NOT NULL, submitted_by_user_id INTEGER, submitted_by TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Pending Approval', approved_by TEXT, approved_at TEXT,
 rejected_by TEXT, rejected_at TEXT, rejection_remark TEXT, notes TEXT,
 escort_name TEXT, driver_name TEXT, driver_id TEXT, vehicle_no TEXT, vehicle_pass_no TEXT,
 FOREIGN KEY(pass_id) REFERENCES passes(id)
);
CREATE TABLE IF NOT EXISTS transaction_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER NOT NULL, item_id INTEGER NOT NULL,
 qty REAL NOT NULL DEFAULT 0, remarks TEXT,
 FOREIGN KEY(transaction_id) REFERENCES transactions(id), FOREIGN KEY(item_id) REFERENCES items(id),
 UNIQUE(transaction_id,item_id)
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
CREATE INDEX IF NOT EXISTS idx_transactions_pass_id ON transactions(pass_id, transaction_at);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type_of_transaction, status);
CREATE INDEX IF NOT EXISTS idx_transaction_items_tx ON transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_item ON transaction_items(item_id);
CREATE INDEX IF NOT EXISTS idx_approval_history_pass_id ON approval_history(pass_id, action_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, event_at);
