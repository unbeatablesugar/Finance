use qinghe_core::{domain, importer, storage, model::*, MUTATIONS};
use rusqlite::{params, TransactionBehavior};
mod updates;

#[tauri::command]
fn data_path() -> Result<String, String> { Ok(storage::root()?.to_string_lossy().to_string()) }
#[tauri::command]
fn load_ledger(mode: String, seed: Option<Ledger>) -> Result<Ledger, String> {
    let _guard = MUTATIONS.lock().map_err(|_| "数据库繁忙")?;
    updates::ensure_writable()?;
    let mut conn = storage::open(&mode)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    if !storage::initialized(&tx)? { let initial = if mode == "demo" { seed.unwrap_or_default() } else { Ledger::default() }; storage::validate(&initial)?; storage::save(&tx, &initial)?; }
    let ledger = storage::load(&tx)?; tx.commit().map_err(|e| e.to_string())?; Ok(ledger)
}
#[tauri::command]
fn apply_action(mode: String, action: Action, revision: u64) -> Result<Ledger, String> {
    let _guard = MUTATIONS.lock().map_err(|_| "数据库繁忙")?;
    updates::ensure_writable()?;
    storage::write(&mode, revision, |ledger, _tx| domain::apply(ledger, action))
}
#[tauri::command]
fn read_import(name: String, bytes: Vec<u8>) -> Result<ImportSheet, String> { importer::read(name, bytes) }
#[tauri::command]
fn preview_import(mode: String, name: String, bytes: Vec<u8>, mapping: Mapping, account_id: String, channel: String, funding_map: std::collections::BTreeMap<String, String>) -> Result<Preview, String> {
    let sheet = importer::read(name, bytes)?; let conn = storage::open(&mode)?; let ledger = storage::load(&conn)?;
    importer::preview(&ledger, &sheet, &mapping, &account_id, &channel, &funding_map)
}
#[tauri::command]
fn commit_import(mode: String, name: String, bytes: Vec<u8>, mapping: Mapping, account_id: String, channel: String, revision: u64, funding_map: std::collections::BTreeMap<String, String>) -> Result<Ledger, String> {
    let _guard = MUTATIONS.lock().map_err(|_| "数据库繁忙")?;
    updates::ensure_writable()?;
    let sheet = importer::read(name, bytes)?;
    storage::write(&mode, revision, |ledger, tx| {
        let mut p = importer::preview(ledger, &sheet, &mapping, &account_id, &channel, &funding_map)?;
        if p.file_duplicate || !p.errors.is_empty() || p.transactions.is_empty() { return Err("请处理导入预览中的问题后重试".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        for t in &mut p.transactions { t.batch_id = id.clone(); } for r in &mut p.raw_rows { r.batch_id = id.clone(); }
        ledger.batches.push(Batch { id: id.clone(), name: sheet.name.clone(), hash: sheet.hash.clone(), account_id: if sheet.format == "alipay" { "mixed-alipay".into() } else { account_id.clone() }, channel: channel.clone(), imported_at: chrono::Utc::now().to_rfc3339(), count: p.transactions.len(), skipped: p.skipped, original_name: sheet.name.clone() });
        let affected: std::collections::HashSet<String> = p.transactions.iter().map(|t| t.account_id.clone()).collect();
        ledger.accounts.extend(p.proposed_accounts);
        ledger.transactions.extend(p.transactions); ledger.raw_rows.extend(p.raw_rows); ledger.revision += 1;
        for a in &mut ledger.accounts { if affected.contains(&a.id) { a.complete = false; } }
        tx.execute("INSERT INTO originals(batch_id,name,hash,content) VALUES(?,?,?,?)", params![id, sheet.name, sheet.hash, sheet.bytes]).map_err(|e| e.to_string())?;
        Ok(())
    })
}
#[tauri::command]
fn query_totals(mode: String, period: String) -> Result<Totals, String> { Ok(domain::totals(&storage::load(&storage::open(&mode)?)?, &period)) }
#[tauri::command]
fn backup_ledger(mode: String, path: String) -> Result<String, String> {
    let _guard = MUTATIONS.lock().map_err(|_| "数据库繁忙")?; storage::backup(&mode, std::path::Path::new(&path))
}
#[tauri::command]
fn restore_ledger(mode: String, path: String) -> Result<Ledger, String> {
    let _guard = MUTATIONS.lock().map_err(|_| "数据库繁忙")?;
    updates::ensure_writable()?;
    storage::restore(&mode, std::path::Path::new(&path))
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![data_path, load_ledger, apply_action, read_import, preview_import, commit_import, query_totals, backup_ledger, restore_ledger, updates::prepare_app_update, updates::cancel_app_update])
        .run(tauri::generate_context!()).expect("无法启动青禾账本");
}
