use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account { pub id: String, pub name: String, pub channel: String, pub suffix: String, pub opening_cents: Option<i64>, pub opening_date: String, pub complete: bool, #[serde(default)] pub purpose: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction { pub id: String, pub date: String, pub merchant: String, pub amount_cents: i64, pub kind: String, pub flow: String, pub channel: String, pub account_id: String, pub category: String, pub reference: String, pub note: String, pub batch_id: String, pub raw_id: String, #[serde(default)] pub balance_impact_cents: Option<i64>, #[serde(default)] pub source_event: String, #[serde(default)] pub source_kind: Option<String>, #[serde(default)] pub asset_action: Option<String>, #[serde(default)] pub target_account_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawRow { pub id: String, pub batch_id: String, pub row_number: usize, pub values: BTreeMap<String, String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch { pub id: String, pub name: String, pub hash: String, pub account_id: String, pub channel: String, pub imported_at: String, pub count: usize, pub skipped: usize, pub original_name: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation { pub id: String, pub r#type: String, pub primary_id: String, pub secondary_id: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule { pub id: String, pub keyword: String, pub category: String, #[serde(default)] pub merchant: Option<String>, #[serde(default)] pub action: Option<String>, #[serde(default)] pub target_account_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ledger { pub version: u32, pub revision: u64, pub accounts: Vec<Account>, pub transactions: Vec<Transaction>, pub raw_rows: Vec<RawRow>, pub batches: Vec<Batch>, pub relations: Vec<Relation>, pub rules: Vec<Rule>, pub categories: Vec<String> }
impl Default for Ledger {
    fn default() -> Self { Self { version: 2, revision: 0, accounts: vec![], transactions: vec![], raw_rows: vec![], batches: vec![], relations: vec![], rules: vec![], categories: ["餐饮美食", "购物消费", "交通出行", "居家生活", "休闲娱乐", "医疗健康", "工资收入", "其他收入", "未分类"].into_iter().map(String::from).collect() } }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    SaveAccount { account: Account }, Classify { ids: Vec<String>, category: String }, Relate { relation: Relation },
    Unrelate { id: String }, SetKind { id: String, kind: String }, SaveRule { rule: Rule, #[serde(default, rename = "applyExisting")] apply_existing: bool }, DeleteRule { id: String },
    AssignAsset { ids: Vec<String>, #[serde(rename = "assetAction")] asset_action: String, #[serde(rename = "targetAccountId")] target_account_id: String, #[serde(default)] rule: Option<Rule> },
    AddCategory { name: String }, RevertBatch { id: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Mapping { pub date: String, pub amount: String, pub kind: String, pub merchant: String, pub reference: String, pub note: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSheet { pub name: String, pub hash: String, pub headers: Vec<String>, pub rows: Vec<BTreeMap<String, String>>, pub bytes: Vec<u8>, pub format: String, pub row_numbers: Vec<usize>, pub header_row: usize, pub funding_methods: Vec<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RowError { pub row: usize, pub message: String }
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview { pub transactions: Vec<Transaction>, pub raw_rows: Vec<RawRow>, pub errors: Vec<RowError>, pub skipped: usize, pub warnings: Vec<String>, pub file_duplicate: bool, pub ignored: usize, pub neutral_count: usize, pub proposed_accounts: Vec<Account> }
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Totals { pub income: i64, pub expense: i64, pub net: i64, pub count: usize, pub refund: i64 }
