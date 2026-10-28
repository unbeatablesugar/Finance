import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { assetLabels } from './assets';
import { uid } from './domain';
import type { Account, Action, AssetAction, Ledger, Transaction } from './types';
import AssetAccountPicker, { assetAccountStartDate } from './AssetAccountPicker';
export default function AssetAssignment({ ledger, rows, act, onCreateAccount }: { ledger: Ledger; rows: Transaction[]; act: (a: Action, message?: string) => void; onCreateAccount: (account: Account) => Promise<void> }) {
  const [action, setAction] = useState<AssetAction>(rows[0]?.assetAction ?? 'fund_buy');
  const [target, setTarget] = useState(rows[0]?.targetAccountId ?? ''), [remember, setRemember] = useState(false), [keyword, setKeyword] = useState('');
  const purpose = action.startsWith('fund_') ? 'fund' : 'deposit';
  const excludedIds = rows.map(t => t.accountId);
  const accounts = ledger.accounts.filter(a => a.purpose === purpose && !excludedIds.includes(a.id));
  const merchant = rows.length && rows.every(t => t.merchant === rows[0].merchant) ? rows[0].merchant : '';
  return <section className="asset-assignment"><h3>资金用途与归属</h3><p>基金买入、赎回和存款存取均记为内部划转，不计日常收支。原付款账户与凭据保留。</p><div className="form-grid"><label>这笔钱的用途<select aria-label="资金用途" value={action} onChange={e => { setAction(e.target.value as AssetAction); setTarget(''); }}>{Object.entries(assetLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><AssetAccountPicker key={purpose} accounts={ledger.accounts} purpose={purpose} value={target} onChange={setTarget} onCreate={onCreateAccount} channel={rows[0]?.channel ?? '支付宝'} openingDate={assetAccountStartDate(ledger)} excludedIds={excludedIds} label="归入哪个账户" ariaLabel="资产归属账户" />{merchant && <><label className="checkbox-label"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>记住此商户，以后自动处理</span></label>{remember && <label>进一步限定商品关键词（可选）<input aria-label="限定商品关键词" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="例如：沪深300、申购、赎回" /><small className="field-hint">商户精确匹配“{merchant}”。同商户有多只基金时，请填基金名或操作关键词。</small></label>}</>}</div><button className="primary-button full" disabled={!target || !accounts.some(a => a.id === target)} onClick={() => act({ type: 'assign_asset', ids: rows.map(t => t.id), assetAction: action, targetAccountId: target, ...(remember && merchant ? { rule: { id: uid(), merchant, keyword: keyword.trim(), category: '未分类', action, targetAccountId: target } } : {}) }, `已记为${assetLabels[action]}，不计日常支出`)}><Check size={15} />保存 {rows.length > 1 ? `${rows.length} 笔` : ''}用途与归属<ArrowRight size={15} /></button></section>;
}
