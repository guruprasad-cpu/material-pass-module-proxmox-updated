import express from 'express'
import Database from 'better-sqlite3'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import bcrypt from 'bcryptjs'
import session from 'express-session'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '5mb' }))
const dbPath = process.env.DB_PATH || path.join(__dirname, 'material.db')
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
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
-- Unified transaction history: arrival and return share one header table.
CREATE TABLE IF NOT EXISTS transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, pass_id INTEGER NOT NULL, type_of_transaction TEXT NOT NULL CHECK(type_of_transaction IN ('arrival','return')),
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
`)
// Persist login sessions in SQLite instead of Express's in-memory default store.
class SQLiteSessionStore extends session.Store {
 constructor(database){super();this.database=database;this.getStmt=database.prepare('SELECT sess, expires_at FROM sessions WHERE sid=?');this.setStmt=database.prepare('INSERT INTO sessions(sid,sess,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires_at=excluded.expires_at');this.destroyStmt=database.prepare('DELETE FROM sessions WHERE sid=?');this.touchStmt=database.prepare('UPDATE sessions SET expires_at=? WHERE sid=?');}
 get(sid,callback){try{const row=this.getStmt.get(sid);if(!row)return callback(null,null);if(row.expires_at<=Date.now()){this.destroyStmt.run(sid);return callback(null,null)}callback(null,JSON.parse(row.sess))}catch(e){callback(e)}}
 set(sid,sess,callback=()=>{}){try{const expires=sess.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+Number(sess.cookie?.maxAge||86400000);this.setStmt.run(sid,JSON.stringify(sess),expires);callback(null)}catch(e){callback(e)}}
 destroy(sid,callback=()=>{}){try{this.destroyStmt.run(sid);callback(null)}catch(e){callback(e)}}
 touch(sid,sess,callback=()=>{}){try{const expires=sess.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+Number(sess.cookie?.maxAge||86400000);this.touchStmt.run(expires,sid);callback(null)}catch(e){callback(e)}}
}
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
app.use(session({ store:new SQLiteSessionStore(db), secret:process.env.SESSION_SECRET || 'change-this-session-secret-before-production', resave:false, saveUninitialized:false, cookie:{httpOnly:true,sameSite:'lax',maxAge:24*60*60*1000} }));

// Expand the legacy role constraint to include Approver accounts while preserving existing users.
const usersTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
if (usersTableSql && !usersTableSql.includes("'approver'")) {
  const oldCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  db.exec('ALTER TABLE users RENAME TO users_legacy_role_migration');
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user','approver')), created_at TEXT NOT NULL, company_name TEXT, contract_name TEXT, approver_name TEXT)");
  const keep = ['id','username','password_hash','role','created_at','company_name','contract_name','approver_name'].filter(c => oldCols.includes(c));
  db.exec(`INSERT INTO users (${keep.join(',')}) SELECT ${keep.join(',')} FROM users_legacy_role_migration`);
  db.exec('DROP TABLE users_legacy_role_migration');
}
// Safe, additive schema migration for databases created by the earlier version.
const addColumn = (table, name, type) => { const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`) }
// Migrate quantity naming and remove the redundant pass-level pending counter.
{
 const itemCols = db.prepare('PRAGMA table_info(items)').all().map(c=>c.name);
 if (!itemCols.includes('approved_qty')) {
   if (itemCols.includes('total_qty')) { db.exec('ALTER TABLE items ADD COLUMN approved_qty REAL'); db.exec('UPDATE items SET approved_qty=total_qty'); }
   else db.exec('ALTER TABLE items ADD COLUMN approved_qty REAL DEFAULT 0');
 }
 try { if (db.prepare('PRAGMA table_info(items)').all().some(c=>c.name==='total_qty')) db.exec('ALTER TABLE items DROP COLUMN total_qty') } catch(e) { console.warn('Legacy total_qty column retained because this SQLite version cannot drop columns:', e.message) }
 const passCols = db.prepare('PRAGMA table_info(passes)').all().map(c=>c.name);
 try { if (passCols.includes('pending_count')) db.exec('ALTER TABLE passes DROP COLUMN pending_count') } catch(e) { console.warn('Legacy pending_count column retained because this SQLite version cannot drop columns:', e.message) }
}
addColumn('users', 'company_name', 'TEXT')
addColumn('users', 'contract_name', 'TEXT')
addColumn('users', 'approver_name', 'TEXT')
// One-time migration from the old split transaction tables. Legacy tables are removed only after data is copied.
{
 const tableExists = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
 const txCols = db.prepare('PRAGMA table_info(transactions)').all().map(c=>c.name);
 for (const [n,t] of [['escort_name','TEXT'],['driver_name','TEXT'],['driver_id','TEXT'],['vehicle_no','TEXT'],['vehicle_pass_no','TEXT']]) if(!txCols.includes(n)) db.exec(`ALTER TABLE transactions ADD COLUMN ${n} ${t}`);
 const oldArrival=tableExists('arrival_transactions'), oldReturn=tableExists('return_transactions');
 const oldArrivalItems=tableExists('arrival_transaction_items'), oldReturnItems=tableExists('return_transaction_items');
 if (oldArrival || oldReturn) {
  const migrate=db.transaction(()=>{
   const idMaps={arrival:new Map(),return:new Map()};
   if(oldArrival){ for(const r of db.prepare('SELECT * FROM arrival_transactions ORDER BY id').all()){
    const info=db.prepare(`INSERT INTO transactions(pass_id,type_of_transaction,transaction_at,submitted_by_user_id,submitted_by,status,approved_by,approved_at,rejected_by,rejected_at,rejection_remark,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.pass_id,'arrival',r.transaction_at,r.submitted_by_user_id,r.submitted_by,r.status,r.approved_by,r.approved_at,r.rejected_by,r.rejected_at,r.rejection_remark,r.notes);
    idMaps.arrival.set(r.id,Number(info.lastInsertRowid));
   }}
   if(oldReturn){ for(const r of db.prepare('SELECT * FROM return_transactions ORDER BY id').all()){
    const info=db.prepare(`INSERT INTO transactions(pass_id,type_of_transaction,transaction_at,submitted_by_user_id,submitted_by,status,approved_by,approved_at,rejected_by,rejected_at,rejection_remark,notes,escort_name,driver_name,driver_id,vehicle_no,vehicle_pass_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.pass_id,'return',r.transaction_at,r.submitted_by_user_id,r.submitted_by,r.status,r.approved_by,r.approved_at,r.rejected_by,r.rejected_at,r.rejection_remark,r.notes,r.escort_name||null,r.driver_name||null,r.driver_id||null,r.vehicle_no||null,r.vehicle_pass_no||null);
    idMaps.return.set(r.id,Number(info.lastInsertRowid));
   }}
   if(oldArrivalItems){ for(const r of db.prepare('SELECT * FROM arrival_transaction_items ORDER BY id').all()){
    const tid=idMaps.arrival.get(r.arrival_transaction_id); if(tid) db.prepare('INSERT OR IGNORE INTO transaction_items(transaction_id,item_id,qty,remarks) VALUES(?,?,?,?)').run(tid,r.item_id,r.quantity_arrived,r.remarks||null);
    const parent=oldArrival?db.prepare('SELECT status FROM arrival_transactions WHERE id=?').get(r.arrival_transaction_id):null; if(parent?.status==='Pending Approval' && r.previous_arrived_qty!==undefined) db.prepare('UPDATE items SET arrived_qty=? WHERE id=?').run(Number(r.previous_arrived_qty||0),r.item_id);
    if(r.escort_name||r.driver_name||r.driver_id||r.vehicle_no||r.vehicle_pass_no){ if(tid) db.prepare('UPDATE transactions SET escort_name=?,driver_name=?,driver_id=?,vehicle_no=?,vehicle_pass_no=? WHERE id=?').run(r.escort_name||null,r.driver_name||null,r.driver_id||null,r.vehicle_no||null,r.vehicle_pass_no||null,tid); }
   }}
   if(oldReturnItems){ for(const r of db.prepare('SELECT * FROM return_transaction_items ORDER BY id').all()){
    const tid=idMaps.return.get(r.return_transaction_id); if(tid) db.prepare('INSERT OR IGNORE INTO transaction_items(transaction_id,item_id,qty,remarks) VALUES(?,?,?,?)').run(tid,r.item_id,r.quantity_returned,r.remarks||null);
    const parent=oldReturn?db.prepare('SELECT status FROM return_transactions WHERE id=?').get(r.return_transaction_id):null; if(parent?.status==='Pending Approval' && r.previous_returned_qty!==undefined) db.prepare('UPDATE items SET returned_qty=? WHERE id=?').run(Number(r.previous_returned_qty||0),r.item_id);
   }}
   // Keep approval history and attachment references pointing at the migrated transaction IDs.
   for(const [type,map] of [['arrival',idMaps.arrival],['return',idMaps.return]]) for(const [oldId,newId] of map){
    db.prepare('UPDATE approval_history SET transaction_id=? WHERE transaction_type=? AND transaction_id=?').run(newId,type,oldId);
    db.prepare('UPDATE attachments SET transaction_id=? WHERE transaction_type=? AND transaction_id=?').run(newId,type,oldId);
   }
   if(oldArrivalItems) db.exec('DROP TABLE arrival_transaction_items');
   if(oldReturnItems) db.exec('DROP TABLE return_transaction_items');
   if(oldArrival) db.exec('DROP TABLE arrival_transactions');
   if(oldReturn) db.exec('DROP TABLE return_transactions');
  }); migrate();
 }
}
for (const [n,t] of [['created_by','TEXT'],['approved_by_name','TEXT'],['approved_signature_data','TEXT'],['approver_reviewed_by','TEXT'],['approver_reviewed_at','TEXT'],['officer_authority','TEXT'],['rejected_by','TEXT'],['rejected_at','TEXT'],['rejection_remark','TEXT']]) addColumn('passes', n, t)
for (const [n,t] of [['category',"TEXT DEFAULT 'General'"],['asset_type','TEXT'],['asset_brand','TEXT'],['asset_model','TEXT'],['asset_serial','TEXT'],['asset_tag','TEXT'],['asset_condition','TEXT'],['asset_owner','TEXT'],['asset_purpose','TEXT']]) addColumn('items',n,t)
// Map legacy pass states to the current record-first workflow without losing pass history.
db.prepare("UPDATE passes SET status='Recorded - Pending Arrival' WHERE status IN ('Pending Approval','Pending Admin Approval','Approved - Pending Arrival')").run()
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) db.prepare('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)').run('admin', bcrypt.hashSync('Admin@123', 10), 'admin', new Date().toISOString())

const auth = (req,res,next) => req.session.user ? next() : res.status(401).json({error:'Please log in first'})
const adminOnly = (req,res,next) => req.session.user?.role === 'admin' ? next() : res.status(403).json({error:'Administrator access required'})
const nextPass = (contractorName) => {
 const year = new Date().getFullYear();
 const contractor = String(contractorName || 'CONTRACTOR').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'CONTRACTOR';
 const prefix = `MP-${year}-${contractor}-`;
 const existing = db.prepare('SELECT pass_no FROM passes WHERE pass_no LIKE ?').all(`${prefix}%`);
 const highest = existing.reduce((max, row) => {
   if (!String(row.pass_no).startsWith(prefix)) return max;
   const match = String(row.pass_no).match(/-(\d+)$/);
   return match ? Math.max(max, Number(match[1])) : max;
 }, 0);
 return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
const hydrate = id => {
 const pass = db.prepare('SELECT * FROM passes WHERE id=?').get(id); if (!pass) return null;
 pass.items = db.prepare('SELECT * FROM items WHERE pass_id=? ORDER BY sl_no').all(id);
  pass.pending_count = pass.items.reduce((sum,i)=>sum + Math.max(0, Number(i.arrived_qty||0)-Number(i.returned_qty||0)), 0);
 const allTransactions = db.prepare('SELECT * FROM transactions WHERE pass_id=? ORDER BY transaction_at,id').all(id);
 for (const tx of allTransactions) {
  tx.items = db.prepare('SELECT ti.*,i.description,i.uom,i.sl_no FROM transaction_items ti JOIN items i ON i.id=ti.item_id WHERE ti.transaction_id=? ORDER BY i.sl_no').all(tx.id);
  for (const item of tx.items) {
   if (tx.type_of_transaction === 'arrival') item.quantity_arrived = item.qty;
   else { item.quantity_returned = item.qty; item.pending_quantity_after = Math.max(0, Number(db.prepare('SELECT arrived_qty-returned_qty AS n FROM items WHERE id=?').get(item.item_id)?.n || 0)); }
  }
 }
 pass.transactions = allTransactions;
 pass.arrival_transactions = allTransactions.filter(t=>t.type_of_transaction==='arrival');
 pass.return_transactions = allTransactions.filter(t=>t.type_of_transaction==='return');
 return pass;
}
const canAccessPass = (req, pass) => !!pass && (['admin','approver'].includes(req.session.user?.role) || (req.session.user?.role==='user' && !!req.session.user?.company_name && String(pass.company_name||'').trim().toLowerCase() === String(req.session.user.company_name).trim().toLowerCase() && String(pass.contract_name||'').trim().toLowerCase() === String(req.session.user.contract_name||'').trim().toLowerCase()))
const audit = (req, action, entityType, entityId, details={}) => db.prepare('INSERT INTO audit_logs(event_at,actor_user_id,actor_name,action,entity_type,entity_id,details_json,ip_address) VALUES(?,?,?,?,?,?,?,?)').run(new Date().toISOString(),req.session?.user?.id||null,req.session?.user?.username||null,action,entityType,entityId,JSON.stringify(details),req.ip||null)
const recordApproval = (passId, type, transactionId, action, user, at, remark=null) => db.prepare('INSERT INTO approval_history(pass_id,transaction_type,transaction_id,action,actor_user_id,actor_name,action_at,remark) VALUES(?,?,?,?,?,?,?,?)').run(passId,type,transactionId,action,user?.id||null,user?.approver_name||user?.username||'System',at,remark)

app.get('/api/auth/me',(req,res)=>res.json({user:req.session.user || null}))
app.post('/api/auth/login', (req,res)=>{
 const username=String(req.body?.username||'').trim(), password=String(req.body?.password||'');
 const u=db.prepare('SELECT id,username,password_hash,role,company_name,contract_name,approver_name FROM users WHERE lower(username)=lower(?)').get(username);
 let valid=false;
 if(u){try{valid=/^\$2[aby]\$/.test(u.password_hash) ? bcrypt.compareSync(password,u.password_hash) : password===u.password_hash;}catch{valid=false}}
 if(!u||!valid)return res.status(401).json({error:'Invalid username or password. Check the username and password, or ask the administrator to reset the account.'});
 // Upgrade legacy plain-text passwords to bcrypt after a successful login.
 if(!/^\$2[aby]\$/.test(u.password_hash))db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,10),u.id);
 db.prepare('INSERT INTO login_history(username_attempted,user_id,attempted_at,success,ip_address,user_agent) VALUES(?,?,?,?,?,?)').run(username,u.id,new Date().toISOString(),1,req.ip||null,req.get('user-agent')||null);req.session.user={id:u.id,username:u.username,role:u.role,company_name:u.company_name||'',contract_name:u.contract_name||'',approver_name:u.approver_name||''};
 req.session.save(err=>{if(err)return res.status(500).json({error:'Could not start login session. Please try again.'});res.json({user:req.session.user})});
})
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})))
app.get('/api/users',auth,adminOnly,(req,res)=>res.json(db.prepare('SELECT id,username,role,company_name,contract_name,approver_name,created_at FROM users ORDER BY id').all()))
app.post('/api/users',auth,adminOnly,(req,res)=>{
 const {username,password,role}=req.body||{}; const companyName=String(req.body?.company_name||'').trim(), contractName=String(req.body?.contract_name||'').trim(), approverName=String(req.body?.approver_name||'').trim();
 if(!username||String(username).trim().length<3||!password||String(password).length<8||!['admin','user','approver'].includes(role))return res.status(400).json({error:'Username must be 3+ characters, password 8+ characters, and select a valid role.'});
 if(role==='user'&&(!companyName||!contractName))return res.status(400).json({error:'Enter both company name and contract name for User accounts.'});
 if(role==='approver'&&approverName.length<2)return res.status(400).json({error:'Enter the approver name.'});
 try{const info=db.prepare('INSERT INTO users(username,password_hash,role,created_at,company_name,contract_name,approver_name) VALUES(?,?,?,?,?,?,?)').run(String(username).trim(),bcrypt.hashSync(String(password),10),role,new Date().toISOString(),role==='user'?companyName:null,role==='user'?contractName:null,role==='approver'?approverName:null);res.status(201).json({id:info.lastInsertRowid,username:String(username).trim(),role,company_name:role==='user'?companyName:'',contract_name:role==='user'?contractName:'',approver_name:role==='approver'?approverName:''})}catch{res.status(409).json({error:'That username already exists'})}
})
app.patch('/api/users/:id/password',auth,adminOnly,(req,res)=>{const password=String(req.body?.password||'');if(password.length<8)return res.status(400).json({error:'Password must be at least 8 characters.'});const target=db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);if(!target)return res.status(404).json({error:'User not found'});db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,10),req.params.id);res.json({ok:true})})
app.patch('/api/users/:id/company',auth,adminOnly,(req,res)=>{const company=String(req.body?.company_name||'').trim(),contract=String(req.body?.contract_name||'').trim();const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id);if(!target)return res.status(404).json({error:'User not found'});if(target.role==='user'&&(!company||!contract))return res.status(400).json({error:'Company and contract are required for User accounts.'});db.prepare('UPDATE users SET company_name=?,contract_name=? WHERE id=?').run(target.role==='user'?company:null,target.role==='user'?contract:null,req.params.id);res.json({ok:true,company_name:target.role==='user'?company:'',contract_name:target.role==='user'?contract:''})})
app.delete('/api/users/:id',auth,adminOnly,(req,res)=>{ if(Number(req.params.id)===req.session.user.id)return res.status(400).json({error:'You cannot delete your own logged-in account'}); const u=db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id); if(!u)return res.status(404).json({error:'User not found'}); db.prepare('DELETE FROM users WHERE id=?').run(req.params.id); res.json({ok:true}) })
app.get('/api/duty-approvers',auth,(req,res)=>res.json(db.prepare('SELECT id,name,signature_data,active,created_at FROM duty_approvers WHERE active=1 ORDER BY name COLLATE NOCASE').all()))
app.post('/api/duty-approvers',auth,adminOnly,(req,res)=>{const name=String(req.body?.name||'').trim(),signature=String(req.body?.signature_data||'');if(name.length<2)return res.status(400).json({error:'Enter the duty person name.'});if(!/^data:image\/(png|jpeg|jpg);base64,/.test(signature))return res.status(400).json({error:'Upload a PNG or JPG signature image.'});if(signature.length>4_000_000)return res.status(400).json({error:'Signature image is too large. Please upload an image under 1 MB.'});const info=db.prepare('INSERT INTO duty_approvers(name,signature_data,created_at) VALUES(?,?,?)').run(name,signature,new Date().toISOString());res.status(201).json({id:info.lastInsertRowid,name,active:1})})
app.delete('/api/duty-approvers/:id',auth,adminOnly,(req,res)=>{const info=db.prepare('UPDATE duty_approvers SET active=0 WHERE id=?').run(req.params.id);if(!info.changes)return res.status(404).json({error:'Duty approver not found'});res.json({ok:true})})

app.get('/api/passes',auth,(req,res)=>{ const {status,search}=req.query; let sql='SELECT * FROM passes WHERE 1=1',args=[]; if(req.session.user.role==='user'){sql+=' AND lower(trim(company_name))=lower(trim(?)) AND lower(trim(contract_name))=lower(trim(?))';args.push(req.session.user.company_name||'__no_company__',req.session.user.contract_name||'__no_contract__')} if(status){sql+=' AND status=?';args.push(status)} if(search){sql+=' AND (pass_no LIKE ? OR company_name LIKE ? OR contract_name LIKE ?)';const s=`%${search}%`;args.push(s,s,s)} sql+=' ORDER BY id DESC'; res.json(db.prepare(sql).all(...args)) })
app.get('/api/dashboard',auth,(req,res)=>{
 const {from,to,company,material,category,status,direction,search}=req.query;
 let rows=db.prepare('SELECT * FROM passes ORDER BY id DESC').all();
 const includes=(value,needle)=>String(value??'').toLowerCase().includes(String(needle??'').toLowerCase());
 const includesExactCompany=(value,companyName)=>!!companyName&&String(value??'').trim().toLowerCase()===String(companyName).trim().toLowerCase();
 rows=rows.filter(p=>{
  const day=String(p.created_at||'').slice(0,10);
  if(from&&day<from)return false; if(to&&day>to)return false;
  if(req.session.user.role==='user'&&(!includesExactCompany(p.company_name,req.session.user.company_name)||String(p.contract_name||'').trim().toLowerCase()!==String(req.session.user.contract_name||'').trim().toLowerCase()))return false;
  if(req.session.user.role==='admin'&&company&&!includes(p.company_name,company))return false;
  if(status&&p.status!==status)return false; if(direction&&!(direction==='IN'?['IN','Entry'].includes(p.direction):direction==='OUT'?['OUT','Exit'].includes(p.direction):p.direction===direction))return false;
  const full=hydrate(p.id);
  if(category&&!full.items.some(i=>i.category===category))return false;
  if(material&&!full.items.some(i=>[i.description,i.category,i.uom,i.remarks,i.asset_type,i.asset_brand,i.asset_model,i.asset_serial,i.asset_tag,i.asset_condition,i.asset_owner,i.asset_purpose].some(v=>includes(v,material))))return false;
  if(search){const passFields=[p.pass_no,p.contract_name,p.company_name,p.direction,p.type,p.return_date,p.mode,p.escort_name,p.driver_name,p.driver_id,p.vehicle_no,p.vehicle_pass_no,p.issued_by,p.destination,p.status,p.created_by];const itemFields=full.items.flatMap(i=>[i.description,i.category,i.uom,i.remarks,i.asset_type,i.asset_brand,i.asset_model,i.asset_serial,i.asset_tag,i.asset_condition,i.asset_owner,i.asset_purpose]);if(![...passFields,...itemFields].some(v=>includes(v,search)))return false}
  return true;
 });
 const detailed=rows.map(p=>hydrate(p.id));
 const companyItems=new Map(), materialTotals=new Map(); let passQty=0,arrivedQty=0,returnedQty=0;
 for(const p of detailed)for(const i of p.items){const key=`${p.company_name||'Unknown company'}|||${i.description||'Unnamed item'}|||${i.uom||''}`;const a=companyItems.get(key)||{company_name:p.company_name||'Unknown company',description:i.description||'Unnamed item',uom:i.uom||'',category:i.category||'General',quantity:0,arrived_qty:0,returned_qty:0,pass_count:0};a.quantity+=Number(i.approved_qty||0);a.arrived_qty+=Number(i.arrived_qty||0);a.returned_qty+=Number(i.returned_qty||0);a.pass_count+=1;companyItems.set(key,a);const mk=`${i.description||'Unnamed item'}|||${i.uom||''}`;const m=materialTotals.get(mk)||{description:i.description||'Unnamed item',uom:i.uom||'',quantity:0,company_count:new Set(),pass_count:0};m.quantity+=Number(i.approved_qty||0);m.company_count.add(p.company_name||'Unknown company');m.pass_count++;materialTotals.set(mk,m);passQty+=Number(i.approved_qty||0);arrivedQty+=Number(i.arrived_qty||0);returnedQty+=Number(i.returned_qty||0)}
 res.json({summary:{pass_count:detailed.length,item_lines:detailed.reduce((n,p)=>n+p.items.length,0),pass_qty:passQty,arrived_qty:arrivedQty,returned_qty:returnedQty,pending_qty:Math.max(0,passQty-arrivedQty)},passes:detailed,companyItems:[...companyItems.values()].sort((a,b)=>a.company_name.localeCompare(b.company_name)||a.description.localeCompare(b.description)),materialTotals:[...materialTotals.values()].map(m=>({...m,company_count:m.company_count.size})).sort((a,b)=>b.quantity-a.quantity)});
})
app.get('/api/passes/:id',auth,(req,res)=>{const p=hydrate(req.params.id);if(!p)return res.status(404).json({error:'Pass not found'});if(!canAccessPass(req,p))return res.status(403).json({error:'This pass belongs to another company.'});res.json(p)})
app.get('/api/scan/:id',(req,res)=>{const p=hydrate(req.params.id);if(!p)return res.status(404).type('text').send('Material pass not found');res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${p.pass_no}</title><style>body{font:16px Arial;max-width:1000px;margin:24px auto;padding:0 16px;color:#203040}h1{color:#12314d}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border:1px solid #ccd5df;padding:8px;text-align:left}th{background:#eef3f8}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.field{padding:10px;background:#f5f8fb;border-radius:6px}.muted{color:#657789}</style></head><body><h1>Material Pass ${p.pass_no}</h1><p class="muted">QR verification view · Pass ID ${p.id}</p><div class="grid">${[['Status',p.status],['Contract',p.contract_name],['Company',p.company_name],['Direction',p.direction==='Entry'?'IN':p.direction==='Exit'?'OUT':p.direction],['Type',p.type],['Return date',p.return_date],['Mode',p.mode],['Escort',p.escort_name],['Driver',p.driver_name],['Driver ID',p.driver_id],['Vehicle no.',p.vehicle_no],['Vehicle pass no.',p.vehicle_pass_no],['Issued by',p.issued_by],['Destination',p.destination],['Created',p.created_at],['Approver reviewed by',p.approver_reviewed_by],['Officer authority',p.officer_authority],['Final approved by',p.approved_by_name],['Approved',p.approved_at],['Arrival certified',p.arrival_at],['Completed',p.completed_at]].map(([k,v])=>`<div class="field"><b>${esc(k)}</b><br>${esc(v||'—')}</div>`).join('')}</div><h2>Material details</h2><table><thead><tr><th>#</th><th>Category</th><th>Description</th><th>Unit</th><th>Quantity</th><th>Arrived</th><th>Returned</th><th>Remarks</th><th>Asset details</th></tr></thead><tbody>${p.items.map(i=>`<tr><td>${i.sl_no}</td><td>${esc(i.category||'General')}</td><td>${esc(i.description)}</td><td>${esc(i.uom)}</td><td>${i.approved_qty}</td><td>${i.arrived_qty}</td><td>${i.returned_qty}</td><td>${esc(i.remarks||'—')}</td><td>${i.category==='IT Asset'?esc([i.asset_type,i.asset_brand,i.asset_model,i.asset_serial,i.asset_tag,i.asset_condition,i.asset_owner,i.asset_purpose].filter(Boolean).join(' · ')||'—'):'—'}</td></tr>`).join('')}</tbody></table><p class="muted">This page displays pass data encoded by the QR. For the full record, use the authorized application.</p></body></html>`)} )
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
// Excel-compatible SpreadsheetML report; every material is exported as its own row.
app.get('/api/reports/material-passes.xls',auth,(req,res)=>{
 const {from,to,company,material,category,status,direction,search}=req.query;
 let rows=db.prepare('SELECT * FROM passes ORDER BY id DESC').all();
 const includes=(value,needle)=>String(value??'').toLowerCase().includes(String(needle??'').toLowerCase());
 const includesExactCompany=(value,companyName)=>!!companyName&&String(value??'').trim().toLowerCase()===String(companyName).trim().toLowerCase();
 rows=rows.filter(p=>{
  const day=String(p.created_at||'').slice(0,10); if(from&&day<from)return false; if(to&&day>to)return false;
  if(req.session.user.role==='user'&&(!includesExactCompany(p.company_name,req.session.user.company_name)||String(p.contract_name||'').trim().toLowerCase()!==String(req.session.user.contract_name||'').trim().toLowerCase()))return false; if(req.session.user.role==='admin'&&company&&!includes(p.company_name,company))return false; if(status&&p.status!==status)return false; if(direction&&!(direction==='IN'?['IN','Entry'].includes(p.direction):direction==='OUT'?['OUT','Exit'].includes(p.direction):p.direction===direction))return false;
  const full=hydrate(p.id); if(category&&!full.items.some(i=>i.category===category))return false;
  if(material&&!full.items.some(i=>[i.description,i.category,i.uom,i.remarks,i.asset_type,i.asset_brand,i.asset_model,i.asset_serial,i.asset_tag,i.asset_condition,i.asset_owner,i.asset_purpose].some(v=>includes(v,material))))return false;
  if(search){const pf=[p.pass_no,p.contract_name,p.company_name,p.direction,p.type,p.return_date,p.mode,p.escort_name,p.driver_name,p.driver_id,p.vehicle_no,p.vehicle_pass_no,p.issued_by,p.destination,p.status,p.created_by,p.approved_by_name,p.rejected_by,p.rejection_remark];const it=full.items.flatMap(i=>[i.description,i.category,i.uom,i.remarks,i.asset_type,i.asset_brand,i.asset_model,i.asset_serial,i.asset_tag,i.asset_condition,i.asset_owner,i.asset_purpose]);if(![...pf,...it].some(v=>includes(v,search)))return false;}
  return true;
 });
 const dateFields=new Set(['Created Date','Approver Reviewed At','Approved At','Rejected At','Arrival Certified At','Completed At']);
 const excelValue=(v,label)=>dateFields.has(label)&&v?formatIndiaDateTime(v):v;
 const cols=['Pass No','Created Date','Created By','Contract Name','Company / Contractor','Direction','Pass Type','Status','Return Date','Transport Mode','Escort Name','Driver Name','Driver ID','Vehicle No','Vehicle Pass No','Issued By','Destination','Approver Reviewed By','Approver Reviewed At','Officer Authority','Approved By','Approved At','Rejected By','Rejected At','Rejection Remark','Item No','Category','Material Description','Unit','Quantity','Arrived Qty','Returned Qty','Item Status','Remarks','Asset Type','Asset Brand','Asset Model','Asset Serial No','Asset Tag','Asset Condition','Asset Owner','Asset Purpose','Arrival Certified At','Completed At'];
 const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const cell=v=>`<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`;
 const header=`<Row>${cols.map(cell).join('')}</Row>`;
 const data=rows.flatMap(p=>{const full=hydrate(p.id);return (full.items.length?full.items:[{}]).map(i=>{const values=[p.pass_no,p.created_at,p.created_by,p.contract_name,p.company_name,p.direction,p.type,p.status,p.return_date,p.mode,p.escort_name,p.driver_name,p.driver_id,p.vehicle_no,p.vehicle_pass_no,p.issued_by,p.destination,p.approver_reviewed_by,p.approver_reviewed_at,p.officer_authority,p.approved_by_name,p.approved_at,p.rejected_by,p.rejected_at,p.rejection_remark,i.sl_no,i.category,i.description,i.uom,i.approved_qty,i.arrived_qty,i.returned_qty,i.item_status,i.remarks,i.asset_type,i.asset_brand,i.asset_model,i.asset_serial,i.asset_tag,i.asset_condition,i.asset_owner,i.asset_purpose,p.arrival_at,p.completed_at];return `<Row>${values.map((v,idx)=>cell(excelValue(v,cols[idx]))).join('')}</Row>`})}).join('');
 const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Material Pass Report"><Table><Row>${cols.map(v=>`<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join('')}</Row>${data}</Table></Worksheet></Workbook>`;
 res.setHeader('Content-Type','application/vnd.ms-excel; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="material-pass-report-${new Date().toISOString().slice(0,10)}.xls"`);res.send(xml);
})

app.post('/api/passes',auth,(req,res)=>{const b=req.body;if(req.session.user.role!=='user')return res.status(403).json({error:'Only User accounts can create new material passes.'});if(req.session.user.role==='user'){if(!req.session.user.company_name)return res.status(403).json({error:'Your account has no company assigned. Please contact the administrator.'});if(String(b.company_name||'').trim().toLowerCase()!==String(req.session.user.company_name).trim().toLowerCase()||String(b.contract_name||'').trim().toLowerCase()!==String(req.session.user.contract_name||'').trim().toLowerCase())return res.status(403).json({error:'You can create passes only for your assigned company and contract.'});b.company_name=req.session.user.company_name;b.contract_name=req.session.user.contract_name;}if(!b.company_name||!b.contract_name||!b.direction||!b.type||!b.mode||!b.issued_by||!Array.isArray(b.items)||!b.items.length)return res.status(400).json({error:'Required fields/items missing'});if(b.type==='Returnable'&&!String(b.return_date||'').trim())return res.status(400).json({error:'Date of Return is required for Returnable passes.'});if(b.type==='Non-Returnable'&&b.direction==='OUT'&&!String(b.officer_authority||'').trim())return res.status(400).json({error:'Officer authority is required for Non-Returnable materials going OUT.'});const passNo=nextPass(b.contract_name),now=new Date().toISOString();const tx=db.transaction(()=>{const info=db.prepare(`INSERT INTO passes(pass_no,contract_name,company_name,direction,type,return_date,mode,escort_name,driver_name,driver_id,vehicle_no,vehicle_pass_no,issued_by,destination,status,created_at,created_by,officer_authority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(passNo,b.contract_name,b.company_name,b.direction,b.type,b.return_date||null,b.mode,b.escort_name||'',b.driver_name||'',b.driver_id||'',b.vehicle_no||'',b.vehicle_pass_no||'',b.issued_by,b.destination||'','Recorded - Pending Arrival',now,req.session.user.username,b.officer_authority||'');const ins=db.prepare(`INSERT INTO items(pass_id,sl_no,description,uom,approved_qty,remarks,category,asset_type,asset_brand,asset_model,asset_serial,asset_tag,asset_condition,asset_owner,asset_purpose) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);b.items.forEach((i,n)=>ins.run(info.lastInsertRowid,n+1,i.description,i.uom,Number(i.approved_qty),i.remarks||'',i.category||'General',i.asset_type||'',i.asset_brand||'',i.asset_model||'',i.asset_serial||'',i.asset_tag||'',i.asset_condition||'',i.asset_owner||'',i.asset_purpose||''));db.prepare('INSERT INTO audit_logs(event_at,actor_user_id,actor_name,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?,?)').run(now,req.session.user.id,req.session.user.username,'CREATE','pass',info.lastInsertRowid,JSON.stringify({pass_no:passNo,item_count:b.items.length}));return info.lastInsertRowid})();res.status(201).json(hydrate(tx))})
app.put('/api/passes/:id',auth,(req,res)=>{
 const p=hydrate(req.params.id); if(!p)return res.status(404).json({error:'Pass not found'});
 if(!canAccessPass(req,p)||req.session.user.role!=='user')return res.status(403).json({error:'You cannot edit this pass.'});
 if(!['Recorded - Pending Arrival','Arrival Rejected'].includes(p.status))return res.status(400).json({error:'Only passes pending arrival or rejected arrival can be edited.'});
 if(p.items.some(i=>Number(i.arrived_qty||0)!==0)||db.prepare("SELECT 1 FROM transactions WHERE pass_id=? AND type_of_transaction='arrival' LIMIT 1").get(p.id))return res.status(400).json({error:'This pass already has arrival history and cannot be edited as a new pass.'});
 const b=req.body||{}; if(b.type==='Returnable'&&!String(b.return_date||'').trim())return res.status(400).json({error:'Date of Return is required for Returnable passes.'});
 if(!b.company_name||!b.contract_name||!b.direction||!b.type||!b.mode||!b.issued_by||!Array.isArray(b.items)||!b.items.length)return res.status(400).json({error:'Required fields/items missing'});
 if(String(b.company_name).trim().toLowerCase()!==String(req.session.user.company_name||'').trim().toLowerCase()||String(b.contract_name).trim().toLowerCase()!==String(req.session.user.contract_name||'').trim().toLowerCase())return res.status(403).json({error:'You can edit passes only for your assigned company and contract.'});
 const tx=db.transaction(()=>{db.prepare(`UPDATE passes SET contract_name=?,company_name=?,direction=?,type=?,return_date=?,mode=?,issued_by=?,destination=?,officer_authority=? WHERE id=?`).run(b.contract_name,b.company_name,b.direction,b.type,b.return_date||null,b.mode,b.issued_by,b.destination||'',b.officer_authority||'',p.id);db.prepare('DELETE FROM items WHERE pass_id=?').run(p.id);const ins=db.prepare(`INSERT INTO items(pass_id,sl_no,description,uom,approved_qty,remarks,category,asset_type,asset_brand,asset_model,asset_serial,asset_tag,asset_condition,asset_owner,asset_purpose) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);b.items.forEach((i,n)=>{const qty=Number(i.approved_qty);if(!Number.isFinite(qty)||qty<=0)throw new Error('Item quantities must be greater than zero.');ins.run(p.id,n+1,i.description,i.uom,qty,i.remarks||'',i.category||'General',i.asset_type||'',i.asset_brand||'',i.asset_model||'',i.asset_serial||'',i.asset_tag||'',i.asset_condition||'',i.asset_owner||'',i.asset_purpose||'')});audit(req,'EDIT_PASS','pass',p.id,{item_count:b.items.length})});
 try{tx();res.json(hydrate(p.id))}catch(e){res.status(400).json({error:e.message||'Could not update pass.'})}
})

app.post('/api/passes/:id/approve',auth,(req,res)=>{
 const p=hydrate(req.params.id); if(!p)return res.status(404).json({error:'Pass not found'});
 if(req.session.user.role!=='approver')return res.status(403).json({error:'Only Approver accounts can approve arrival and return records.'});
 const name=req.session.user.approver_name||req.session.user.username, now=new Date().toISOString();
 if(p.status==='Pending Arrival Approval'){
   const latest=db.prepare("SELECT id FROM transactions WHERE pass_id=? AND type_of_transaction='arrival' AND status='Pending Approval' ORDER BY id DESC LIMIT 1").get(p.id);
   if(!latest)return res.status(400).json({error:'No pending arrival transaction was found.'});
   const tx=db.transaction(()=>{
    const rows=db.prepare('SELECT item_id,qty FROM transaction_items WHERE transaction_id=?').all(latest.id);
    for(const row of rows){const item=db.prepare('SELECT approved_qty FROM items WHERE id=? AND pass_id=?').get(row.item_id,p.id);if(!item)continue;const q=Number(row.qty||0);if(q<0||q>Number(item.approved_qty||0))throw new Error('Arrival quantity exceeds approved quantity.');db.prepare('UPDATE items SET arrived_qty=?,item_status=? WHERE id=?').run(q,q<=0?'Cancelled - Non Arrival':q<Number(item.approved_qty)?'Partially Arrived':'Arrived',row.item_id)}
    const arrivedTotal=db.prepare('SELECT COALESCE(SUM(arrived_qty),0) AS n FROM items WHERE pass_id=?').get(p.id).n;
    const status=(p.type==='Non-Returnable'||arrivedTotal===0)?'Completed':'Pending Return';
    const r=db.prepare("UPDATE passes SET status=?,approver_reviewed_by=?,approver_reviewed_at=?,arrival_at=? WHERE id=? AND status='Pending Arrival Approval'").run(status,name,now,now,req.params.id);
    if(!r.changes)throw new Error('Arrival record is no longer awaiting approval.');
    db.prepare("UPDATE transactions SET status='Approved',approved_by=?,approved_at=? WHERE id=?").run(name,now,latest.id);
    recordApproval(p.id,'arrival',latest.id,'APPROVED',req.session.user,now);audit(req,'APPROVE_ARRIVAL','pass',p.id,{transaction_id:latest.id});
   });
   try{tx();return res.json(hydrate(req.params.id))}catch(e){return res.status(400).json({error:e.message||'Could not approve arrival.'})}
 }
 if(p.status==='Pending Return Approval'){
   const latest=db.prepare("SELECT id FROM transactions WHERE pass_id=? AND type_of_transaction='return' AND status='Pending Approval' ORDER BY id DESC LIMIT 1").get(p.id);
   if(!latest)return res.status(400).json({error:'No pending return transaction was found.'});
   const tx=db.transaction(()=>{
    const rows=db.prepare('SELECT item_id,qty FROM transaction_items WHERE transaction_id=?').all(latest.id);
    for(const row of rows){const item=db.prepare('SELECT arrived_qty,returned_qty FROM items WHERE id=? AND pass_id=?').get(row.item_id,p.id);if(!item)continue;const qty=Number(row.qty||0);const cumulative=Number(item.returned_qty||0)+qty;if(qty<0||cumulative>Number(item.arrived_qty||0))throw new Error('Return quantity exceeds the remaining pending quantity.');const pending=Math.max(0,Number(item.arrived_qty||0)-cumulative);db.prepare('UPDATE items SET returned_qty=?,item_status=? WHERE id=?').run(cumulative,pending===0?'Returned':cumulative>0?'Partially Returned':'Pending Return',row.item_id)}
    const remaining=db.prepare('SELECT COALESCE(SUM(MAX(0,arrived_qty-returned_qty)),0) AS n FROM items WHERE pass_id=?').get(p.id).n;
    const status=remaining===0?'Completed':'Pending Return';
    const r=db.prepare("UPDATE passes SET status=?,approver_reviewed_by=?,approver_reviewed_at=?,completed_at=? WHERE id=? AND status='Pending Return Approval'").run(status,name,now,remaining===0?now:null,req.params.id);
    if(!r.changes)throw new Error('Return record is no longer awaiting approval.');
    db.prepare("UPDATE transactions SET status='Approved',approved_by=?,approved_at=? WHERE id=?").run(name,now,latest.id);
    recordApproval(p.id,'return',latest.id,'APPROVED',req.session.user,now);audit(req,'APPROVE_RETURN','pass',p.id,{transaction_id:latest.id});
   });
   try{return tx(),res.json(hydrate(req.params.id))}catch(e){return res.status(400).json({error:e.message||'Could not approve return.'})}
 }
 return res.status(400).json({error:'This pass has no arrival or return record awaiting approval.'});
})
app.post('/api/passes/:id/reject',auth,(req,res)=>{
 if(req.session.user.role!=='approver')return res.status(403).json({error:'Only Approver accounts can reject arrival or return records.'});
 const remark=String(req.body?.remark||'').trim(); if(remark.length<3)return res.status(400).json({error:'Please enter a rejection remark (at least 3 characters).'});
 const p=hydrate(req.params.id);if(!p)return res.status(404).json({error:'Pass not found'});
 const status=p.status==='Pending Arrival Approval'?'Arrival Rejected':p.status==='Pending Return Approval'?'Return Rejected':null;
 if(!status)return res.status(400).json({error:'Only pending arrival or return records can be rejected.'});
 const now=new Date().toISOString();const actor=req.session.user.approver_name||req.session.user.username;const isArrival=status==='Arrival Rejected';
 const latest=db.prepare('SELECT id FROM transactions WHERE pass_id=? AND type_of_transaction=? ORDER BY id DESC LIMIT 1').get(p.id,isArrival?'arrival':'return');
 const tx=db.transaction(()=>{
  db.prepare('UPDATE passes SET status=?,rejected_by=?,rejected_at=?,rejection_remark=? WHERE id=?').run(status,actor,now,remark,req.params.id);
  if(latest)db.prepare("UPDATE transactions SET status='Rejected',rejected_by=?,rejected_at=?,rejection_remark=? WHERE id=?").run(actor,now,remark,latest.id);
  recordApproval(p.id,isArrival?'arrival':'return',latest?.id||null,'REJECTED',req.session.user,now,remark);audit(req,'REJECT_TRANSACTION','pass',p.id,{transaction_id:latest?.id||null,remark});
 }); tx();res.json(hydrate(req.params.id));
})
app.post('/api/passes/:id/arrival',auth,(req,res)=>{
 const p=hydrate(req.params.id);if(!p)return res.status(404).json({error:'Not found'});if(!canAccessPass(req,p))return res.status(403).json({error:'This pass belongs to another company.'});if(req.session.user.role!=='user')return res.status(403).json({error:'Only User accounts can record arrival.'});if(!['Recorded - Pending Arrival','Arrival Rejected'].includes(p.status))return res.status(400).json({error:'Arrival can only be recorded when it is pending or was rejected for correction.'});
 const arrivals=Array.isArray(req.body.items)?req.body.items:[];if(String(p.mode||'').toLowerCase().includes('hand')&&!String(req.body.escort_name||'').trim())return res.status(400).json({error:'Escort Name is required for By Hand mode.'});const now=new Date().toISOString();
 const tx=db.transaction(()=>{const txInfo=db.prepare("INSERT INTO transactions(pass_id,type_of_transaction,transaction_at,submitted_by_user_id,submitted_by,status,notes) VALUES(?,'arrival',?,?,?,?,?)").run(p.id,now,req.session.user.id,req.session.user.username,'Pending Approval',req.body.notes||null);db.prepare('UPDATE transactions SET escort_name=?,driver_name=?,driver_id=?,vehicle_no=?,vehicle_pass_no=? WHERE id=?').run(req.body.escort_name||null,req.body.driver_name||null,req.body.driver_id||null,req.body.vehicle_no||null,req.body.vehicle_pass_no||null,txInfo.lastInsertRowid);let pending=0;
 const hist=db.prepare('INSERT INTO transaction_items(transaction_id,item_id,qty,remarks) VALUES(?,?,?,?)');
 for(const i of arrivals){const orig=p.items.find(x=>x.id===Number(i.id));if(!orig)continue;const raw=Number(i.arrived_qty);if(!Number.isFinite(raw)||raw<0||raw>Number(orig.approved_qty))throw new Error(`Arrival quantity for ${orig.description} must be between 0 and ${orig.approved_qty}.`);const q=raw;hist.run(txInfo.lastInsertRowid,orig.id,q,i.remarks||null);if(q>0)pending+=q}
 db.prepare("UPDATE passes SET escort_name=?,driver_name=?,driver_id=?,vehicle_no=?,vehicle_pass_no=?,status='Pending Arrival Approval',arrival_at=?,rejected_by=NULL,rejected_at=NULL,rejection_remark=NULL WHERE id=?").run(req.body.escort_name||'',req.body.driver_name||'',req.body.driver_id||'',req.body.vehicle_no||'',req.body.vehicle_pass_no||'',now,p.id);audit(req,'RECORD_ARRIVAL','pass',p.id,{transaction_id:Number(txInfo.lastInsertRowid),item_count:arrivals.length});return Number(txInfo.lastInsertRowid)});
 try{tx();res.json(hydrate(req.params.id))}catch(e){res.status(400).json({error:e.message||'Could not record arrival.'})}
})
app.put('/api/passes/:id/arrival',auth,(req,res)=>{
 const p=hydrate(req.params.id);if(!p)return res.status(404).json({error:'Pass not found'});if(!canAccessPass(req,p)||req.session.user.role!=='user')return res.status(403).json({error:'You cannot edit this arrival.'});if(p.status!=='Pending Arrival Approval')return res.status(400).json({error:'Only an arrival awaiting approval can be edited.'});
 const latest=db.prepare("SELECT * FROM transactions WHERE pass_id=? AND type_of_transaction='arrival' AND status='Pending Approval' ORDER BY id DESC LIMIT 1").get(p.id);if(!latest)return res.status(400).json({error:'No pending arrival transaction was found.'});const rows=Array.isArray(req.body.items)?req.body.items:[];if(!rows.length)return res.status(400).json({error:'Enter at least one arrival quantity.'});const now=new Date().toISOString();
 const tx=db.transaction(()=>{let total=0;const updateHistory=db.prepare('UPDATE transaction_items SET qty=?,remarks=? WHERE transaction_id=? AND item_id=?');for(const row of rows){const item=p.items.find(i=>i.id===Number(row.id));if(!item)continue;const q=Number(row.arrived_qty);if(!Number.isFinite(q)||q<0||q>Number(item.approved_qty||0))throw new Error(`Arrival quantity for ${item.description} must be between 0 and ${item.approved_qty}.`);updateHistory.run(q,row.remarks||null,latest.id,item.id);total+=q}db.prepare('UPDATE passes SET escort_name=?,driver_name=?,driver_id=?,vehicle_no=?,vehicle_pass_no=?,arrival_at=? WHERE id=?').run(req.body.escort_name||'',req.body.driver_name||'',req.body.driver_id||'',req.body.vehicle_no||'',req.body.vehicle_pass_no||'',now,p.id);db.prepare('UPDATE transactions SET transaction_at=?,notes=?,escort_name=?,driver_name=?,driver_id=?,vehicle_no=?,vehicle_pass_no=? WHERE id=?').run(now,req.body.notes||latest.notes,req.body.escort_name||null,req.body.driver_name||null,req.body.driver_id||null,req.body.vehicle_no||null,req.body.vehicle_pass_no||null,latest.id);audit(req,'EDIT_ARRIVAL','arrival_transaction',latest.id,{pass_id:p.id,item_count:rows.length})});
 try{tx();res.json(hydrate(p.id))}catch(e){res.status(400).json({error:e.message||'Could not update arrival.'})}
})

app.post('/api/passes/:id/return',auth,(req,res)=>{
 const p=hydrate(req.params.id);if(!p)return res.status(404).json({error:'Not found'});if(!canAccessPass(req,p))return res.status(403).json({error:'This pass belongs to another company.'});if(req.session.user.role!=='user')return res.status(403).json({error:'Only User accounts can record returns.'});if(!['Pending Return','Return Rejected'].includes(p.status))return res.status(400).json({error:'Return details can only be recorded when return is pending or was rejected for correction.'});
 const returns=Array.isArray(req.body.items)?req.body.items:[];if(String(p.mode||'').toLowerCase().includes('hand')&&!String(req.body.escort_name||'').trim())return res.status(400).json({error:'Escort Name is required for By Hand mode.'});const now=new Date().toISOString();
 const tx=db.transaction(()=>{const txInfo=db.prepare("INSERT INTO transactions(pass_id,type_of_transaction,transaction_at,submitted_by_user_id,submitted_by,status,notes,escort_name,driver_name,driver_id,vehicle_no,vehicle_pass_no) VALUES(?,'return',?,?,?,?,?,?,?,?,?,?)").run(p.id,now,req.session.user.id,req.session.user.username,'Pending Approval',req.body.notes||null,req.body.escort_name||null,req.body.driver_name||null,req.body.driver_id||null,req.body.vehicle_no||null,req.body.vehicle_pass_no||null);const hist=db.prepare('INSERT INTO transaction_items(transaction_id,item_id,qty,remarks) VALUES(?,?,?,?)');
 for(const i of returns){const orig=p.items.find(x=>x.id===Number(i.id));if(!orig)continue;const requested=Number(i.returned_qty);if(!Number.isFinite(requested)||requested<Number(orig.returned_qty||0)||requested>Number(orig.arrived_qty||0))throw new Error(`Cumulative returned quantity for ${orig.description} must be between ${orig.returned_qty||0} and ${orig.arrived_qty||0}.`);const delta=requested-Number(orig.returned_qty||0);const pending=Math.max(0,Number(orig.arrived_qty||0)-requested);hist.run(txInfo.lastInsertRowid,orig.id,delta,i.remarks||null)}
 const fresh=hydrate(p.id);let pending=0;for(const i of fresh.items)pending+=Math.max(0,Number(i.arrived_qty||0)-Number(i.returned_qty||0));db.prepare("UPDATE passes SET status='Pending Return Approval',rejected_by=NULL,rejected_at=NULL,rejection_remark=NULL WHERE id=?").run(p.id);audit(req,'RECORD_RETURN','pass',p.id,{transaction_id:Number(txInfo.lastInsertRowid),item_count:returns.length});return Number(txInfo.lastInsertRowid)});
 try{tx();res.json(hydrate(req.params.id))}catch(e){res.status(400).json({error:e.message||'Could not record return.'})}
})
function formatIndiaDateTime(value){if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value);return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(d)+' IST'}
app.get('/api/passes/:id/pdf',auth,async(req,res)=>{
 const p=hydrate(req.params.id);if(!p)return res.status(404).end();if(!canAccessPass(req,p))return res.status(403).json({error:'This pass belongs to another company.'});
 const pdfStage = req.query.stage === 'creation' ? 'creation' : (p.return_transactions.length ? 'return' : (p.arrival_transactions.length ? 'arrival' : 'record-arrival'));
 const showArrivedColumn = pdfStage !== 'creation' && p.arrival_transactions.length > 0;
 const showReturnedColumns = pdfStage === 'return' && p.return_transactions.length > 0;
 const showSignatures = pdfStage === 'creation';
 const qrData={application:'Material Pass Module',pass_id:p.id,pass_no:p.pass_no,contract_name:p.contract_name,company_name:p.company_name,direction:p.direction==='Entry'?'IN':p.direction==='Exit'?'OUT':p.direction,type:p.type,return_date:p.return_date,mode:p.mode,escort_name:p.escort_name,driver_name:p.driver_name,driver_id:p.driver_id,vehicle_no:p.vehicle_no,vehicle_pass_no:p.vehicle_pass_no,issued_by:p.issued_by,destination:p.destination,status:p.status,created_at:p.created_at,items:p.items.map(i=>({sl_no:i.sl_no,category:i.category,description:i.description,uom:i.uom,approved_qty:i.approved_qty,arrived_qty:i.arrived_qty,returned_qty:i.returned_qty,pending_quantity:Math.max(0,Number(i.arrived_qty||0)-Number(i.returned_qty||0)),remarks:i.remarks,asset:{type:i.asset_type,brand:i.asset_brand,model:i.asset_model,serial_no:i.asset_serial,asset_tag:i.asset_tag,condition:i.asset_condition,assigned_to:i.asset_owner,purpose:i.asset_purpose}})),arrival_transactions:p.arrival_transactions.map(t=>({date:t.transaction_at,status:t.status,submitted_by:t.submitted_by,approved_by:t.approved_by,approved_at:t.approved_at,items:t.items.map(i=>({description:i.description,quantity_arrived:i.quantity_arrived,remarks:i.remarks}))})),return_transactions:p.return_transactions.map(t=>({date:t.transaction_at,status:t.status,submitted_by:t.submitted_by,approved_by:t.approved_by,approved_at:t.approved_at,items:t.items.map(i=>({description:i.description,quantity_returned:i.quantity_returned,pending_quantity_after:i.pending_quantity_after,remarks:i.remarks}))}))};
 let qr;try{qr=await QRCode.toDataURL(JSON.stringify(qrData),{errorCorrectionLevel:'L',margin:1,width:360})}catch{qr=await QRCode.toDataURL(JSON.stringify({pass_no:p.pass_no,pass_id:p.id,scan_url:`${(process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/api/scan/${p.id}`}),{errorCorrectionLevel:'L',margin:1,width:360})}
 const doc=new PDFDocument({size:'A4',margin:38,bufferPages:true});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="${p.pass_no}.pdf"`);doc.pipe(res);
 const navy='#12314D',blue='#1769AA',gray='#526476',light='#EEF3F8',pageW=doc.page.width,contentW=pageW-76;let y=38;
 const ensure=(h)=>{if(y+h>doc.page.height-42){doc.addPage();y=38}};
 const txt=(text,x,w,size=9,font='Helvetica',color=navy)=>{doc.fillColor(color).font(font).fontSize(size).text(String(text??'—'),x,y,{width:w});};
 const logoPath=path.join(__dirname,'public','indian-navy-project-seabird.png');if(fs.existsSync(logoPath)){try{doc.image(logoPath,38,30,{fit:[58,58]})}catch{}}doc.fillColor(navy).font('Helvetica-Bold').fontSize(19).text('MATERIAL PASS',{align:'center'});doc.moveDown(.2);doc.fillColor(gray).font('Helvetica').fontSize(9).text('Material movement authorisation and tracking record',{align:'center'});doc.moveDown(.8);doc.fillColor(blue).font('Helvetica-Bold').fontSize(12).text(`PASS NO: ${p.pass_no}`);y=doc.y+10;
 const latestMovement = pdfStage==='return' ? p.return_transactions[p.return_transactions.length-1] : p.arrival_transactions[p.arrival_transactions.length-1];const movementFields = pdfStage==='creation' ? [] : String(p.mode||'').toLowerCase().includes('hand') ? [['Escort Name',latestMovement?.escort_name||'']] : [['Escort Name',latestMovement?.escort_name||''],['Driver Name',latestMovement?.driver_name||''],['Driver ID',latestMovement?.driver_id||''],['Vehicle No.',latestMovement?.vehicle_no||''],['Vehicle Pass No.',latestMovement?.vehicle_pass_no||'']];const details=[['Contract Name',p.contract_name],['Company Name',p.company_name],['Direction',p.direction==='Entry'?'IN':p.direction==='Exit'?'OUT':p.direction],['Pass Type',p.type],['Date of Return',p.return_date||''],['Status',p.status],['Transport Mode',p.mode],...movementFields,['Issued By',p.issued_by],['Destination',p.destination||'']];const colW=(contentW-20)/2;
 for(let i=0;i<details.length;i+=2){ensure(30);for(let c=0;c<2;c++){const d=details[i+c];if(!d)continue;const x=38+c*(colW+20);doc.fillColor(gray).font('Helvetica-Bold').fontSize(8).text(d[0],x,y,{width:colW});doc.fillColor(navy).font('Helvetica').fontSize(9).text(String(d[1]??'—'),x,y+11,{width:colW});}y+=30}
 y+=6;ensure(45);doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('MATERIAL DETAILS',38,y);y+=20;
 const cols=[{t:'#',w:22},{t:'Category / Description',w:150},{t:'Unit',w:42},{t:'Quantity',w:58},...(showArrivedColumn?[{t:'Arrived',w:58}]:[]),...(showReturnedColumns?[{t:'Returned',w:58},{t:'Pending Quantity',w:70}]:[]),{t:'Remarks / IT asset details',w:0}];
 const usedBeforeRemarks=cols.slice(0,-1).reduce((sum,c)=>sum+c.w,0);cols[cols.length-1].w=contentW-usedBeforeRemarks;
 const drawRow=(vals,header=false)=>{const plain=v=>Array.isArray(v)?v.map(part=>part.text||'').join(''):String(v??'');const heights=vals.map((v,i)=>doc.heightOfString(plain(v),{width:cols[i].w-8,fontSize:8})+10);const h=header?27:Math.max(30,...heights);ensure(h);let x=38;if(header)doc.rect(38,y,contentW,h).fill(light);else doc.rect(38,y,contentW,h).stroke('#D6DEE7');for(let i=0;i<vals.length;i++){doc.fillColor(navy).font(header?'Helvetica-Bold':'Helvetica').fontSize(7).text(Array.isArray(vals[i])?vals[i]:String(vals[i]??''),x+4,y+5,{width:cols[i].w-8,height:h-8});doc.save().moveTo(x,y).lineTo(x,y+h).stroke('#D6DEE7').restore();x+=cols[i].w}doc.moveTo(38,y+h).lineTo(38+contentW,y+h).stroke('#D6DEE7');y+=h};
 drawRow(cols.map(c=>c.t),true);for(const i of p.items){const isAsset=i.category==='IT Asset';const assetFields=[['Type',i.asset_type],['Brand',i.asset_brand],['Model',i.asset_model],['Serial Number',i.asset_serial],['Asset Tag',i.asset_tag],['Condition',i.asset_condition],['Assigned To',i.asset_owner],['Purpose / Remarks',i.asset_purpose]].filter(([,v])=>String(v||'').trim());const assetRich=[];assetFields.forEach(([label,value],n)=>{if(n)assetRich.push({text:'\n'});assetRich.push({text:label+': ',options:{font:'Helvetica-Bold'}});assetRich.push({text:String(value)});});const remarksRich=[];if(i.remarks)remarksRich.push({text:String(i.remarks)});if(isAsset&&assetRich.length){if(remarksRich.length)remarksRich.push({text:'\n'});remarksRich.push(...assetRich)}const categoryDescription=isAsset?`IT Asset\n${i.description}`:String(i.description||'');drawRow([i.sl_no,categoryDescription,i.uom,i.approved_qty,...(showArrivedColumn?[i.arrived_qty]:[]),...(showReturnedColumns?[i.returned_qty,Math.max(0,Number(i.arrived_qty||0)-Number(i.returned_qty||0))]:[]),remarksRich.length?remarksRich:'—'])}
 if(p.arrival_transactions.length){y+=14;ensure(35);doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('ARRIVAL TRANSACTION HISTORY',38,y);y+=20;for(const tx of p.arrival_transactions){ensure(24);const approver=tx.status==='Approved'&&tx.approved_by?` · Approver: ${tx.approved_by}`:'';doc.fillColor(gray).font('Helvetica').fontSize(9).text(`${formatIndiaDateTime(tx.transaction_at)} · ${tx.status} · Submitted by ${tx.submitted_by}${approver}`,38,y,{width:contentW});y+=16}}
 if(p.return_transactions.length){y+=14;ensure(35);doc.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('RETURN TRANSACTION HISTORY',38,y);y+=20;for(const tx of p.return_transactions){ensure(28);doc.fillColor(gray).font('Helvetica-Bold').fontSize(8).text(`${formatIndiaDateTime(tx.transaction_at)} · ${tx.status} · Submitted by ${tx.submitted_by}${tx.approved_by?' · Approved by '+tx.approved_by:''}`,38,y,{width:contentW});y+=13;for(const it of tx.items){ensure(18);doc.fillColor(navy).font('Helvetica').fontSize(8).text(`• ${it.description}: ${it.quantity_returned} returned · Pending ${it.pending_quantity_after}${it.remarks?' — '+it.remarks:''}`,48,y,{width:contentW-10});y+=12}}}
 // IT asset departure declaration appears only after the relevant movement transaction is approved.
 const hasITAsset=p.items.some(i=>i.category==='IT Asset');const directionOut=['OUT','Exit'].includes(String(p.direction||'').toUpperCase());const declarationApproved=directionOut?p.arrival_transactions.some(t=>t.status==='Approved'):p.return_transactions.some(t=>t.status==='Approved');
 if(hasITAsset&&declarationApproved){const declaration='It is understood that the visitor is employed by the contractor for undertaking Project Seabird related activities and therefore is in possession of project related data on Floppies/ CD/ Computer/ Laptop/ Hard Disks/ USB drive. Further, the contractor has also taken full responsibilities of data security. Therefore, the request of the visitor to depart with the IT asset is hereby approved.';const boxX=38,boxW=contentW,textH=doc.heightOfString(declaration,{width:boxW-24,font:'Helvetica',fontSize:8.5,lineGap:2});const boxH=textH+74;ensure(boxH+18);y+=12;doc.rect(boxX,y,boxW,boxH).lineWidth(1).stroke('#526476');doc.fillColor(navy).font('Helvetica-Bold').fontSize(9).text('IT ASSET DEPARTURE DECLARATION',boxX+12,y+10,{width:boxW-24});doc.fillColor(navy).font('Helvetica').fontSize(8.5).text(declaration,boxX+12,y+27,{width:boxW-24,lineGap:2});const sigY=y+boxH-34;doc.moveTo(boxX+12,sigY).lineTo(boxX+190,sigY).stroke('#526476');doc.fillColor(navy).font('Helvetica-Bold').fontSize(8).text('PIMT',boxX+12,sigY+5,{width:178,align:'center'});y+=boxH+8;}
 // Signature boxes appear only on the PDF explicitly generated immediately after creating a new pass.
 if(showSignatures){ensure(112);y+=10;doc.fillColor(navy).font('Helvetica-Bold').fontSize(12).text('Authorised Signatories',38,y,{align:'left'});y+=22;const gap=12,boxW=(contentW-2*gap)/3,boxH=64;for(let n=0;n<3;n++){const x=38+n*(boxW+gap);doc.rect(x,y,boxW,boxH).lineWidth(1).stroke('#526476');doc.fillColor(navy).font('Helvetica-Bold').fontSize(10).text(['Contractor','Engineer','PIMT'][n],x,y+boxH+5,{width:boxW,align:'center'})}y+=boxH+24;}
 const qrImg=Buffer.from(qr.split(',')[1],'base64');ensure(150);y+=8;doc.image(qrImg,(pageW-100)/2,y,{width:100,height:100});y+=104;doc.fillColor(navy).font('Helvetica-Bold').fontSize(9).text('SCAN FOR COMPLETE PASS DATA',(pageW-220)/2,y,{width:220,align:'center'});doc.fillColor(gray).font('Helvetica').fontSize(8).text('QR includes pass, item, arrival and return transaction details.',38,y+15,{width:contentW,align:'center'});doc.end();
})
const dist=path.join(__dirname,'dist');if(fs.existsSync(dist)){app.use(express.static(dist));app.get('/{*splat}',(req,res)=>res.sendFile(path.join(dist,'index.html')))}
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => console.log(`Material Pass Module running on port ${PORT}`))
