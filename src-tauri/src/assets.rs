use crate::model::*;
pub fn direction(action: &str) -> Option<&'static str> { match action { "fund_buy" | "deposit_in" => Some("out"), "fund_sell" | "deposit_out" => Some("in"), _ => None } }
pub fn matches(rule: &Rule, t: &Transaction) -> bool {
    if rule.merchant.as_ref().is_some_and(|m| !m.is_empty() && m != &t.merchant) { return false; }
    if !rule.keyword.is_empty() && !t.merchant.contains(&rule.keyword) && !t.note.contains(&rule.keyword) { return false; }
    if let Some(action) = rule.action.as_deref().filter(|a| *a != "category") { if t.flow != "unknown" && direction(action) != Some(t.flow.as_str()) { return false; } }
    !rule.keyword.trim().is_empty() || rule.merchant.as_ref().is_some_and(|m| !m.trim().is_empty())
}
pub fn validate_target(accounts: &[Account], action: &str, id: &str) -> Result<(), String> {
    if direction(action).is_none() { return Err("资金用途无效".into()); }
    let purpose = if action.starts_with("fund_") { "fund" } else { "deposit" };
    if !accounts.iter().any(|a| a.id == id && a.purpose.as_deref() == Some(purpose)) { return Err("请选择对应基金或存款账户".into()); }
    Ok(())
}
pub fn assign(accounts: &[Account], t: &mut Transaction, action: &str, id: &str) -> Result<(), String> {
    validate_target(accounts, action, id)?;
    if t.account_id == id { return Err("来源账户与目标账户不能相同".into()); }
    if t.flow != "unknown" && Some(t.flow.as_str()) != direction(action) { return Err("资金用途与原始流入流出方向不一致".into()); }
    if t.source_kind.is_none() { t.source_kind = Some(t.kind.clone()); }
    t.kind = "transfer".into(); t.category = "未分类".into(); t.asset_action = Some(action.into()); t.target_account_id = Some(id.into()); Ok(())
}
pub fn validate_rule(l: &Ledger, rule: &Rule) -> Result<(), String> {
    if rule.keyword.trim().is_empty() && rule.merchant.as_ref().is_none_or(|m| m.trim().is_empty()) { return Err("请填写商户或商品关键词".into()); }
    if let Some(action) = rule.action.as_deref().filter(|a| *a != "category") { validate_target(&l.accounts, action, rule.target_account_id.as_deref().unwrap_or("")) }
    else if !l.categories.contains(&rule.category) { Err("规则分类不存在".into()) } else { Ok(()) }
}
pub fn apply_rule(accounts: &[Account], t: &mut Transaction, rule: &Rule) -> Result<(), String> {
    if let Some(action) = rule.action.as_deref().filter(|a| *a != "category") { assign(accounts, t, action, rule.target_account_id.as_deref().unwrap_or("")) }
    else { t.category = rule.category.clone(); Ok(()) }
}
