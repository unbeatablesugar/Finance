use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension, Transaction as SqlTransaction, TransactionBehavior};
use serde::{de::DeserializeOwned, Serialize};
use std::{collections::HashSet, fs, io::{Read, Write}, path::{Path, PathBuf}, time::Duration};
use sha2::{Digest, Sha256};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub type Result<T> = std::result::Result<T, String>;
pub fn root() -> Result<PathBuf> { std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("PersonalFinance")).ok_or("未找到 Windows 用户本地目录".into()) }
pub fn open(mode: &str) -> Result<Connection> {
    if mode != "demo" && mode != "personal" { return Err("账本空间无效".into()); }
    let folder = root()?.join(mode); fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let conn = Connection::open(folder.join("ledger.db")).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(10)).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS originals(batch_id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT NOT NULL,content BLOB NOT NULL);").map_err(|e| e.to_string())?;
    for table in ["accounts", "transactions", "raw_rows", "batches", "relations", "rules"] { conn.execute_batch(&format!("CREATE TABLE IF NOT EXISTS {table}(id TEXT PRIMARY KEY,payload TEXT NOT NULL);")).map_err(|e| e.to_string())?; }
    Ok(conn)
}
fn rows<T: DeserializeOwned>(conn: &Connection, table: &str) -> Result<Vec<T>> {
    let mut stmt = conn.prepare(&format!("SELECT payload FROM {table} ORDER BY rowid")).map_err(|e| e.to_string())?;
    let data = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    data.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect()
}
fn meta<T: DeserializeOwned>(conn: &Connection, key: &str) -> Result<Option<T>> {
    let raw: Option<String> = conn.query_row("SELECT value FROM meta WHERE key=?", [key], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    raw.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string())).transpose()
}
pub fn initialized(conn: &Connection) -> Result<bool> { Ok(meta::<u32>(conn, "version")?.is_some()) }
pub fn load(conn: &Connection) -> Result<Ledger> {
    let version = meta(conn, "version")?.unwrap_or(1);
    if ![1, 2].contains(&version) { return Err("账本版本较新，请升级应用".into()); }
    let mut ledger = Ledger { version: 2, revision: meta(conn, "revision")?.unwrap_or(0), accounts: rows(conn, "accounts")?, transactions: rows(conn, "transactions")?, raw_rows: rows(conn, "raw_rows")?, batches: rows(conn, "batches")?, relations: rows(conn, "relations")?, rules: rows(conn, "rules")?, categories: meta(conn, "categories")?.unwrap_or_else(|| Ledger::default().categories) };
    crate::domain::prepare_ledger(&mut ledger);
    Ok(ledger)
}
fn put<T: Serialize>(tx: &SqlTransaction, table: &str, values: &[T], get_id: impl Fn(&T) -> &str) -> Result<()> {
    tx.execute(&format!("DELETE FROM {table}"), []).map_err(|e| e.to_string())?;
    let mut stmt = tx.prepare(&format!("INSERT INTO {table}(id,payload) VALUES(?,?)")).map_err(|e| e.to_string())?;
    for value in values { stmt.execute(params![get_id(value), serde_json::to_string(value).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?; }
    Ok(())
}
pub fn save(tx: &SqlTransaction, l: &Ledger) -> Result<()> {
    put(tx, "accounts", &l.accounts, |a| &a.id)?; put(tx, "transactions", &l.transactions, |t| &t.id)?;
    put(tx, "raw_rows", &l.raw_rows, |r| &r.id)?; put(tx, "batches", &l.batches, |b| &b.id)?;
    put(tx, "relations", &l.relations, |r| &r.id)?; put(tx, "rules", &l.rules, |r| &r.id)?;
    for (key, value) in [("version", serde_json::json!(l.version)), ("revision", serde_json::json!(l.revision)), ("categories", serde_json::json!(l.categories))] { tx.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", params![key, value.to_string()]).map_err(|e| e.to_string())?; }
    tx.execute("DELETE FROM originals WHERE batch_id NOT IN (SELECT id FROM batches)", []).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn write<F>(mode: &str, revision: u64, action: F) -> Result<Ledger> where F: FnOnce(&mut Ledger, &SqlTransaction) -> Result<()> {
    let mut conn = open(mode)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let mut ledger = load(&tx)?;
    if ledger.revision != revision { return Err("账本已更新，请重新打开或预览后重试".into()); }
    action(&mut ledger, &tx)?; crate::domain::prepare_ledger(&mut ledger); validate(&ledger)?; save(&tx, &ledger)?; tx.commit().map_err(|e| e.to_string())?;
    Ok(ledger)
}
pub fn validate(l: &Ledger) -> Result<()> {
    if ![1, 2].contains(&l.version) { return Err("不兼容的备份版本".into()); }
    fn unique<'a>(ids: impl Iterator<Item = &'a str>) -> bool { let mut seen = HashSet::new(); ids.into_iter().all(|id| !id.is_empty() && seen.insert(id)) }
    if !unique(l.accounts.iter().map(|x| x.id.as_str())) || !unique(l.transactions.iter().map(|x| x.id.as_str())) || !unique(l.raw_rows.iter().map(|x| x.id.as_str())) || !unique(l.batches.iter().map(|x| x.id.as_str())) || !unique(l.relations.iter().map(|x| x.id.as_str())) || !unique(l.rules.iter().map(|x| x.id.as_str())) { return Err("账本包含空或重复标识".into()); }
    let accounts: HashSet<&str> = l.accounts.iter().map(|a| a.id.as_str()).collect();
    let batches: HashSet<&str> = l.batches.iter().map(|b| b.id.as_str()).collect();
    let raw: HashSet<&str> = l.raw_rows.iter().map(|r| r.id.as_str()).collect();
    for a in &l.accounts { if a.purpose.as_deref().is_some_and(|p| !["cash", "fund", "deposit"].contains(&p)) { return Err("账户用途无效".into()); } if a.name.trim().is_empty() || !["微信", "支付宝", "银行卡"].contains(&a.channel.as_str()) { return Err("账户数据无效".into()); } crate::domain::parse_date(&a.opening_date)?; }
    for t in &l.transactions {
        if t.amount_cents < 0 || t.amount_cents > 9_007_199_254_740_991 || !accounts.contains(t.account_id.as_str()) || !batches.contains(t.batch_id.as_str()) || !raw.contains(t.raw_id.as_str()) || !l.categories.contains(&t.category) || !["expense", "income", "transfer", "refund", "neutral"].contains(&t.kind.as_str()) || !["in", "out", "unknown"].contains(&t.flow.as_str()) { return Err("流水引用或金额无效".into()); }
        crate::domain::parse_date(&t.date)?;
        if let Some(action) = &t.asset_action { if t.kind != "transfer" { return Err("资产划转类型不一致".into()); } crate::assets::validate_target(&l.accounts, action, t.target_account_id.as_deref().unwrap_or(""))?; }
    }
    for r in &l.raw_rows { if !batches.contains(r.batch_id.as_str()) { return Err("原始记录缺少导入批次".into()); } }
    for r in &l.rules { crate::assets::validate_rule(l, r)?; }
    let mut checked = l.clone(); checked.relations.clear();
    for r in &l.relations { crate::domain::validate_relation(&checked, r)?; checked.relations.push(r.clone()); }
    let total: i128 = l.transactions.iter().map(|t| t.amount_cents as i128).sum();
    if total > 9_007_199_254_740_991 { return Err("累计金额超出精确计算范围".into()); }
    Ok(())
}
pub fn backup(mode: &str, path: &Path) -> Result<String> {
    if path.extension().and_then(|s| s.to_str()) != Some("qinghe") { return Err("备份文件扩展名须为 .qinghe".into()); }
    let conn = open(mode)?;
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let snapshot = temp.path().join("snapshot.db");
    let mut target = Connection::open(&snapshot).map_err(|e| e.to_string())?;
    { let backup = rusqlite::backup::Backup::new(&conn, &mut target).map_err(|e| e.to_string())?; backup.run_to_completion(100, Duration::from_millis(10), None).map_err(|e| e.to_string())?; }
    drop(target);
    let bytes = fs::read(&snapshot).map_err(|e| e.to_string())?;
    let manifest = serde_json::json!({ "format": "qinghe", "version": 1, "mode": mode, "createdAt": chrono::Utc::now().to_rfc3339(), "sha256": format!("{:x}", Sha256::digest(&bytes)) });
    let mut output = tempfile::NamedTempFile::new_in(path.parent().ok_or("备份路径无效")?).map_err(|e| e.to_string())?;
    { let mut zip = ZipWriter::new(output.as_file_mut()); let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
      zip.start_file("manifest.json", options).map_err(|e| e.to_string())?; zip.write_all(manifest.to_string().as_bytes()).map_err(|e| e.to_string())?;
      zip.start_file("snapshot.db", options).map_err(|e| e.to_string())?; zip.write_all(&bytes).map_err(|e| e.to_string())?; zip.finish().map_err(|e| e.to_string())?;
    }
    output.as_file().sync_all().map_err(|e| e.to_string())?;
    output.persist(path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
pub fn restore(mode: &str, path: &Path) -> Result<Ledger> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|_| "无效备份文件")?;
    if zip.len() != 2 { return Err("备份内容不完整".into()); }
    let mut text = String::new(); zip.by_name("manifest.json").map_err(|_| "缺少备份清单")?.take(65536).read_to_string(&mut text).map_err(|e| e.to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&text).map_err(|_| "备份清单无效")?;
    if manifest["format"] != "qinghe" || manifest["version"] != 1 || manifest["mode"] != mode { return Err("备份格式、版本或账本空间不匹配".into()); }
    let mut bytes = vec![]; zip.by_name("snapshot.db").map_err(|_| "缺少数据库快照")?.take(1024 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 * 1024 || manifest["sha256"] != format!("{:x}", Sha256::digest(&bytes)) { return Err("备份校验失败或超过 1 GB".into()); }
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?; let snapshot = temp.path().join("restore.db"); fs::write(&snapshot, bytes).map_err(|e| e.to_string())?;
    let source = Connection::open_with_flags(&snapshot, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let integrity: String = source.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if integrity != "ok" { return Err("数据库完整性检查失败".into()); }
    let mut restored = load(&source)?; validate(&restored)?;
    let safety_dir = root()?.join(mode).join("backups"); fs::create_dir_all(&safety_dir).map_err(|e| e.to_string())?;
    backup(mode, &safety_dir.join(format!("before-restore-{}.qinghe", uuid::Uuid::new_v4())))?;
    let current = load(&open(mode)?)?;
    write(mode, current.revision, |ledger, tx| {
        restored.revision = current.revision + 1; *ledger = restored;
        tx.execute("DELETE FROM originals", []).map_err(|e| e.to_string())?;
        let mut stmt = source.prepare("SELECT batch_id,name,hash,content FROM originals").map_err(|e| e.to_string())?;
        let originals = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Vec<u8>>(3)?))).map_err(|e| e.to_string())?;
        for original in originals { let (id, name, hash, content) = original.map_err(|e| e.to_string())?; if format!("{:x}", Sha256::digest(&content)) != hash { return Err("原始账单校验失败".into()); } tx.execute("INSERT INTO originals(batch_id,name,hash,content) VALUES(?,?,?,?)", params![id, name, hash, content]).map_err(|e| e.to_string())?; }
        Ok(())
    })
}
