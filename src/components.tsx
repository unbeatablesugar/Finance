import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Car, ChevronRight, Coffee, HeartPulse, House, Inbox, ShoppingBag, Sparkles, Utensils, X } from 'lucide-react';
import { included, money, totals, transactionCategory } from './domain';
import { assetLabels } from './assets';
import type { Ledger, Transaction } from './types';
export const palette = ['#286650', '#80a994', '#bacbab', '#d8b878', '#a8b8cd', '#c6aebd', '#859484', '#b3b6aa', '#dedbd1'];
export function CategoryIcon({ category, size = 18 }: { category: string; size?: number }) {
  const Icon = category.includes('餐饮') ? Utensils : category.includes('购物') ? ShoppingBag : category.includes('交通') ? Car : category.includes('居家') ? House : category.includes('医疗') ? HeartPulse : category.includes('娱乐') ? Coffee : category.includes('收入') ? ArrowDownLeft : Sparkles;
  return <Icon size={size} strokeWidth={1.7} />;
}
export function Empty({ title = '这里还没有流水', text = '导入你的第一份账单，开始看见资金的流向。', action }: { title?: string; text?: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Inbox size={28} strokeWidth={1.3} /></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function Modal({ title, sub, children, onClose, wide = false }: { title: string; sub?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Tab') {
      const nodes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]'));
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }} ref={el => { if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('button')?.focus(); }}><div className="modal-heading"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>{children}</section></div>;
}
export function Amount({ t, hidden }: { t: Transaction; hidden: boolean }) {
  return <span className={`amount ${t.kind === 'income' || t.kind === 'refund' ? 'positive' : ''}`}>{hidden ? '••••' : `${t.flow === 'unknown' ? '' : t.flow === 'in' ? '+' : '−'}${money(t.amountCents)}`}</span>;
}
export function ChannelBadge({ channel }: { channel: string }) {
  return <span className={`channel-badge ${channel === '微信' ? 'wx' : channel === '支付宝' ? 'ali' : 'bank'}`}><span />{channel}</span>;
}
export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="section-title"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
export function TrendChart({ ledger, rows, onDay, hidden }: { ledger: Ledger; rows: Transaction[]; onDay?: (date: string, end: string) => void; hidden: boolean }) {
  const dates = Array.from(new Set(rows.map(t => t.date.slice(0, 10)))).sort();
  if (!dates.length) return <Empty title="收支趋势即将呈现" text="有了流水，就能看见每天的变化。" />;
  const start = dates[0], end = dates[dates.length - 1];
  const groups = Array.from({ length: 7 }, () => [] as Transaction[]);
  const spanDays = Math.floor((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const bucketDays = Math.max(1, Math.ceil(spanDays / 7));
  rows.forEach(t => groups[Math.min(6, Math.floor((Date.parse(t.date.slice(0, 10)) - Date.parse(start)) / 86400000 / bucketDays))].push(t));
  const values = groups.map(g => totals(ledger, g));
  const max = Math.max(...values.flatMap(v => [v.income, Math.max(0, v.expense)]), 10000);
  const top = Math.ceil(max / 4 / 10000) * 40000;
  const lowest = Math.min(0, ...values.map(v => v.expense));
  const bottom = lowest < 0 ? Math.floor(lowest / 10000) * 10000 : 0;
  const y = (value: number) => 18 + (top - value) / (top - bottom) * 170;
  const zeroY = y(0);
  return <div className="trend-wrap"><svg viewBox="0 0 740 222" role="img" aria-label="七个时间区间的收入与净支出柱状图">
    <line x1="55" y1={zeroY} x2="735" y2={zeroY} stroke="#cad4c0" />{[0, 1, 2, 3, 4].map(i => <g key={i}><text x="0" y={22 + i * 43} className="chart-label">{hidden ? '••' : `${Math.round((top - (top - bottom) * i / 4) / 100)} `}</text><line x1="55" y1={18 + i * 43} x2="735" y2={18 + i * 43} stroke="#eaece6" strokeDasharray="3 5" /></g>)}
    {values.map((v, i) => {
      const x = 80 + i * 97, h1 = Math.abs(zeroY - y(v.income)), h2 = Math.abs(zeroY - y(v.expense));
      const date = new Date(Date.parse(start) + bucketDays * i * 86400000).toISOString().slice(0, 10);
      const endDate = new Date(Date.parse(date) + (bucketDays - 1) * 86400000).toISOString().slice(0, 10);
      return <g key={i} onClick={() => onDay?.(date, endDate)} onKeyDown={e => { if (e.key === 'Enter') onDay?.(date, endDate); }} tabIndex={onDay ? 0 : undefined} role={onDay ? 'button' : undefined} aria-label={`${date} 至 ${endDate} 的流水`} className={onDay ? 'chart-click' : ''}><title>{hidden ? '金额已隐藏' : `收入 ¥${money(v.income)} / 净支出 ¥${money(v.expense)}`}</title><rect x={x} y={Math.min(zeroY, y(v.income))} width="19" height={Math.max(2, h1)} rx="4" fill="#2c6b54"/><rect x={x + 25} y={Math.min(zeroY, y(v.expense))} width="19" height={Math.max(2, h2)} rx="4" fill="#c8d7bf"/><rect x={x - 10} y="5" width="70" height="190" fill="transparent"/><text x={x + 22} y="216" textAnchor="middle" className="chart-label">{date.slice(5).replace('-', '/')}</text></g>;
    })}
  </svg></div>;
}
export function categoryData(ledger: Ledger, rows: Transaction[]) {
  const result = new Map<string, number>();
  const transferIds = new Set(ledger.relations.filter(r => r.type === 'transfer').flatMap(r => [r.primaryId, r.secondaryId]));
  for (const t of rows) {
    if (transferIds.has(t.id)) continue;
    if (t.kind === 'expense') result.set(t.category, (result.get(t.category) ?? 0) + t.amountCents);
    if (t.kind === 'refund') { const category = transactionCategory(ledger, t); result.set(category, (result.get(category) ?? 0) - t.amountCents); }
  }
  return [...result].sort((a, b) => b[1] - a[1]);
}
export function CategoryChart({ ledger, rows, hidden, onCategory }: { ledger: Ledger; rows: Transaction[]; hidden: boolean; onCategory: (c: string) => void }) {
  const categories = categoryData(ledger, rows);
  const positive = categories.filter(([, v]) => v > 0), sum = positive.reduce((s, [, v]) => s + v, 0);
  if (!categories.length) return <Empty title="暂无支出分布" text="支出分类后，会在这里汇成生活的轮廓。" />;
  let offset = 0;
  return <><div className="donut-wrap"><svg viewBox="0 0 200 200" role="img" aria-label="支出分类环形图"><circle cx="100" cy="100" r="73" fill="none" stroke="#eff1eb" strokeWidth="23" />{positive.map(([name, value], i) => {
    const length = value / sum * 458.67, start = offset; offset += length;
    return <circle key={name} cx="100" cy="100" r="73" fill="none" stroke={palette[i % palette.length]} strokeWidth="23" strokeDasharray={`${Math.max(0, length - 3)} ${458.67 - Math.max(0, length - 3)}`} strokeDashoffset={-start} transform="rotate(-90 100 100)" tabIndex={0} role="button" aria-label={`查看${name}流水`} className="chart-click" onClick={() => onCategory(name)} onKeyDown={e => { if (e.key === 'Enter') onCategory(name); }}><title>{name} {hidden ? '••••' : `¥${money(value)}`}</title></circle>;
  })}<text x="100" y="91" textAnchor="middle" className="donut-label">净支出</text><text x="100" y="119" textAnchor="middle" className="donut-number">{hidden ? '••••' : money(totals(ledger, rows).expense)}</text></svg></div><div className="category-legend">{categories.filter(([, value], index) => index < 5 || value < 0).map(([name, value], i) => <button key={name} onClick={() => onCategory(name)}><span className="legend-name"><i style={{ background: palette[i] }} />{name}</span><strong>{hidden ? '••••' : `¥${money(value)}`}</strong><span>{value > 0 ? `${Math.round(value / sum * 100)}%` : '退款冲减'}</span></button>)}</div></>;
}
export function QuickTable({ rows, ledger, hidden, onSelect }: { rows: Transaction[]; ledger: Ledger; hidden: boolean; onSelect: (t: Transaction) => void }) {
  if (!rows.length) return <Empty />;
  const excluded = new Set(ledger.relations.filter(r => r.type === 'duplicate').map(r => r.secondaryId));
  return <div className="table-scroll"><table><thead><tr><th>交易 / 商户</th><th>时间</th><th>分类</th><th>支付渠道</th><th className="align-right">金额</th><th /></tr></thead><tbody>{rows.map(t => <tr key={t.id} className="click-row" onClick={() => onSelect(t)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onSelect(t); }}><td><div className="merchant-cell"><span className={`category-icon cat-${t.kind}`}><CategoryIcon category={t.category} /></span><div><strong>{t.merchant}</strong><small>{ledger.accounts.find(a => a.id === t.accountId)?.name ?? '未指定账户'}{t.assetAction ? ` → ${ledger.accounts.find(a => a.id === t.targetAccountId)?.name ?? '资产账户'} · 不计日常收支` : t.kind === 'neutral' ? ' · 不计收支' : excluded.has(t.id) ? ' · 已关联，汇总不重复计入' : ''}</small></div></div></td><td className="muted">{t.date.slice(5, 16).replace('-', '/')}</td><td><span className="category-pill">{t.assetAction ? assetLabels[t.assetAction] : transactionCategory(ledger, t)}</span></td><td><ChannelBadge channel={t.channel} /></td><td className="align-right"><Amount t={t} hidden={hidden} /></td><td><ChevronRight size={15} className="muted" /></td></tr>)}</tbody></table></div>;
}
export function Stats({ ledger, rows, hidden, previous }: { ledger: Ledger; rows: Transaction[]; hidden: boolean; previous?: Transaction[] }) {
  const s = totals(ledger, rows), prev = previous ? totals(ledger, previous) : undefined;
  const items = [
    { label: '总收入', value: s.income, prev: prev?.income, icon: ArrowDownLeft, cls: 'income', note: '每一份努力，都有回响' },
    { label: '净支出', value: s.expense, prev: prev?.expense, icon: ArrowUpRight, cls: 'expense', note: '已按退款发生日自动抵扣' },
    { label: '本期结余', value: s.net, prev: undefined, icon: Sparkles, cls: 'net', note: '收入 − 净支出' },
  ];
  return <div className="stats-grid">{items.map(item => <div className={`stat-card ${item.cls}`} key={item.label}><div className="stat-top"><span>{item.label}</span><span className="stat-icon"><item.icon size={19} /></span></div><div className="stat-value"><small>¥</small>{hidden ? '••••••' : money(item.value)}</div><div className="stat-bottom">{item.prev !== undefined && item.prev > 0 ? <><span className="comparison">{item.value >= item.prev ? '↑' : '↓'} {Math.abs((item.value - item.prev) / item.prev * 100).toFixed(1)}%</span><span>较上期</span></> : <span>{item.note}</span>}</div></div>)}<div className="stat-card"><div className="stat-top"><span>交易笔数</span><span className="stat-icon neutral"><ShoppingBag size={18} /></span></div><div className="stat-value">{hidden ? '••' : s.count}<small className="unit">笔</small></div><div className="stat-bottom"><span>已剔除确认的重复记录</span></div></div></div>;
}
export function periodRows(ledger: Ledger, period: string, year = false) { return included(ledger).filter(t => !period || t.date.startsWith(year ? period.slice(0, 4) : period)); }
