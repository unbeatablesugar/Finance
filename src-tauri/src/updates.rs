use qinghe_core::{storage, MUTATIONS};
use std::sync::atomic::{AtomicBool, Ordering};

static PREPARED: AtomicBool = AtomicBool::new(false);

// Call while holding MUTATIONS so no write can slip between the snapshot and install.
pub fn ensure_writable() -> Result<(), String> {
    if PREPARED.load(Ordering::SeqCst) {
        Err("正在安装软件更新，请稍后再操作账本".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn prepare_app_update(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = MUTATIONS.lock().map_err(|_| "数据库繁忙")?;
        ensure_writable()?;
        let root = storage::root()?;
        let mut paths = Vec::new();
        for mode in ["personal", "demo"] {
            if !root.join(mode).join("ledger.db").try_exists().map_err(|e| e.to_string())? {
                continue;
            }
            let directory = root.join(mode).join("backups");
            std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let path = directory.join(format!("before-update-v{}-{}.qinghe", version, uuid::Uuid::new_v4()));
            paths.push(storage::backup(mode, &path)?);
        }
        // Failures above keep the app writable; a failed install explicitly cancels this flag.
        PREPARED.store(true, Ordering::SeqCst);
        Ok(paths)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_app_update() -> Result<(), String> {
    let _guard = MUTATIONS.lock().map_err(|_| "数据库繁忙")?;
    PREPARED.store(false, Ordering::SeqCst);
    Ok(())
}
