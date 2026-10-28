use crate::{alipay, domain::{parse_cents, parse_date}, model::*};
use calamine::{Reader, Xlsx, Data};
use sha2::{Sha256, Digest};
use std::{collections::{BTreeMap, HashSet}, io::Cursor};
use uuid::Uuid;

pub fn read(name: String, bytes: Vec<u8>) -> Result<ImportSheet, String> {
    if bytes.len() > 20 * 1024 * 1024 { return Err("文件不得超过 20 MB".into()); }
    let matrix: Vec<Vec<String>>;
    let positions: Vec<usize>;
    if name.to_lowercase().ends_with(".xlsx") {
        let mut workbook = Xlsx::new(Cursor::new(&bytes)).map_err(|e| format!("XLSX 无法读取：{e}"))?;
        let range = workbook.worksheet_range_at(0).ok_or("工作簿为空")?.map_err(|e| e.to_string())?;
        if range.get_size().0 > 50001 || range.get_size().1 > 256 { return Err("表格最多 50,000 行、256 列".into()); }
        matrix = range.rows().map(|row| row.iter().map(|v| match v {
            Data::DateTime(dt) => dt.as_datetime().map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_else(|| v.to_string()),
            _ => v.to_string(),
        }).collect::<Vec<_>>()).collect();
        positions = (1..=matrix.len()).collect();
    } else if name.to_lowercase().ends_with(".csv") {
        let content = match std::str::from_utf8(&bytes) { Ok(s) => s.trim_start_matches('\u{feff}').to_string(), Err(_) => { let (text, _, failed) = encoding_rs::GB18030.decode(&bytes); if failed { return Err("CSV 编码无法识别，请另存为 UTF-8".into()); } text.into_owned() } };
        let content = content.replace("\r\n", "\n").replace('\r', "\n");
        let mut reader = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_reader(content.as_bytes());
        let mut data = vec![]; let mut source_positions = vec![];
        for row in reader.records() { let row = row.map_err(|e| format!("CSV 解析失败：{e}"))?; source_positions.push(row.position().map(|p| p.line() as usize).unwrap_or(data.len() + 1)); data.push(row.iter().map(String::from).collect()); if data.len() > 50100 { return Err("每次最多导入 50,000 行".into()); } }
        matrix = data; positions = source_positions;
    } else { return Err("仅支持 CSV 和 XLSX".into()); }
    if matrix.len() < 2 { return Err("文件需包含表头和至少一行流水".into()); }
    let alipay_header = matrix.iter().position(|r| alipay::HEADERS.iter().all(|h| r.iter().any(|v| v.trim() == *h)));
    let header_index = alipay_header.unwrap_or(0); let format = if alipay_header.is_some() { "alipay" } else { "generic" };
    let mut headers: Vec<String> = matrix[header_index].iter().map(|s| s.trim().to_string()).collect();
    if alipay_header.is_some() { while headers.last().is_some_and(|s| s.is_empty()) { headers.pop(); } }
    let unique: HashSet<&String> = headers.iter().collect();
    if headers.len() > 256 || headers.iter().any(|s| s.is_empty()) || unique.len() != headers.len() { return Err("表头不能为空或重复，最多 256 列".into()); }
    if matrix.iter().skip(header_index + 1).any(|r| r.iter().skip(headers.len()).any(|v| !v.trim().is_empty())) { return Err("数据列数超出表头，请检查文件".into()); }
    let mut rows: Vec<BTreeMap<String, String>> = vec![]; let mut row_numbers = vec![];
    for (i, row) in matrix.iter().enumerate().skip(header_index + 1) { if row.iter().all(|s| s.trim().is_empty()) { continue; } rows.push(headers.iter().enumerate().map(|(j, h)| (h.clone(), row.get(j).map(|s| s.trim().to_string()).unwrap_or_default())).collect()); row_numbers.push(positions[i]); }
    if rows.is_empty() || rows.len() > 50000 { return Err("需包含 1 至 50,000 行流水".into()); }
    let mut funding_methods: Vec<String> = if format == "alipay" { rows.iter().filter(|r| !alipay::ignored_with_rows(r, &rows)).map(|r| alipay::funding_name(alipay::get(r, "收/付款方式"))).collect() } else { vec![] }; funding_methods.sort(); funding_methods.dedup();
    let hash = format!("{:x}", Sha256::digest(&bytes));
    Ok(ImportSheet { name, hash, headers, rows, bytes, format: format.into(), row_numbers, header_row: positions[header_index], funding_methods })
}
pub fn preview(l: &Ledger, sheet: &ImportSheet, m: &Mapping, account: &str, channel: &str, funding_map: &BTreeMap<String, String>) -> Result<Preview, String> {
    let is_alipay = sheet.format == "alipay";
    if !is_alipay && !l.accounts.iter().any(|a| a.id == account) { return Err("资金账户不存在".into()); }
    if is_alipay && channel != "支付宝" { return Err("支付宝明细必须使用支付宝渠道".into()); }
    if !["微信", "支付宝", "银行卡"].contains(&channel) { return Err("支付渠道无效".into()); }
    for field in [&m.date, &m.amount, &m.kind] { if field.is_empty() || !sheet.headers.contains(field) { return Err("请映射有效的时间、金额和收支类型".into()); } }
    let mut p = Preview::default();
    if l.batches.iter().any(|b| b.hash == sheet.hash && (is_alipay || b.account_id == account) && b.channel == channel) { p.file_duplicate = true; return Ok(p); }
    let mut refs: HashSet<String> = l.transactions.iter().filter(|t| t.channel == channel && !t.reference.is_empty()).map(|t| format!("{}|{}|{}|{}|{}", t.account_id, t.reference, if t.source_event.is_empty() { t.source_kind.as_deref().unwrap_or(&t.kind) } else { &t.source_event }, t.flow, t.source_event)).collect();
    for (index, row) in sheet.rows.iter().enumerate() {
        let get = |key: &str| row.get(key).cloned().unwrap_or_default();
        let raw_id = Uuid::new_v4().to_string(); let row_number = sheet.row_numbers.get(index).copied().unwrap_or(index + 2);
        p.raw_rows.push(RawRow { id: raw_id.clone(), batch_id: String::new(), row_number, values: row.clone() });
        if is_alipay && alipay::ignored_with_rows(row, &sheet.rows) { p.ignored += 1; continue; }
        let parsed = (|| -> Result<(String, i64, String, String), String> {
            let date = parse_date(&get(&m.date))?;
            let amount_text = get(&m.amount); let unsigned = amount_text.trim().strip_prefix('+').or_else(|| amount_text.trim().strip_prefix('-')).unwrap_or(amount_text.trim()); let parts: Vec<&str> = unsigned.split('.').collect(); let zero = parts.len() <= 2 && !parts[0].is_empty() && parts[0].chars().all(|c| c == '0') && (parts.len() == 1 || (!parts[1].is_empty() && parts[1].len() <= 2 && parts[1].chars().all(|c| c == '0')));
            let amount = if is_alipay && zero { 0 } else { parse_cents(&amount_text)? };
            if is_alipay { let (kind, flow) = alipay::kind(row, &sheet.rows)?; return Ok((date, amount, kind, flow)); }
            let raw_kind = get(&m.kind); let raw_kind = raw_kind.trim();
            let (kind, flow) = match raw_kind { "收入" | "income" => ("income", "in"), "支出" | "expense" => ("expense", "out"), "退款" | "refund" => ("refund", "in"), "转入" | "转账收入" | "充值" => ("transfer", "in"), "转出" | "转账支出" | "提现" => ("transfer", "out"), _ => return Err(format!("无法识别类型“{raw_kind}”，使用收入、支出、退款、转入或转出")) };
            Ok((date, amount, kind.into(), flow.into()))
        })();
        match parsed {
            Err(message) => p.errors.push(RowError { row: row_number, message }),
            Ok((date, amount_cents, kind, flow)) => {
                let mut target_account = account.to_string();
                if is_alipay {
                    let source = alipay::funding_name(&get("收/付款方式"));
                    match funding_map.get(&source).filter(|s| s.as_str() != "__auto__") {
                        Some(id) => { if !l.accounts.iter().any(|a| &a.id == id) { p.errors.push(RowError { row: row_number, message: format!("资金来源“{source}”的指定账户不存在") }); continue; } target_account = id.clone(); },
                        None => { let account = alipay::account(&source); target_account = account.id.clone(); if !l.accounts.iter().any(|a| a.id == target_account) && !p.proposed_accounts.iter().any(|a| a.id == target_account) { p.proposed_accounts.push(account); } },
                    }
                }
                let reference = get(&m.reference).trim().to_string();
                if !reference.is_empty() && !refs.insert(format!("{target_account}|{reference}|{}|{flow}|{}", if is_alipay { get("交易分类") } else { kind.clone() }, if is_alipay { get("交易分类") } else { String::new() })) { p.skipped += 1; continue; }
                let merchant = get(&m.merchant); let merchant = if merchant.is_empty() { "未命名交易".into() } else { merchant };
                let raw_note = get(&m.note);
                let category = l.rules.iter().find(|r| r.action.as_deref().unwrap_or("category") == "category" && r.merchant.as_ref().is_none_or(|m| m.is_empty() || m == &merchant) && (!r.keyword.is_empty() && (merchant.contains(&r.keyword) || raw_note.contains(&r.keyword)))).map(|r| r.category.clone()).unwrap_or_else(|| if is_alipay { alipay::category(&get("交易分类"), &kind) } else if kind == "income" { "其他收入".into() } else { "未分类".into() });
                let note = if is_alipay { [get("商品说明"), get("备注"), format!("支付宝：{} / {} / {}", get("交易分类"), get("交易状态"), get("收/付款方式"))].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ") } else { raw_note };
                let balance_impact_cents = if is_alipay { None } else { Some(if flow == "in" { amount_cents } else { -amount_cents }) };
                if kind == "neutral" { p.neutral_count += 1; }
                let mut transaction = Transaction { id: Uuid::new_v4().to_string(), date, merchant, amount_cents, kind: kind.clone(), flow, channel: channel.into(), account_id: target_account, category, reference, note, batch_id: String::new(), raw_id, balance_impact_cents, source_event: if is_alipay { get("交易分类") } else { String::new() }, source_kind: Some(kind), asset_action: None, target_account_id: None };
                if let Some(rule) = l.rules.iter().find(|r| crate::assets::matches(r, &transaction)) { if let Err(message) = crate::assets::apply_rule(&l.accounts, &mut transaction, rule) { p.errors.push(RowError { row: row_number, message }); continue; } }
                p.transactions.push(transaction);
            },
        }
    }
    if !p.transactions.is_empty() { p.warnings.push("退款自动抵扣支出；仅跨平台重复交易或本人转账需要核对。".into()); }
    if is_alipay { p.warnings.push(format!("支付宝格式已识别：忽略 {} 笔关闭或失败交易；{} 笔不计收支单独保留。退款按分类自动冲减支出，无需关联原单。资金来源按账单保留，不直接推算账户余额。", p.ignored, p.neutral_count)); }
    Ok(p)
}
