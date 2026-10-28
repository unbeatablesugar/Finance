use crate::model::*;
use std::collections::BTreeMap;
pub const HEADERS: [&str; 12] = ["交易时间", "交易分类", "交易对方", "对方账号", "商品说明", "收/支", "金额", "收/付款方式", "交易状态", "交易订单号", "商家订单号", "备注"];
pub fn get<'a>(row: &'a BTreeMap<String, String>, key: &str) -> &'a str { row.get(key).map(String::as_str).unwrap_or("") }
fn statement_cents(value: &str) -> Option<i64> {
    let text: String = value.trim().chars().filter(|c| !matches!(c, ',' | '，' | '¥' | '￥') && !c.is_whitespace()).collect();
    let parts: Vec<_> = text.split('.').collect();
    if parts.len() > 2 || parts[0].is_empty() || !parts[0].bytes().all(|b| b.is_ascii_digit()) || (parts.len() == 2 && (parts[1].is_empty() || parts[1].len() > 2 || !parts[1].bytes().all(|b| b.is_ascii_digit()))) { return None; }
    let major = parts[0].parse::<i64>().ok()?;
    let minor = if parts.len() == 2 { format!("{:0<2}", parts[1]).parse::<i64>().ok()? } else { 0 };
    major.checked_mul(100)?.checked_add(minor).filter(|v| *v <= 9_007_199_254_740_991)
}
pub fn refunded_closed_purchase(row: &BTreeMap<String, String>, rows: &[BTreeMap<String, String>]) -> bool {
    let reference = get(row, "交易订单号");
    if get(row, "交易状态") != "交易关闭" || get(row, "收/支") != "支出" || reference.len() < 16 || get(row, "交易分类") == "投资理财" { return false; }
    let Some(amount) = statement_cents(get(row, "金额")) else { return false; };
    let unique: std::collections::HashMap<_, _> = rows.iter().filter(|r| get(r, "交易状态") == "退款成功" && get(r, "交易订单号").contains(reference) && get(r, "交易时间") >= get(row, "交易时间")).map(|r| (get(r, "交易订单号"), r)).collect();
    let matches: Vec<_> = unique.values().copied().collect();
    if matches.is_empty() { return false; }
    let sum = matches.iter().try_fold(0i64, |sum, r| sum.checked_add(statement_cents(get(r, "金额"))?));
    sum == Some(amount)
}
pub fn ignored_with_rows(row: &BTreeMap<String, String>, rows: &[BTreeMap<String, String>]) -> bool { ["交易关闭", "还款失败", "支付失败", "交易失败"].contains(&get(row, "交易状态")) && !refunded_closed_purchase(row, rows) }
pub fn ignored(row: &BTreeMap<String, String>) -> bool { ignored_with_rows(row, &[]) }
pub fn funding_name(method: &str) -> String {
    let primary = method.split('&').next().unwrap_or("").trim();
    if primary.is_empty() { return "未提供资金来源".into(); }
    if primary.starts_with("花呗") { return "花呗".into(); }
    if primary.starts_with("支付宝小荷包") { return "支付宝小荷包".into(); }
    match primary { "账户余额" | "余额" => "支付宝余额".into(), "余额宝" => "支付宝余额宝".into(), "红包" | "数字人民币立减" => "优惠抵扣".into(), _ => primary.strip_prefix("工商银行").map(|tail| format!("中国工商银行{tail}")).unwrap_or_else(|| primary.into()) }
}
pub fn account(name: &str) -> Account {
    let hex = name.as_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>();
    Account { id: format!("alipay-source-{hex}"), name: name.into(), channel: if name.contains("银行") && name.contains('卡') { "银行卡".into() } else { "支付宝".into() }, suffix: "支付宝账单来源 · 余额待核对".into(), opening_cents: None, opening_date: "2026-01-01".into(), complete: false, purpose: None }
}
pub fn kind(row: &BTreeMap<String, String>, rows: &[BTreeMap<String, String>]) -> Result<(String, String), String> {
    let status = get(row, "交易状态");
    if refunded_closed_purchase(row, rows) { return Ok(("expense".into(), "out".into())); }
    if !["交易成功", "支付成功", "还款成功", "退款成功", "付款成功，份额确认中"].contains(&status) { return Err(format!("未知支付宝交易状态“{status}”，请先核对")); }
    if get(row, "交易分类") == "退款" || status == "退款成功" {
        let reference = get(row, "交易订单号"); let description = get(row, "商品说明");
        let investment = ["基金", "理财", "赎回"].iter().any(|k| description.contains(k)) || rows.iter().any(|r| get(r, "交易分类") == "投资理财" && !get(r, "交易订单号").is_empty() && reference.contains(get(r, "交易订单号")));
        return Ok(if investment { ("neutral".into(), "unknown".into()) } else { ("refund".into(), "in".into()) });
    }
    match get(row, "收/支") { "不计收支" => Ok(("neutral".into(), "unknown".into())), "收入" => Ok(("income".into(), "in".into())), "支出" => Ok(("expense".into(), "out".into())), mark => Err(format!("未知支付宝收支标记“{mark}”")) }
}
pub fn category(source: &str, kind: &str) -> String {
    if kind == "income" { return "其他收入".into(); }
    match source { "餐饮美食" => "餐饮美食", "文化休闲" | "酒店旅游" => "休闲娱乐", "日用百货" | "数码电器" | "服饰装扮" | "运动户外" | "母婴亲子" => "购物消费", "家居家装" | "生活服务" | "公共服务" | "充值缴费" => "居家生活", "交通出行" | "爱车养车" => "交通出行", "医疗健康" | "美容美发" => "医疗健康", _ => "未分类" }.into()
}
