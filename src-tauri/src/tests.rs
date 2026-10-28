use super::*;
use std::collections::BTreeMap;

fn fixture() -> Ledger {
    let mut l = Ledger::default();
    l.accounts.push(Account { id: "bank".into(), name: "银行卡".into(), channel: "银行卡".into(), suffix: "".into(), opening_cents: None, opening_date: "2026-10-01".into(), complete: false, purpose: None });
    l.batches.push(Batch { id: "batch".into(), name: "test.csv".into(), hash: "test".into(), account_id: "bank".into(), channel: "银行卡".into(), imported_at: "2026-10-26T00:00:00Z".into(), count: 3, skipped: 0, original_name: "test.csv".into() });
    for (id, kind, amount, day) in [("a", "expense", 10000, "10"), ("b", "expense", 10000, "10"), ("r", "refund", 2500, "11")] {
        l.raw_rows.push(RawRow { id: format!("raw-{id}"), batch_id: "batch".into(), row_number: 2, values: BTreeMap::new() });
        l.transactions.push(Transaction { id: id.into(), date: format!("2026-10-{day} 12:00:00"), merchant: "商户".into(), amount_cents: amount, kind: kind.into(), flow: if kind == "refund" { "in".into() } else { "out".into() }, channel: "银行卡".into(), account_id: "bank".into(), category: "未分类".into(), reference: id.into(), note: "".into(), batch_id: "batch".into(), raw_id: format!("raw-{id}"), balance_impact_cents: None, source_event: String::new(), source_kind: None, asset_action: None, target_account_id: None });
    }
    l
}
#[test]
fn exact_money_and_invalid_dates() { assert_eq!(domain::parse_cents("￥1,234.56").unwrap(), 123456); assert!(domain::parse_cents("0.001").is_err()); assert!(domain::parse_date("2026-02-30").is_err()); }
#[test]
fn duplicate_refund_and_undo() {
    let mut l = fixture();
    domain::apply(&mut l, Action::Relate { relation: Relation { id: "d".into(), r#type: "duplicate".into(), primary_id: "a".into(), secondary_id: "b".into() } }).unwrap();
    assert_eq!(domain::totals(&l, "2026-10").expense, 7500);
    domain::apply(&mut l, Action::Unrelate { id: "d".into() }).unwrap();
    domain::apply(&mut l, Action::Relate { relation: Relation { id: "r".into(), r#type: "refund".into(), primary_id: "a".into(), secondary_id: "r".into() } }).unwrap();
    assert_eq!(domain::totals(&l, "2026-10-11").expense, -2500);
    assert_eq!(domain::totals(&l, "2026-10").expense, 17500);
}
#[test]
fn csv_preview_reliable_ids_and_row_errors() {
    let l = fixture();
    let bytes = "日期,金额,类型,单号\n2026-10-26,12.30,支出,a\n2026-10-26,19.90,支出,new\n2026-10-26,19.90,支出,new\n2026-02-30,22,支出,error\n".as_bytes().to_vec();
    let sheet = importer::read("test.csv".into(), bytes).unwrap();
    let mapping = Mapping { date: "日期".into(), amount: "金额".into(), kind: "类型".into(), reference: "单号".into(), merchant: "".into(), note: "".into() };
    let p = importer::preview(&l, &sheet, &mapping, "bank", "银行卡", &BTreeMap::new()).unwrap();
    assert_eq!(p.skipped, 2); assert_eq!(p.transactions.len(), 1); assert_eq!(p.errors[0].row, 5);
}
#[test]
fn sqlite_transaction_rollback_and_snapshot() {
    let temp = tempfile::tempdir().unwrap(); let path = temp.path().join("ledger.db");
    let mut conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE value(n INTEGER); INSERT INTO value VALUES(1)").unwrap();
    { let tx = conn.transaction().unwrap(); tx.execute("UPDATE value SET n=2", []).unwrap(); }
    assert_eq!(conn.query_row("SELECT n FROM value", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    let mut target = rusqlite::Connection::open(temp.path().join("snapshot.db")).unwrap();
    { let backup = rusqlite::backup::Backup::new(&conn, &mut target).unwrap(); backup.run_to_completion(5, std::time::Duration::from_millis(1), None).unwrap(); }
    assert_eq!(target.query_row("SELECT n FROM value", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
}

#[test]
fn alipay_metadata_status_zero_and_funding_sources() {
    let preamble = (0..23).map(|i| format!("说明行{i}\r\n")).collect::<String>();
    let header = format!("{},\n", alipay::HEADERS.join(","));
    let data = "2026-10-26 12:00:00,餐饮美食,虚构商户,sample,示例,支出,12.30,花呗&红包,交易成功,order1,s1,,\n2026-10-26 13:00:00,餐饮美食,虚构商户,sample,示例,支出,0.00,账户余额,支付成功,order2,s2,,\n2026-10-26 14:00:00,餐饮美食,虚构商户,sample,示例,支出,20,花呗,交易关闭,order3,s3,,\n2026-10-26 15:00:00,投资理财,示例基金,sample,基金买入,不计收支,100,余额宝,交易成功,order4,s4,,\n2026-10-26 16:00:00,退款,示例基金,sample,基金退款,不计收支,100,余额宝,交易成功,order4,s4,,\n";
    let sheet = importer::read("alipay.csv".into(), format!("{preamble}{header}{data}").as_bytes().to_vec()).unwrap();
    assert_eq!(sheet.format, "alipay"); assert_eq!(sheet.header_row, 24); assert_eq!(sheet.row_numbers[0], 25);
    let mapping = Mapping { date: "交易时间".into(), amount: "金额".into(), kind: "收/支".into(), merchant: "交易对方".into(), reference: "交易订单号".into(), note: "备注".into() };
    let p = importer::preview(&Ledger::default(), &sheet, &mapping, "", "支付宝", &BTreeMap::new()).unwrap();
    assert!(p.errors.is_empty()); assert_eq!(p.transactions.len(), 4); assert_eq!(p.ignored, 1); assert_eq!(p.raw_rows.len(), 5); assert_eq!(p.neutral_count, 2); assert_eq!(p.skipped, 0); assert_eq!(p.proposed_accounts.len(), 3);
    assert!(p.transactions.iter().all(|t| t.balance_impact_cents.is_none()));
}

#[test]
#[ignore = "Requires user-provided local sample path; reads only, never writes financial data"]
fn verify_local_alipay_sample() {
    let path = std::env::var("QINGHE_ALIPAY_SAMPLE").expect("Set QINGHE_ALIPAY_SAMPLE to a local CSV");
    let bytes = std::fs::read(&path).unwrap();
    let sheet = importer::read("alipay.csv".into(), bytes).unwrap();
    let mapping = Mapping { date: "交易时间".into(), amount: "金额".into(), kind: "收/支".into(), merchant: "交易对方".into(), reference: "交易订单号".into(), note: "备注".into() };
    let p = importer::preview(&Ledger::default(), &sheet, &mapping, "", "支付宝", &BTreeMap::new()).unwrap();
    assert!(p.errors.is_empty(), "Source contains unrecognized rows");
    let active: Vec<_> = sheet.rows.iter().filter(|r| !alipay::ignored(r)).collect();
    assert_eq!(p.transactions.len(), active.len(), "Active events must not be dropped");
    let original_total: i128 = active.iter().map(|r| { let value = alipay::get(r, "金额"); if value.parse::<f64>().unwrap() == 0.0 { 0 } else { domain::parse_cents(value).unwrap() as i128 } }).sum();
    assert_eq!(p.transactions.iter().map(|t| t.amount_cents as i128).sum::<i128>(), original_total);
    assert_eq!(p.raw_rows.len(), sheet.rows.len());
    println!("Verified source rows: {}, active: {}, ignored: {}, neutral: {}, zero: {}; counts and amounts reconcile.", sheet.rows.len(), p.transactions.len(), p.ignored, p.neutral_count, p.transactions.iter().filter(|t| t.amount_cents == 0).count());
}

#[test]
fn ledger_backup_restore_and_failed_write_are_atomic() {
    let _guard = MUTATIONS.lock().unwrap();
    struct RestoreEnv(Option<std::ffi::OsString>);
    impl Drop for RestoreEnv { fn drop(&mut self) { match &self.0 { Some(v) => std::env::set_var("LOCALAPPDATA", v), None => std::env::remove_var("LOCALAPPDATA") } } }
    let temp = tempfile::tempdir().unwrap();
    let _restore = RestoreEnv(std::env::var_os("LOCALAPPDATA"));
    std::env::set_var("LOCALAPPDATA", temp.path());
    let original = b"synthetic original statement only";
    use sha2::Digest;
    let hash = format!("{:x}", sha2::Sha256::digest(original));
    let mut seeded = fixture(); seeded.batches[0].hash = hash.clone();
    let mut conn = storage::open("personal").unwrap();
    { let tx = conn.transaction().unwrap(); storage::save(&tx, &seeded).unwrap(); tx.execute("INSERT INTO originals(batch_id,name,hash,content) VALUES(?,?,?,?)", rusqlite::params!["batch", "synthetic.csv", hash, original]).unwrap(); tx.commit().unwrap(); }
    drop(conn);
    let linked = storage::write("personal", 0, |l, _| domain::apply(l, Action::Relate { relation: Relation { id: "d".into(), r#type: "duplicate".into(), primary_id: "a".into(), secondary_id: "b".into() } })).unwrap();
    let backup_path = temp.path().join("snapshot.qinghe");
    storage::backup("personal", &backup_path).unwrap();
    let empty = storage::write("personal", linked.revision, |l, _| domain::apply(l, Action::RevertBatch { id: "batch".into() })).unwrap();
    assert!(empty.transactions.is_empty());
    let restored = storage::restore("personal", &backup_path).unwrap();
    assert_eq!(restored.transactions.len(), 3); assert_eq!(restored.raw_rows.len(), 3); assert_eq!(restored.relations.len(), 1); assert_eq!(domain::totals(&restored, "2026-10").expense, 7500);
    let conn = storage::open("personal").unwrap();
    let saved: Vec<u8> = conn.query_row("SELECT content FROM originals WHERE batch_id='batch'", [], |r| r.get(0)).unwrap(); assert_eq!(saved, original);
    drop(conn);
    let failed = storage::write("personal", restored.revision, |l, tx| {
        l.transactions.clear(); tx.execute("DELETE FROM originals", []).unwrap(); Err("synthetic failure".into())
    });
    assert!(failed.is_err());
    let after = storage::load(&storage::open("personal").unwrap()).unwrap(); assert_eq!(after.revision, restored.revision); assert_eq!(after.transactions.len(), 3);
    assert!(storage::write("personal", 0, |_, _| Ok(())).is_err());
    assert!(storage::restore("demo", &backup_path).is_err());
    let safety = temp.path().join("PersonalFinance/personal/backups"); assert_eq!(std::fs::read_dir(safety).unwrap().count(), 1);
}
