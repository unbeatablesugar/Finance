import { useState } from 'react';
import { Check, LoaderCircle, Plus, X } from 'lucide-react';
import { uid } from './domain';
import type { Account, Channel, Ledger } from './types';

export function assetAccountStartDate(ledger: Ledger) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return ledger.transactions.reduce((earliest, t) => t.date.slice(0, 10) < earliest ? t.date.slice(0, 10) : earliest, today);
}

export default function AssetAccountPicker({ accounts, purpose, value, onChange, onCreate, channel, openingDate, label, ariaLabel, excludedIds = [] }: {
  accounts: Account[];
  purpose: 'fund' | 'deposit';
  value: string;
  onChange: (id: string) => void;
  onCreate: (account: Account) => Promise<void>;
  channel: Channel;
  openingDate: string;
  label: string;
  ariaLabel: string;
  excludedIds?: string[];
}) {
  const [creating, setCreating] = useState(false), [name, setName] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const noun = purpose === 'fund' ? '基金账户' : '存款账户';
  const eligible = accounts.filter(a => a.purpose === purpose && !excludedIds.includes(a.id));
  const selected = eligible.some(a => a.id === value) ? value : '';

  const create = async () => {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('请填写账户名称'); return; }
    if (accounts.some(a => a.purpose === purpose && a.name.trim() === trimmed)) {
      setError('已有同名账户，请从上方选择；如它是资金来源账户，请使用另一个账户。'); return;
    }
    setSaving(true); setError('');
    try {
      const account: Account = { id: uid(), name: trimmed, purpose, channel, suffix: '', openingDate, openingCents: null, complete: false };
      await onCreate(account);
      onChange(account.id); setCreating(false); setName('');
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  return <div className="asset-account-picker">
    <label>{label}<select aria-label={ariaLabel} value={selected} disabled={saving} onChange={e => onChange(e.target.value)}>
      <option value="">{eligible.length ? `请选择${noun}` : `暂无可选${noun}，请在下方新建`}</option>
      {eligible.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select></label>
    {!creating && <button type="button" className="text-button" onClick={() => { setCreating(true); setError(''); }}><Plus size={14} />新建{noun}</button>}
    {!eligible.length && <p className="field-hint">这里仅列出{noun}，资金来源账户不能选作目标。可在这里新建；已有账户可到“我的账户”修改“账户用途”。</p>}
    {creating && <div className="asset-account-create" role="group" aria-label={`新建${noun}`}>
      <label>新{noun}名称<input aria-label={`新${noun}名称`} autoFocus aria-required="true" disabled={saving} value={name}
        placeholder={purpose === 'fund' ? '例如：沪深300基金' : '例如：小荷包'}
        onChange={e => { setName(e.target.value); setError(''); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void create(); } else if (e.key === 'Escape') { e.stopPropagation(); if (!saving) setCreating(false); } }} /></label>
      <div className="asset-account-create-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => void create()}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{saving ? '正在创建…' : '创建并选中'}</button><button type="button" className="text-button" disabled={saving} onClick={() => { setCreating(false); setError(''); }}><X size={14} />取消</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="field-hint">自动设为{noun}，无需填写余额。创建后可直接保存本笔资金归属。</p>
    </div>}
  </div>;
}
