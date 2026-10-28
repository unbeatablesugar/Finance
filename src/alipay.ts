import type { Account, ImportSheet, Ledger, Transaction } from './types';

export const ALIPAY_HEADERS = ['交易时间', '交易分类', '交易对方', '对方账号', '商品说明', '收/支', '金额', '收/付款方式', '交易状态', '交易订单号', '商家订单号', '备注'];
export function fundingName(method: string): string {
  const primary = method.trim().split('&')[0].trim();
  if (!primary) return '未提供资金来源';
  if (primary.startsWith('花呗')) return '花呗';
  if (['账户余额', '余额'].includes(primary)) return '支付宝余额';
  if (primary === '余额宝') return '支付宝余额宝';
  if (primary.startsWith('支付宝小荷包')) return '支付宝小荷包';
  if (['红包', '数字人民币立减'].includes(primary)) return '优惠抵扣';
  return primary.replace(/^工商银行/, '中国工商银行');
}
export function fundingAccount(name: string): Account {
  return { id: `alipay-source-${Array.from(new TextEncoder().encode(name)).map(x => x.toString(16).padStart(2, '0')).join('')}`, name, channel: /银行.*卡/.test(name) ? '银行卡' : '支付宝', suffix: '支付宝账单来源 · 余额待核对', openingCents: null, openingDate: '2026-01-01', complete: false };
}
export function normalizedSheet(name: string, bytes: number[], matrix: string[][], hash: string): ImportSheet {
  const headerIndex = matrix.findIndex(row => ALIPAY_HEADERS.every(h => row.some(v => v.trim() === h)));
  const format = headerIndex >= 0 ? 'alipay' : 'generic', index = headerIndex >= 0 ? headerIndex : 0;
  if (matrix.length <= index + 1) throw new Error('文件需要表头及至少一行流水');
  const headers = matrix[index].map(s => s.trim());
  if (format === 'alipay') while (headers.length && !headers[headers.length - 1]) headers.pop();
  if (headers.some(h => !h) || new Set(headers).size !== headers.length || headers.length > 256) throw new Error('表头不能为空或重复，最多 256 列');
  const rows: Record<string, string>[] = [], rowNumbers: number[] = [];
  matrix.slice(index + 1).forEach((r, i) => {
    if (r.every(v => !v.trim())) return;
    if (r.slice(headers.length).some(v => v.trim())) throw new Error(`第 ${index + i + 2} 行数据列数超出表头`);
    rows.push(Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? '').trim()]))); rowNumbers.push(index + i + 2);
  });
  if (rows.length > 50000) throw new Error('每次最多导入 50,000 行');
  if (!rows.length) throw new Error('没有找到流水数据');
  return { name, hash, headers, rows, bytes, format, rowNumbers, headerRow: index + 1, fundingMethods: format === 'alipay' ? [...new Set(rows.filter(r => !ignoredAlipay(r, rows)).map(r => fundingName(r['收/付款方式'])))].sort() : [] };
}
function statementCents(value: string): number | null {
  const s = value.trim().replace(/[,，¥￥\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, decimal = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
export function refundedClosedPurchase(row: Record<string, string>, rows: Record<string, string>[]): boolean {
  const ref = row['交易订单号']?.trim(), amount = statementCents(row['金额'] ?? '');
  if (row['交易状态'] !== '交易关闭' || row['收/支'] !== '支出' || !ref || ref.length < 16 || amount === null || row['交易分类'] === '投资理财') return false;
  const matches = [...new Map(rows.filter(r => r['交易状态'] === '退款成功' && r['交易订单号']?.includes(ref) && (r['交易时间'] ?? '') >= (row['交易时间'] ?? '')).map(r => [r['交易订单号'], r])).values()];
  return matches.length > 0 && matches.every(r => statementCents(r['金额'] ?? '') !== null) && matches.reduce((sum, r) => sum + statementCents(r['金额'])!, 0) === amount;
}
export function ignoredAlipay(row: Record<string, string>, rows: Record<string, string>[] = []) {
  return ['交易关闭', '还款失败', '支付失败', '交易失败'].includes(row['交易状态']) && !refundedClosedPurchase(row, rows);
}
export function alipayKind(row: Record<string, string>, allRows: Record<string, string>[]): { kind: Transaction['kind']; flow: Transaction['flow'] } {
  const status = row['交易状态'];
  if (refundedClosedPurchase(row, allRows)) return { kind: 'expense', flow: 'out' };
  if (!['交易成功', '支付成功', '还款成功', '退款成功', '付款成功，份额确认中'].includes(status)) throw new Error(`未知支付宝交易状态“${status}”，请先核对`);
  if (row['交易分类'] === '退款' || status === '退款成功') {
    const ref = row['交易订单号'];
    const investment = /基金|理财|赎回/.test(row['商品说明']) || allRows.some(r => r['交易分类'] === '投资理财' && r['交易订单号'] && ref.includes(r['交易订单号']));
    return investment ? { kind: 'neutral', flow: 'unknown' } : { kind: 'refund', flow: 'in' };
  }
  if (row['收/支'] === '不计收支') return { kind: 'neutral', flow: 'unknown' };
  if (row['收/支'] === '收入') return { kind: 'income', flow: 'in' };
  if (row['收/支'] === '支出') return { kind: 'expense', flow: 'out' };
  throw new Error(`未知支付宝收支标记“${row['收/支']}”`);
}
export function sourceCategory(category: string, kind: Transaction['kind']) {
  if (kind === 'income') return '其他收入';
  const map: Record<string, string> = { '餐饮美食': '餐饮美食', '文化休闲': '休闲娱乐', '酒店旅游': '休闲娱乐', '日用百货': '购物消费', '数码电器': '购物消费', '服饰装扮': '购物消费', '运动户外': '购物消费', '母婴亲子': '购物消费', '家居家装': '居家生活', '生活服务': '居家生活', '公共服务': '居家生活', '充值缴费': '居家生活', '交通出行': '交通出行', '爱车养车': '交通出行', '医疗健康': '医疗健康', '美容美发': '医疗健康' };
  return map[category] ?? '未分类';
}
export function refundOriginals(ledger: Ledger, refund: Transaction) {
  return ledger.transactions.filter(t => t.kind === 'expense' && t.amountCents >= refund.amountCents && t.reference.length >= 16 && refund.reference.includes(t.reference));
}
