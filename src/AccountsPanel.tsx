import { Plus, SlidersHorizontal, Wallet } from 'lucide-react';
import { Empty } from './components';
import { included, money } from './domain';
import { assetMovement } from './assets';
import type { Account, Ledger } from './types';
export default function AccountsPanel({ ledger, hidden, onEdit, onAdd }: { ledger: Ledger; hidden: boolean; onEdit: (a: Account) => void; onAdd: () => void }) {
  const canonical = included(ledger);
  return <><div className="section-toolbar"><span className="muted">{ledger.accounts.length} 个账户 · 日常资金、基金与存款分别记录</span><button className="secondary-button" onClick={onAdd}><Plus size={16} />添加账户</button></div>{!ledger.accounts.length && <section className="panel"><Empty title="添加你的第一个账户" text="零钱、银行卡、每只基金或小荷包存款都可以独立建账。" /></section>}{(['cash', 'fund', 'deposit'] as const).map(purpose => {
    const accounts = ledger.accounts.filter(a => (a.purpose ?? 'cash') === purpose);
    if (!accounts.length) return null;
    return <section key={purpose} className="account-section"><div className="account-group-title"><h3>{purpose === 'cash' ? '日常资金账户' : purpose === 'fund' ? '基金账户' : '存款账户'}</h3><p>{purpose === 'fund' ? '每只基金独立记录买入与赎回；净投入不等于当前市值。' : purpose === 'deposit' ? '小荷包、储蓄资金等内部存取不计日常收支。' : '支付渠道与资金来源分别保留。'}</p></div><div className="account-grid">{accounts.map(a => {
      const rows = canonical.filter(t => t.accountId === a.id || t.targetAccountId === a.id), tx = rows.filter(t => t.date >= a.openingDate);
      const net = tx.reduce((sum, t) => sum + (t.targetAccountId === a.id ? assetMovement(t) : t.flow === 'in' ? t.amountCents : t.flow === 'out' ? -t.amountCents : 0), 0);
      const unknown = tx.some(t => t.accountId === a.id && (t.balanceImpactCents === null || t.flow === 'unknown'));
      const known = purpose !== 'fund' && a.openingCents !== null && a.complete && !unknown;
      const label = purpose === 'fund' ? '期间净投入' : known ? '已核对账面余额' : purpose === 'deposit' ? '期间净转入' : unknown ? '期间记账净额' : '期间净变动';
      return <article className="panel account-card" key={a.id}><div className="account-top"><span className={`account-logo ${purpose === 'fund' ? 'ali' : purpose === 'deposit' ? 'wx' : 'bank'}`}><Wallet size={23} /></span><div><h3>{a.name}</h3><span>{a.suffix || (purpose === 'fund' ? '基金买入 / 赎回' : purpose === 'deposit' ? '存入 / 取出' : a.channel)}</span></div><button className="icon-button" onClick={() => onEdit(a)} aria-label={`编辑${a.name}`}><SlidersHorizontal size={17} /></button></div><div className="account-balance"><span>{label}</span><strong>{hidden ? '••••••' : `¥ ${money(known ? a.openingCents! + net : net)}`}</strong><small className="muted">{purpose === 'fund' ? '记录买入金额 − 赎回金额，不推算市值或收益' : known ? '已有期初并确认流水完整' : unknown ? '来源账单不能还原实际扣款，余额待核对' : '期初或完整性尚未确认，余额待核对'}</small></div><div className="account-meta"><span>流水 {rows.length} 笔</span><span>{purpose === 'fund' || purpose === 'deposit' ? '账户内部划转不计支出' : a.channel}</span></div></article>;
    })}</div></section>;
  })}</>;
}
