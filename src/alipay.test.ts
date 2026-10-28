import { describe, expect, it } from 'vitest';
import { ALIPAY_HEADERS, fundingName, normalizedSheet } from './alipay';
import { applyAction, previewRows, totals, transactionCategory } from './domain';
import { emptyLedger } from './seed';
import type { Mapping } from './types';

const mapping: Mapping = { date: '交易时间', amount: '金额', kind: '收/支', merchant: '交易对方', reference: '交易订单号', note: '备注' };
function alipayRow(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = { '交易时间': '2026-10-26 12:00:00', '交易分类': '餐饮美食', '交易对方': '虚构餐厅', '对方账号': 'sample', '商品说明': '示例午餐', '收/支': '支出', '金额': '12.30', '收/付款方式': '花呗&红包', '交易状态': '交易成功', '交易订单号': '202610260000000000000001', '商家订单号': 'sample-order', '备注': '', ...overrides };
  return [...ALIPAY_HEADERS.map(h => base[h]), ''];
}
const sample = (rows: string[][]) => normalizedSheet('支付宝交易明细.csv', [], [...Array.from({ length: 23 }, (_, i) => [`说明行${i + 1}`]), [...ALIPAY_HEADERS, ''], ...rows], 'alipay-sample');
describe('支付宝固定格式适配', () => {
  it('识别第24行表头、末尾空列、原始行号和付款来源', () => {
    const sheet = sample([alipayRow()]); expect(sheet.format).toBe('alipay'); expect(sheet.headerRow).toBe(24); expect(sheet.headers).toHaveLength(12); expect(sheet.rowNumbers).toEqual([25]); expect(sheet.fundingMethods).toEqual(['花呗']);
  });
  it('忽略关闭、失败记录但保留原始行，包括有效零元交易', () => {
    const sheet = sample([alipayRow(), alipayRow({ '交易状态': '交易关闭', '金额': '99', '交易订单号': 'closed' }), alipayRow({ '金额': '0.00', '交易订单号': 'zero' }), alipayRow({ '交易状态': '还款失败', '金额': '0', '交易订单号': 'failed' })]);
    const p = previewRows(emptyLedger(), sheet, mapping, '', '支付宝'); expect(p.transactions).toHaveLength(2); expect(p.errors).toHaveLength(0); expect(p.ignored).toBe(2); expect(p.rawRows).toHaveLength(4); expect(p.transactions[1].amountCents).toBe(0);
  });
  it('投资与本金还款不计收支；消费退款单独保留待核对', () => {
    const p = previewRows(emptyLedger(), sample([alipayRow({ '收/支': '不计收支', '交易分类': '投资理财', '交易订单号': 'investment' }), alipayRow({ '收/支': '不计收支', '交易分类': '信用借还', '交易状态': '还款成功', '交易订单号': 'repay' }), alipayRow({ '收/支': '不计收支', '交易分类': '退款', '交易状态': '退款成功', '交易订单号': 'refund' })]), mapping, '', '支付宝');
    expect(p.neutralCount).toBe(2); expect(p.transactions[2].kind).toBe('refund'); expect(p.transactions.every(t => t.balanceImpactCents === null)).toBe(true);
  });
  it('同订单投资购买和退款不会因订单号相同而丢行', () => {
    const p = previewRows(emptyLedger(), sample([alipayRow({ '收/支': '不计收支', '交易分类': '投资理财' }), alipayRow({ '收/支': '不计收支', '交易分类': '退款', '商品说明': '基金退款' })]), mapping, '', '支付宝');
    // Both are neutral, but the same order represents different events and must be preserved.
    expect(p.errors).toHaveLength(0);
    expect(p.transactions).toHaveLength(2); expect(p.skipped).toBe(0);
  });
  it('多资金来源分开建账，银行简称归一，组合优惠保留原文', () => {
    expect(fundingName('工商银行储蓄卡(1234)&红包')).toBe('中国工商银行储蓄卡(1234)');
    const p = previewRows(emptyLedger(), sample([alipayRow(), alipayRow({ '交易订单号': 'bank-order', '收/付款方式': '工商银行储蓄卡(1234)&红包' })]), mapping, '', '支付宝');
    expect(p.proposedAccounts).toHaveLength(2); expect(p.transactions[0].accountId).not.toBe(p.transactions[1].accountId); expect(p.rawRows[0].values['收/付款方式']).toBe('花呗&红包');
  });
  it('未知状态阻止整批确认并定位源文件行', () => { const p = previewRows(emptyLedger(), sample([alipayRow({ '交易状态': '待确认新状态' })]), mapping, '', '支付宝'); expect(p.errors[0].row).toBe(25); });
  it('不把资金方向不明确的投资流水与消费强行关联为转账', () => {
    const l = emptyLedger(), p = previewRows(l, sample([alipayRow(), alipayRow({ '交易分类': '投资理财', '收/支': '不计收支', '收/付款方式': '余额宝', '交易订单号': 'investment' })]), mapping, '', '支付宝');
    l.transactions = p.transactions; l.accounts = p.proposedAccounts!;
    expect(() => applyAction(l, { type: 'relate', relation: { id: 't', type: 'transfer', primaryId: p.transactions[0].id, secondaryId: p.transactions[1].id } })).toThrow('一出一入');
  });
  it('退款分类跟随原消费，分类筛选与图表保持一致', () => {
    let l = emptyLedger(); const p = previewRows(l, sample([alipayRow(), alipayRow({ '交易分类': '退款', '收/支': '不计收支', '交易状态': '退款成功', '交易订单号': 'refund', '金额': '2.30' })]), mapping, '', '支付宝');
    l.accounts.push(...p.proposedAccounts!); l.transactions.push(...p.transactions);
    l = applyAction(l, { type: 'relate', relation: { id: 'r', type: 'refund', primaryId: p.transactions[0].id, secondaryId: p.transactions[1].id } });
    l = applyAction(l, { type: 'classify', ids: [p.transactions[0].id], category: '休闲娱乐' });
    expect(l.transactions.every(t => transactionCategory(l, t) === '休闲娱乐')).toBe(true); expect(totals(l).expense).toBe(1000);
  });
});
