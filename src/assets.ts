import type { AssetAction, Ledger, Rule, Transaction } from './types';
export const assetLabels: Record<AssetAction, string> = { fund_buy: '基金买入', fund_sell: '基金赎回', deposit_in: '存入存款', deposit_out: '存款取出' };
export const assetDirection = (action: AssetAction) => ['fund_buy', 'deposit_in'].includes(action) ? 'out' : 'in';
export const assetMovement = (t: Transaction) => t.assetAction ? (assetDirection(t.assetAction) === 'out' ? t.amountCents : -t.amountCents) : 0;
export function ruleMatches(rule: Rule, t: Pick<Transaction, 'merchant' | 'note' | 'flow'>): boolean {
  if (rule.merchant && rule.merchant !== t.merchant) return false;
  if (rule.keyword && !`${t.merchant} ${t.note}`.includes(rule.keyword)) return false;
  if (rule.action && rule.action !== 'category' && t.flow !== 'unknown' && assetDirection(rule.action) !== t.flow) return false;
  return Boolean(rule.merchant || rule.keyword.trim());
}
export function validateAssetTarget(ledger: Ledger, action: AssetAction, accountId: string) {
  const account = ledger.accounts.find(a => a.id === accountId);
  if (!account || account.purpose !== (action.startsWith('fund_') ? 'fund' : 'deposit')) throw new Error('请选择对应的基金账户或存款账户');
}
export function assignAsset(ledger: Ledger, t: Transaction, action: AssetAction, accountId: string) {
  validateAssetTarget(ledger, action, accountId);
  if (t.accountId === accountId) throw new Error('资金来源账户和目标账户不能相同');
  if (t.flow !== 'unknown' && t.flow !== assetDirection(action)) throw new Error('用途与资金方向不一致，请检查买入、赎回或存取方向');
  t.sourceKind ??= t.kind;
  t.kind = 'transfer'; t.category = '未分类'; t.assetAction = action; t.targetAccountId = accountId;
}
export function validateRule(ledger: Ledger, rule: Rule) {
  if (!rule.keyword.trim() && !rule.merchant?.trim()) throw new Error('请填写商户或商品关键词');
  if (rule.action && rule.action !== 'category') validateAssetTarget(ledger, rule.action, rule.targetAccountId ?? '');
  else if (!ledger.categories.includes(rule.category)) throw new Error('分类不存在');
}
export function applyRule(ledger: Ledger, t: Transaction, rule: Rule) {
  if (rule.action && rule.action !== 'category') assignAsset(ledger, t, rule.action, rule.targetAccountId ?? '');
  else t.category = rule.category;
}
