use crate::model::*;
use chrono::NaiveDateTime;
use std::collections::HashSet;

pub fn parse_cents(value: &str) -> Result<i64, String> {
    let s: String = value.trim().chars().filter(|c| !matches!(c, ',' | '，' | '¥' | '￥') && !c.is_whitespace()).collect();
    let s = s.strip_prefix('+').or_else(|| s.strip_prefix('-')).unwrap_or(&s);
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() > 2 || parts[0].is_empty() || !parts[0].bytes().all(|b| b.is_ascii_digit()) || (parts.len() == 2 && (parts[1].is_empty() || parts[1].len() > 2 || !parts[1].bytes().all(|b| b.is_ascii_digit()))) { return Err("金额须为最多两位小数的数字".into()); }
    let major: i64 = parts[0].parse().map_err(|_| "金额超出有效范围")?;
    let fraction = if parts.len() == 2 { format!("{:0<2}", parts[1]).parse::<i64>().map_err(|_| "金额无效")? } else { 0 };
    let cents = major.checked_mul(100).and_then(|x| x.checked_add(fraction)).ok_or("金额超出有效范围")?;
    if cents <= 0 || cents > 9_007_199_254_740_991 { return Err("金额须大于 0 且在有效范围内".into()); }
    Ok(cents)
}
pub fn parse_date(value: &str) -> Result<String, String> {
    let s = value.trim().replace('/', "-").replace('T', " ");
    let with_time = if s.len() <= 10 { format!("{} 00:00:00", s) } else if s.matches(':').count() == 1 { format!("{}:00", s) } else { s };
    NaiveDateTime::parse_from_str(&with_time, "%Y-%m-%d %H:%M:%S").map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string()).map_err(|_| "日期或时间无效，使用 YYYY-MM-DD HH:mm:ss".into())
}
pub fn prepare_ledger(l: &mut Ledger) {
    let represented: HashSet<String> = l.transactions.iter().map(|t| t.raw_id.clone()).collect();
    let candidates: Vec<_> = l.raw_rows.iter().filter(|r| !represented.contains(&r.id) && crate::alipay::get(&r.values, "交易状态") == "交易关闭" && l.batches.iter().any(|b| b.id == r.batch_id && b.channel == "支付宝")).cloned().collect();
    if candidates.is_empty() { return; }
    let all_rows: Vec<_> = l.raw_rows.iter().map(|r| r.values.clone()).collect();
    let sources: std::collections::HashMap<_, _> = l.raw_rows.iter().map(|r| (r.id.clone(), crate::alipay::funding_name(crate::alipay::get(&r.values, "收/付款方式")))).collect();
    for raw in candidates {
        let get = |key| crate::alipay::get(&raw.values, key);
        if !crate::alipay::refunded_closed_purchase(&raw.values, &all_rows) { continue; }
        let reference = get("交易订单号");
        if l.transactions.iter().any(|t| t.channel == "支付宝" && t.kind == "expense" && t.reference == reference) { continue; }
        let Ok(date) = parse_date(get("交易时间")) else { continue; };
        let amount_cents = match parse_cents(get("金额")) { Ok(v) => v, Err(_) if get("金额").chars().all(|c| c == '0' || c == '.') => 0, Err(_) => continue };
        let source = crate::alipay::funding_name(get("收/付款方式"));
        let accounts: HashSet<_> = l.transactions.iter().filter(|t| t.batch_id == raw.batch_id && sources.get(&t.raw_id) == Some(&source)).map(|t| t.account_id.clone()).collect();
        let account = crate::alipay::account(&source);
        let account_id = if accounts.len() == 1 { accounts.into_iter().next().unwrap() } else { account.id.clone() };
        if !l.accounts.iter().any(|a| a.id == account_id) { l.accounts.push(account); }
        l.transactions.push(Transaction { id: format!("restored-{}", raw.id), date, merchant: get("交易对方").into(), amount_cents, kind: "expense".into(), flow: "out".into(), channel: "支付宝".into(), account_id, category: crate::alipay::category(get("交易分类"), "expense"), reference: reference.into(), note: "已关闭订单有全额成功退款凭据，保留原消费用于分类冲抵。".into(), batch_id: raw.batch_id.clone(), raw_id: raw.id.clone(), balance_impact_cents: None, source_event: get("交易分类").into(), source_kind: Some("expense".into()), asset_action: None, target_account_id: None });
        if let Some(batch) = l.batches.iter_mut().find(|b| b.id == raw.batch_id) { batch.count += 1; }
    }
}
pub fn totals(ledger: &Ledger, period: &str) -> Totals {
    let excluded: HashSet<&str> = ledger.relations.iter().filter(|r| r.r#type == "duplicate").map(|r| r.secondary_id.as_str()).collect();
    let transfers: HashSet<&str> = ledger.relations.iter().filter(|r| r.r#type == "transfer").flat_map(|r| [r.primary_id.as_str(), r.secondary_id.as_str()]).collect();
    let mut result = Totals::default();
    for t in &ledger.transactions {
        if !t.date.starts_with(period) || excluded.contains(t.id.as_str()) { continue; }
        result.count += 1;
        if transfers.contains(t.id.as_str()) || t.kind == "transfer" { continue; }
        match t.kind.as_str() { "income" => result.income += t.amount_cents, "expense" => result.expense += t.amount_cents, "refund" => { result.expense -= t.amount_cents; result.refund += t.amount_cents; }, _ => {} }
    }
    result.net = result.income - result.expense; result
}
pub fn validate_relation(l: &Ledger, r: &Relation) -> Result<(), String> {
    let a = l.transactions.iter().find(|t| t.id == r.primary_id).ok_or("主交易不存在")?;
    let b = l.transactions.iter().find(|t| t.id == r.secondary_id).ok_or("关联交易不存在")?;
    if a.id == b.id { return Err("请选择两笔不同的交易".into()); }
    match r.r#type.as_str() {
        "refund" => {
            if l.relations.iter().any(|x| x.r#type != "refund" && (x.secondary_id == a.id || x.primary_id == b.id || x.secondary_id == b.id || (x.r#type == "transfer" && x.primary_id == a.id))) { return Err("交易已有关联，请先撤销".into()); }
            if a.kind != "expense" || b.kind != "refund" { return Err("退款须关联原支出".into()); }
            if l.relations.iter().any(|x| x.secondary_id == b.id) { return Err("退款已关联".into()); }
            let refunded: i64 = l.relations.iter().filter(|x| x.r#type == "refund" && x.primary_id == a.id).filter_map(|x| l.transactions.iter().find(|t| t.id == x.secondary_id)).map(|t| t.amount_cents).sum();
            if refunded + b.amount_cents > a.amount_cents { return Err("累计退款不能超过原消费".into()); }
        },
        "duplicate" | "transfer" => {
            if l.relations.iter().any(|x| x.r#type != "refund" && (x.primary_id == a.id || x.secondary_id == a.id || x.primary_id == b.id || x.secondary_id == b.id)) { return Err("交易已有关联，请先撤销".into()); }
            if l.relations.iter().any(|x| x.r#type == "refund" && (x.primary_id == b.id || x.secondary_id == b.id || (r.r#type == "transfer" && (x.primary_id == a.id || x.secondary_id == a.id)))) { return Err("请先撤销已有退款关联".into()); }
            if a.amount_cents != b.amount_cents { return Err("关联交易金额必须相同，手续费单独记录".into()); }
            if r.r#type == "duplicate" && (a.flow != b.flow || a.kind != b.kind) { return Err("重复交易的类型与方向须一致".into()); }
            if r.r#type == "transfer" && (a.flow == "unknown" || b.flow == "unknown" || a.flow == b.flow || a.account_id == b.account_id || a.kind == "refund" || b.kind == "refund") { return Err("转账须为不同账户的一出一入".into()); }
        },
        _ => return Err("无效关联类型".into()),
    }
    Ok(())
}
pub fn apply(l: &mut Ledger, action: Action) -> Result<(), String> {
    match action {
        Action::SaveAccount { account } => {
            if account.id.is_empty() || account.name.trim().is_empty() || !["微信", "支付宝", "银行卡"].contains(&account.channel.as_str()) { return Err("账户信息无效".into()); }
            if account.opening_cents.is_some_and(|v| v.unsigned_abs() > 9_007_199_254_740_991) { return Err("期初余额超出范围".into()); }
            parse_date(&account.opening_date)?;
            if let Some(a) = l.accounts.iter_mut().find(|a| a.id == account.id) { *a = account; } else { l.accounts.push(account); }
        },
        Action::Classify { ids, category } => {
            if !l.categories.contains(&category) { return Err("分类不存在".into()); }
            let ids: HashSet<String> = ids.into_iter().collect();
            for t in &mut l.transactions { if ids.contains(&t.id) { t.category = category.clone(); } }
        },
        Action::Relate { relation } => {
            validate_relation(l, &relation)?; if l.relations.iter().any(|r| r.id == relation.id) { return Err("关联 ID 重复".into()); }
            l.relations.push(relation);
        },
        Action::Unrelate { id } => l.relations.retain(|r| r.id != id),
        Action::SetKind { id, kind } => {
            if l.relations.iter().any(|r| r.primary_id == id || r.secondary_id == id) { return Err("请先撤销关联".into()); }
            let t = l.transactions.iter_mut().find(|t| t.id == id).ok_or("交易不存在")?;
            if !["expense", "income", "transfer", "refund", "neutral"].contains(&kind.as_str()) || (kind == "expense" && t.flow != "out") || (["income", "refund"].contains(&kind.as_str()) && t.flow != "in") { return Err("类型与原始资金方向不符".into()); } if t.source_kind.is_none() { t.source_kind = Some(t.kind.clone()); } if kind != "transfer" { t.asset_action = None; t.target_account_id = None; } t.kind = kind;
        },
        Action::SaveRule { rule, apply_existing } => {
            crate::assets::validate_rule(l, &rule)?;
            if apply_existing { let protected: HashSet<_> = l.relations.iter().flat_map(|r| [r.primary_id.clone(), r.secondary_id.clone()]).collect(); for t in &mut l.transactions { if !protected.contains(&t.id) && crate::assets::matches(&rule, t) { crate::assets::apply_rule(&l.accounts, t, &rule)?; } } }
            l.rules.retain(|r| r.id != rule.id); l.rules.insert(0, rule);
        },
        Action::AssignAsset { ids, asset_action, target_account_id, rule } => {
            if ids.is_empty() || ids.iter().any(|id| !l.transactions.iter().any(|t| &t.id == id)) { return Err("流水不存在".into()); }
            if l.relations.iter().any(|r| ids.contains(&r.primary_id) || ids.contains(&r.secondary_id)) { return Err("请先撤销流水关联，再调整用途".into()); }
            for t in &mut l.transactions { if ids.contains(&t.id) { crate::assets::assign(&l.accounts, t, &asset_action, &target_account_id)?; } }
            if let Some(rule) = rule { crate::assets::validate_rule(l, &rule)?; l.rules.retain(|r| r.id != rule.id); l.rules.insert(0, rule); }
        },
        Action::DeleteRule { id } => l.rules.retain(|r| r.id != id),
        Action::AddCategory { name } => { let name = name.trim().to_string(); if name.is_empty() || l.categories.contains(&name) { return Err("分类为空或已存在".into()); } l.categories.push(name); },
        Action::RevertBatch { id } => {
            let ids: HashSet<String> = l.transactions.iter().filter(|t| t.batch_id == id).map(|t| t.id.clone()).collect();
            let account_ids: HashSet<String> = l.transactions.iter().filter(|t| ids.contains(&t.id)).map(|t| t.account_id.clone()).collect();
            l.transactions.retain(|t| !ids.contains(&t.id)); l.raw_rows.retain(|r| r.batch_id != id); l.batches.retain(|b| b.id != id);
            l.relations.retain(|r| !ids.contains(&r.primary_id) && !ids.contains(&r.secondary_id));
            for a in &mut l.accounts { if account_ids.contains(&a.id) { a.complete = false; } }
        },
    }
    l.revision += 1; Ok(())
}
