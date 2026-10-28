import { describe, expect, it } from 'vitest';
import { applyAction, included, parseCents, previewRows, suggestions, totals, validDate } from './domain';
import { demoLedger } from './seed';
import type { ImportSheet, Mapping } from './types';

const mapping: Mapping = { date: '日期', amount: '金额', kind: '类型', merchant: '商户', reference: '单号', note: '备注' };
const sheet = (rows: Record<string, string>[], hash = 'new-file'): ImportSheet => ({ name: 'test.csv', hash, headers: ['日期', '金额', '类型', '商户', '单号', '备注'], rows, bytes: [] });
const row = (extra = {}) => ({ '日期': '2026-10-26 12:00:00', '金额': '19.90', '类型': '支出', '商户': '咖啡', '单号': '', ...extra });
describe('金额与日期的输入边界', () => {
  it('以整数分计算，不引入浮点误差', () => { expect(parseCents('￥1,234.56')).toBe(123456); expect(parseCents('0.10') + parseCents('0.20')).toBe(30); });
  it.each(['1.001', 'NaN', '1e3', '', '0', '999999999999999999999'])('拒绝无效金额 %s', s => expect(() => parseCents(s)).toThrow());
  it('拒绝不存在的日期和超出范围时间', () => { expect(() => validDate('2026-02-30')).toThrow(); expect(() => validDate('2026-10-26 25:00:00')).toThrow(); expect(validDate('2026/1/2')).toBe('2026-01-02 00:00:00'); });
});
describe('导入预览与可靠重复检测', () => {
  it('同文件同账户同渠道拦截', () => expect(previewRows(demoLedger(), sheet([row()], 'demo'), mapping, 'wx', '微信').fileDuplicate).toBe(true));
  it('可靠单号在相同账户及来源内拦截，包括当前文件内重复', () => {
    const p = previewRows(demoLedger(), sheet([row({ '单号': 'DEMO1000' }), row({ '单号': 'NEW' }), row({ '单号': 'NEW' })]), mapping, 'wx', '微信');
    expect(p.skipped).toBe(2); expect(p.transactions).toHaveLength(1);
  });
  it('无可靠单号的同时间同金额记录不会被自动删去', () => expect(previewRows(demoLedger(), sheet([row(), row()]), mapping, 'wx', '微信').transactions).toHaveLength(2));
  it('金额错误定位到原表格行号，不改写账本', () => {
    const l = demoLedger(), original = JSON.stringify(l);
    const p = previewRows(l, sheet([row(), row({ '金额': 'abc' })]), mapping, 'wx', '微信');
    expect(p.errors[0].row).toBe(3); expect(JSON.stringify(l)).toBe(original);
  });
  it('规则首个命中优先，原始凭据保留', () => { const p = previewRows(demoLedger(), sheet([row()]), mapping, 'wx', '微信'); expect(p.transactions[0].category).toBe('餐饮美食'); expect(p.rawRows[0].values['金额']).toBe('19.90'); });
});
describe('关联、退款与撤销的一致性', () => {
  it('跨平台关联只计一次，并可以撤销还原', () => {
    let l = demoLedger(); const before = totals(l).expense;
    const relation = { id: 'rel', type: 'duplicate' as const, primaryId: 'demo-8', secondaryId: 'demo-9' };
    l = applyAction(l, { type: 'relate', relation }); expect(totals(l).expense).toBe(before - 12800);
    l = applyAction(l, { type: 'unrelate', id: 'rel' }); expect(totals(l).expense).toBe(before);
  });
  it('转账不计收入支出，手续费独立支出不受影响', () => {
    let l = demoLedger(); const before = totals(l);
    l = applyAction(l, { type: 'relate', relation: { id: 'transfer', type: 'transfer', primaryId: 'demo-19', secondaryId: 'demo-20' } });
    expect(totals(l)).toEqual(before);
  });
  it('退款无需关联即可按发生日期冲减，关联不会重复抵扣', () => {
    let l = demoLedger(); l = applyAction(l, { type: 'unrelate', id: 'demo-refund' });
    const base = totals(l).expense;
    l = applyAction(l, { type: 'relate', relation: { id: 'refund', type: 'refund', primaryId: 'demo-17', secondaryId: 'demo-18' } });
    expect(totals(l).expense).toBe(base);
    expect(totals(l, included(l).filter(t => t.date.startsWith('2026-10-14'))).expense).toBe(-10000);
    const extra = { ...l.transactions.find(t => t.id === 'demo-18')!, id: 'extra', amountCents: 89900 }; l.transactions.push(extra);
    expect(() => applyAction(l, { type: 'relate', relation: { id: 'too-much', type: 'refund', primaryId: 'demo-17', secondaryId: 'extra' } })).toThrow('累计退款');
  });
  it('不允许同一记录重复参与关联', () => {
    let l = demoLedger(); l = applyAction(l, { type: 'relate', relation: { id: 'a', type: 'duplicate', primaryId: 'demo-8', secondaryId: 'demo-9' } });
    expect(() => applyAction(l, { type: 'relate', relation: { id: 'b', type: 'duplicate', primaryId: 'demo-8', secondaryId: 'demo-9' } })).toThrow();
  });
  it('已去重消费仍可关联退款，退款关联也不阻止主记录去重', () => {
    let l = demoLedger();
    l.transactions.push({ ...l.transactions.find(t => t.id === 'demo-17')!, id: 'purchase-copy' });
    l = applyAction(l, { type: 'relate', relation: { id: 'dup-purchase', type: 'duplicate', primaryId: 'demo-17', secondaryId: 'purchase-copy' } });
    l = applyAction(l, { type: 'unrelate', id: 'demo-refund' });
    l = applyAction(l, { type: 'relate', relation: { id: 'refund-again', type: 'refund', primaryId: 'demo-17', secondaryId: 'demo-18' } });
    expect(totals(l).refund).toBe(10000);
  });
  it('撤销批次同步移除流水、原始记录和关联', () => { const l = applyAction(demoLedger(), { type: 'revert_batch', id: 'demo-batch' }); expect(l.transactions).toHaveLength(0); expect(l.rawRows).toHaveLength(0); expect(l.relations).toHaveLength(0); expect(totals(l).expense).toBe(0); });
  it('候选匹配不会修改原始记录', () => { const l = demoLedger(), original = JSON.stringify(l); expect(suggestions(l).some(c => c.primaryId === 'demo-8' && c.secondaryId === 'demo-9')).toBe(true); expect(JSON.stringify(l)).toBe(original); });
  it('统计满足收入减净支出等于结余', () => { const l = demoLedger(), s = totals(l); expect(s.net).toBe(s.income - s.expense); });
});
