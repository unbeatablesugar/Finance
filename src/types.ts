export type Channel = '微信' | '支付宝' | '银行卡';
export type Kind = 'expense' | 'income' | 'transfer' | 'refund' | 'neutral';
export type Mode = 'demo' | 'personal';
export type Page = 'overview' | 'transactions' | 'accounts' | 'imports' | 'reports' | 'settings';
export type AccountPurpose = 'cash' | 'fund' | 'deposit';
export type AssetAction = 'fund_buy' | 'fund_sell' | 'deposit_in' | 'deposit_out';
export interface Account {
  id: string; name: string; channel: Channel; suffix: string;
  openingCents: number | null; openingDate: string; complete: boolean;
  purpose?: AccountPurpose | null;
}
export interface Transaction {
  id: string; date: string; merchant: string; amountCents: number; kind: Kind;
  flow: 'in' | 'out' | 'unknown'; channel: Channel; accountId: string; category: string;
  reference: string; note: string; batchId: string; rawId: string;
  balanceImpactCents?: number | null;
  sourceEvent?: string;
  sourceKind?: Kind | null;
  assetAction?: AssetAction | null;
  targetAccountId?: string | null;
}
export interface RawRow { id: string; batchId: string; rowNumber: number; values: Record<string, string> }
export interface Batch {
  id: string; name: string; hash: string; accountId: string; channel: Channel;
  importedAt: string; count: number; skipped: number; originalName: string;
}
export interface Relation { id: string; type: 'duplicate' | 'refund' | 'transfer'; primaryId: string; secondaryId: string }
export interface Rule { id: string; keyword: string; category: string; merchant?: string | null; action?: AssetAction | 'category' | null; targetAccountId?: string | null }
export interface Ledger {
  version: 2; revision: number; accounts: Account[]; transactions: Transaction[];
  rawRows: RawRow[]; batches: Batch[]; relations: Relation[]; rules: Rule[]; categories: string[];
}
export interface Candidate { type: Relation['type']; primaryId: string; secondaryId: string; reason: string }
export type Field = 'date' | 'amount' | 'kind' | 'merchant' | 'reference' | 'note';
export type Mapping = Record<Field, string>;
export interface ImportSheet { name: string; hash: string; headers: string[]; rows: Record<string, string>[]; bytes: number[]; format?: 'generic' | 'alipay'; rowNumbers?: number[]; headerRow?: number; fundingMethods?: string[] }
export type FundingMap = Record<string, string>;
export interface ImportPreview {
  transactions: Transaction[]; rawRows: RawRow[]; errors: { row: number; message: string }[];
  skipped: number; warnings: string[]; fileDuplicate: boolean;
  ignored?: number; neutralCount?: number; proposedAccounts?: Account[];
}
export type Action =
  | { type: 'save_account'; account: Account }
  | { type: 'classify'; ids: string[]; category: string }
  | { type: 'relate'; relation: Relation }
  | { type: 'unrelate'; id: string }
  | { type: 'set_kind'; id: string; kind: Kind }
  | { type: 'save_rule'; rule: Rule; applyExisting?: boolean }
  | { type: 'assign_asset'; ids: string[]; assetAction: AssetAction; targetAccountId: string; rule?: Rule }
  | { type: 'delete_rule'; id: string }
  | { type: 'add_category'; name: string }
  | { type: 'revert_batch'; id: string };
export interface Totals { income: number; expense: number; net: number; count: number; refund: number }
export const CATEGORIES = ['餐饮美食', '购物消费', '交通出行', '居家生活', '休闲娱乐', '医疗健康', '工资收入', '其他收入', '未分类'];
