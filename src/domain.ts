import type { Action, Candidate, FundingMap, ImportPreview, ImportSheet, Ledger, Mapping, Totals, Transaction } from './types';
import { alipayKind, fundingAccount, fundingName, ignoredAlipay, refundedClosedPurchase, refundOriginals, sourceCategory } from './alipay';
import { applyRule, assignAsset, ruleMatches, validateRule } from './assets';

export const uid = () => crypto.randomUUID();
export const money = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const kindLabel = { expense: '支出', income: '收入', transfer: '转账', refund: '退款', neutral: '不计收支' };
export function parseCents(value: string): number {
  const s = value.trim().replace(/[,，¥￥\s]/g, '');
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(s)) throw new Error('金额须为最多两位小数的数字');
  const [whole, fraction = ''] = s.replace(/^[+-]/, '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('金额须大于 0 且在有效范围内');
  return cents;
}
export function validDate(s: string): string {
  const normalized = s.trim().replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw new Error('时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss');
  const [, y, m, d, h = '00', min = '00', sec = '00'] = match;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d || +h > 23 || +min > 59 || +sec > 59) throw new Error('日期或时间无效');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${min}:${sec}`;
}
export function included(ledger: Ledger): Transaction[] {
  const excluded = new Set(ledger.relations.filter(r => r.type === 'duplicate').map(r => r.secondaryId));
  return ledger.transactions.filter(t => !excluded.has(t.id));
}
export function transactionCategory(ledger: Ledger, t: Transaction): string {
  if (t.kind !== 'refund' || t.category !== '未分类') return t.category;
  const relation = ledger.relations.find(r => r.type === 'refund' && r.secondaryId === t.id);
  const original = ledger.transactions.find(x => x.id === relation?.primaryId);
  if (original) return original.category;
  const originals = refundOriginals(ledger, t).filter(x => !ledger.relations.some(r => r.type === 'duplicate' && r.secondaryId === x.id));
  return originals.length === 1 ? originals[0].category : t.category;
}
// Deterministic projection for existing imports. Raw statements stay unchanged.
export function prepareLedger(ledger: Ledger): Ledger {
  ledger.version = 2;
  const represented = new Set(ledger.transactions.map(t => t.rawId));
  const eligible = ledger.rawRows.filter(r => !represented.has(r.id) && r.values['交易状态'] === '交易关闭' && ledger.batches.some(b => b.id === r.batchId && b.channel === '支付宝'));
  if (!eligible.length) return ledger;
  const next = structuredClone(ledger), allRows = next.rawRows.map(r => r.values);
  const rawById = new Map(next.rawRows.map(r => [r.id, r]));
  for (const raw of eligible) {
    const row = raw.values;
    if (!refundedClosedPurchase(row, allRows)) continue;
    const ref = row['交易订单号'];
    if (next.transactions.some(t => t.channel === '支付宝' && t.kind === 'expense' && t.reference === ref)) continue;
    const source = fundingName(row['收/付款方式'] ?? '');
    const candidates = [...new Set(next.transactions.filter(t => t.batchId === raw.batchId && fundingName(rawById.get(t.rawId)?.values['收/付款方式'] ?? '') === source).map(t => t.accountId))];
    const account = fundingAccount(source);
    const accountId = candidates.length === 1 ? candidates[0] : account.id;
    if (!next.accounts.some(a => a.id === accountId)) next.accounts.push(account);
    const amount = row['金额'].trim();
    next.transactions.push({ id: `restored-${raw.id}`, rawId: raw.id, batchId: raw.batchId, date: validDate(row['交易时间']), amountCents: /^0+(\.0{1,2})?$/.test(amount) ? 0 : parseCents(amount), kind: 'expense', flow: 'out', channel: '支付宝', accountId, merchant: row['交易对方'] || '已退款消费', category: sourceCategory(row['交易分类'], 'expense'), reference: ref, note: '已关闭订单有全额成功退款凭据，保留原消费用于分类冲抵。', balanceImpactCents: null, sourceEvent: row['交易分类'] });
    const batch = next.batches.find(b => b.id === raw.batchId); if (batch) batch.count++;
  }
  return next;
}
export function totals(ledger: Ledger, rows = included(ledger)): Totals {
  const transfers = new Set(ledger.relations.filter(r => r.type === 'transfer').flatMap(r => [r.primaryId, r.secondaryId]));
  let income = 0, expense = 0, refund = 0;
  for (const row of rows) {
    if (transfers.has(row.id) || row.kind === 'transfer') continue;
    if (row.kind === 'income') income += row.amountCents;
    if (row.kind === 'expense') expense += row.amountCents;
    if (row.kind === 'refund') { expense -= row.amountCents; refund += row.amountCents; }
  }
  return { income, expense, net: income - expense, count: rows.length, refund };
}
export function suggestions(ledger: Ledger): Candidate[] {
  const used = new Set(ledger.relations.flatMap(r => [r.primaryId, r.secondaryId]));
  const rows = ledger.transactions.filter(t => !used.has(t.id) && (t.kind === 'income' || t.kind === 'expense'));
  const result: Candidate[] = [];
  const buckets = new Map<number, Transaction[]>();
  for (const t of rows) {
    if (t.kind === 'refund') continue;
    const bucket = buckets.get(t.amountCents) ?? [];
    for (const other of bucket) {
      if (t.channel === other.channel) continue;
      const minutes = Math.abs(Date.parse(t.date.replace(' ', 'T') + '+08:00') - Date.parse(other.date.replace(' ', 'T') + '+08:00')) / 60000;
      if (minutes > 10) continue;
      if (t.accountId !== other.accountId && t.flow !== other.flow) result.push({ type: 'transfer', primaryId: other.id, secondaryId: t.id, reason: '金额相同、资金方向相反，时间接近' });
      else if (t.flow === other.flow && t.kind === other.kind && minutes <= 5) result.push({ type: 'duplicate', primaryId: other.id, secondaryId: t.id, reason: t.channel !== other.channel ? '跨渠道金额相同，交易时间接近' : '同渠道金额与时间接近，请核对凭据' });
    }
    bucket.push(t); buckets.set(t.amountCents, bucket);
  }
  return result;
}
export function validateRelation(ledger: Ledger, relation: Extract<Action, { type: 'relate' }>['relation']) {
  const a = ledger.transactions.find(t => t.id === relation.primaryId), b = ledger.transactions.find(t => t.id === relation.secondaryId);
  if (!a || !b || a.id === b.id) throw new Error('请选择两笔不同的有效交易');
  if (relation.type === 'refund') {
    if (ledger.relations.some(r => r.type !== 'refund' && (r.secondaryId === a.id || r.primaryId === b.id || r.secondaryId === b.id || (r.type === 'transfer' && r.primaryId === a.id)))) throw new Error('交易已有关联，请先撤销原关联');
    if (a.kind !== 'expense' || b.kind !== 'refund') throw new Error('退款必须关联一笔支出');
    if (ledger.relations.some(r => r.secondaryId === b.id)) throw new Error('该退款已关联');
    const refunded = ledger.relations.filter(r => r.type === 'refund' && r.primaryId === a.id).reduce((sum, r) => sum + (ledger.transactions.find(t => t.id === r.secondaryId)?.amountCents ?? 0), 0);
    if (refunded + b.amountCents > a.amountCents) throw new Error('累计退款不能超过原消费金额');
  } else {
    if (ledger.relations.some(r => r.type !== 'refund' && [r.primaryId, r.secondaryId].some(id => id === a.id || id === b.id))) throw new Error('交易已有关联，请先撤销原关联');
    if (ledger.relations.some(r => r.type === 'refund' && ([r.primaryId, r.secondaryId].includes(b.id) || (relation.type === 'transfer' && [r.primaryId, r.secondaryId].includes(a.id))))) throw new Error('请先撤销已有退款关联');
    if (a.amountCents !== b.amountCents) throw new Error('关联交易金额必须相同，手续费应单独记录');
    if (relation.type === 'duplicate' && (a.flow !== b.flow || a.kind !== b.kind)) throw new Error('重复交易的类型与方向须一致');
    if (relation.type === 'transfer' && (a.flow === 'unknown' || b.flow === 'unknown' || a.flow === b.flow || a.accountId === b.accountId || a.kind === 'refund' || b.kind === 'refund')) throw new Error('转账需为不同账户的一出一入');
  }
}
export function applyAction(ledger: Ledger, action: Action): Ledger {
  const next = structuredClone(ledger);
  switch (action.type) {
    case 'save_account': {
      if (!action.account.name.trim()) throw new Error('请输入账户名称');
      if (action.account.openingCents !== null && !Number.isSafeInteger(action.account.openingCents)) throw new Error('期初余额无效');
      if (action.account.openingCents !== null) validDate(action.account.openingDate);
      const i = next.accounts.findIndex(a => a.id === action.account.id);
      if (i < 0) next.accounts.push(action.account); else next.accounts[i] = action.account;
      break;
    }
    case 'classify': {
      if (!next.categories.includes(action.category)) throw new Error('分类不存在');
      const ids = new Set(action.ids);
      next.transactions.forEach(t => { if (ids.has(t.id)) t.category = action.category; }); break;
    }
    case 'relate': {
      validateRelation(next, action.relation); next.relations.push(action.relation);

      break;
    }
    case 'unrelate': next.relations = next.relations.filter(r => r.id !== action.id); break;
    case 'set_kind': {
      if (next.relations.some(r => r.primaryId === action.id || r.secondaryId === action.id)) throw new Error('请先撤销交易关联');
      const t = next.transactions.find(t => t.id === action.id);
      if (!t) throw new Error('交易不存在');
      if ((action.kind === 'expense' && t.flow !== 'out') || (['refund', 'income'].includes(action.kind) && t.flow !== 'in')) throw new Error('类型与原始资金方向不符');
      t.sourceKind ??= t.kind; t.kind = action.kind; if (action.kind !== 'transfer') { t.assetAction = undefined; t.targetAccountId = undefined; } break;
    }
    case 'save_rule': {
      validateRule(next, action.rule);
      next.rules = [action.rule, ...next.rules.filter(r => r.id !== action.rule.id)];
      if (action.applyExisting) {
        const protectedIds = new Set(next.relations.flatMap(r => [r.primaryId, r.secondaryId]));
        next.transactions.filter(t => !protectedIds.has(t.id) && ruleMatches(action.rule, t)).forEach(t => applyRule(next, t, action.rule));
      }
      break;
    }
    case 'assign_asset': {
      const selected = next.transactions.filter(t => action.ids.includes(t.id));
      if (!action.ids.length || selected.length !== new Set(action.ids).size) throw new Error('流水不存在');
      if (next.relations.some(r => action.ids.includes(r.primaryId) || action.ids.includes(r.secondaryId))) throw new Error('请先撤销这些流水的关联，再调整资金用途');
      selected.forEach(t => assignAsset(next, t, action.assetAction, action.targetAccountId));
      if (action.rule) { validateRule(next, action.rule); next.rules = [action.rule, ...next.rules.filter(r => r.id !== action.rule!.id)]; }
      break;
    }
    case 'delete_rule': next.rules = next.rules.filter(r => r.id !== action.id); break;
    case 'add_category':
      if (!action.name.trim() || next.categories.includes(action.name.trim())) throw new Error('分类为空或已存在');
      next.categories.push(action.name.trim()); break;
    case 'revert_batch': {
      const ids = new Set(next.transactions.filter(t => t.batchId === action.id).map(t => t.id));
      const accounts = new Set(next.transactions.filter(t => ids.has(t.id)).map(t => t.accountId));
      next.accounts.forEach(a => { if (accounts.has(a.id)) a.complete = false; });
      next.transactions = next.transactions.filter(t => !ids.has(t.id));
      next.rawRows = next.rawRows.filter(r => r.batchId !== action.id);
      next.batches = next.batches.filter(b => b.id !== action.id);
      next.relations = next.relations.filter(r => !ids.has(r.primaryId) && !ids.has(r.secondaryId)); break;
    }
  }
  next.revision++;
  return next;
}
export function previewRows(ledger: Ledger, sheet: ImportSheet, mapping: Mapping, accountId: string, channel: Transaction['channel'], fundingMap: FundingMap = {}): ImportPreview {
  const alipay = sheet.format === 'alipay';
  const result: ImportPreview = { transactions: [], rawRows: [], errors: [], skipped: 0, warnings: [], fileDuplicate: false, ignored: 0, neutralCount: 0, proposedAccounts: [] };
  if (ledger.batches.some(b => b.hash === sheet.hash && (alipay || b.accountId === accountId) && b.channel === channel)) { result.fileDuplicate = true; return result; }
  if (!alipay && !ledger.accounts.some(a => a.id === accountId)) throw new Error('请选择资金账户');
  if (!mapping.date || !mapping.amount || !mapping.kind) throw new Error('请映射时间、金额和收支类型');
  const refs = new Set(ledger.transactions.filter(t => t.channel === channel && t.reference).map(t => `${t.accountId}|${t.reference}|${t.sourceEvent || t.sourceKind || t.kind}|${t.flow}|${t.sourceEvent ?? ''}`));
  const kinds: Record<string, Transaction['kind']> = { '支出': 'expense', '收入': 'income', '转出': 'transfer', '转入': 'transfer', '转账支出': 'transfer', '转账收入': 'transfer', '充值': 'transfer', '提现': 'transfer', '退款': 'refund', expense: 'expense', income: 'income', refund: 'refund' };
  sheet.rows.forEach((row, index) => {
    const rowNumber = sheet.rowNumbers?.[index] ?? index + 2, rawId = uid();
    result.rawRows.push({ id: rawId, batchId: '', rowNumber, values: row });
    if (alipay && ignoredAlipay(row, sheet.rows)) { result.ignored!++; return; }
    try {
      const date = validDate(row[mapping.date] ?? '');
      const amountText = row[mapping.amount] ?? '';
      const amountCents = alipay && /^[+-]?0+(\.0{1,2})?$/.test(amountText.trim()) ? 0 : parseCents(amountText);
      const direction = (row[mapping.kind] ?? '').trim();
      const adapted = alipay ? alipayKind(row, sheet.rows) : null, kind = adapted?.kind ?? kinds[direction];
      if (!kind) throw new Error(`无法识别收支类型“${direction}”，请使用收入、支出、退款、转入或转出`);
      const flow = adapted?.flow ?? (kind === 'income' || kind === 'refund' || ['转入', '转账收入', '充值'].includes(direction) ? 'in' : 'out');
      let targetAccount = accountId;
      if (alipay) {
        const source = fundingName(row['收/付款方式']), mapped = fundingMap[source];
        if (mapped && mapped !== '__auto__') {
          if (!ledger.accounts.some(a => a.id === mapped)) throw new Error(`资金来源“${source}”的指定账户不存在`);
          targetAccount = mapped;
        } else {
          const account = fundingAccount(source); targetAccount = account.id;
          if (!ledger.accounts.some(a => a.id === targetAccount) && !result.proposedAccounts!.some(a => a.id === targetAccount)) result.proposedAccounts!.push(account);
        }
      }
      const reference = (row[mapping.reference] ?? '').trim();
      const referenceKey = `${targetAccount}|${reference}|${alipay ? row['交易分类'] : kind}|${flow}|${alipay ? row['交易分类'] : ''}`;
      if (reference && refs.has(referenceKey)) { result.skipped++; return; }
      if (reference) refs.add(referenceKey);
      const merchant = row[mapping.merchant] || '未命名交易';
      const category = ledger.rules.find(r => (!r.action || r.action === 'category') && ruleMatches(r, { merchant, note: row[mapping.note] ?? '', flow }))?.category ?? (alipay ? sourceCategory(row['交易分类'], kind) : kind === 'income' ? '其他收入' : '未分类');
      const note = alipay ? [row['商品说明'], row['备注'], `支付宝：${row['交易分类']} / ${row['交易状态']} / ${row['收/付款方式'] || '未提供付款方式'}`].filter(Boolean).join(' · ') : row[mapping.note] || '';
      result.transactions.push({ id: uid(), date, amountCents, kind, flow, reference, merchant, channel, accountId: targetAccount, category, note, batchId: '', rawId, balanceImpactCents: alipay ? null : flow === 'in' ? amountCents : -amountCents, sourceEvent: alipay ? row['交易分类'] : '', sourceKind: kind });
      const transaction = result.transactions[result.transactions.length - 1];
      const rule = ledger.rules.find(r => ruleMatches(r, transaction));
      if (rule) applyRule(ledger, transaction, rule);
      if (kind === 'neutral') result.neutralCount!++;
    } catch (error) { result.errors.push({ row: rowNumber, message: (error as Error).message }); }
  });
  const combined = { ...ledger, transactions: [...ledger.transactions, ...result.transactions] };
  const incoming = new Set(result.transactions.map(t => t.id));
  const count = suggestions(combined).filter(c => incoming.has(c.primaryId) || incoming.has(c.secondaryId)).length;
  if (count) result.warnings.push(`有 ${count} 组疑似重复或转账，导入后请到待核对列表确认。`);
  if (alipay) result.warnings.push(`支付宝格式已识别：忽略 ${result.ignored} 笔关闭或失败交易；${result.neutralCount} 笔不计收支单独保留。退款按分类自动冲减支出，无需关联原单。资金来源按账单保留，账单金额不直接用于推算账户余额。`);
  return result;
}
