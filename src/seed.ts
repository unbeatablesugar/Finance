import { CATEGORIES, type Ledger, type Transaction } from './types';
export function emptyLedger(): Ledger {
  return { version: 2, revision: 0, accounts: [], transactions: [], rawRows: [], batches: [], relations: [], rules: [], categories: [...CATEGORIES] };
}
export function demoLedger(): Ledger {
  const ledger = emptyLedger();
  ledger.accounts = [
    { id: 'wx', name: '微信零钱', channel: '微信', suffix: '零钱', openingCents: 285032, openingDate: '2026-10-01', complete: false },
    { id: 'ali', name: '支付宝余额', channel: '支付宝', suffix: '余额', openingCents: 628600, openingDate: '2026-10-01', complete: false },
    { id: 'bank', name: '招商银行', channel: '银行卡', suffix: '尾号 8826', openingCents: 2389200, openingDate: '2026-10-01', complete: false },
  ];
  const add = (date: string, merchant: string, amount: number, category: string, accountId = 'wx', kind: Transaction['kind'] = 'expense', flow?: Transaction['flow']) => {
    const id = `demo-${ledger.transactions.length + 1}`;
    ledger.transactions.push({ id, date: `2026-${date}`, merchant, amountCents: Math.round(amount * 100), kind, flow: flow ?? (['income', 'refund'].includes(kind) ? 'in' : 'out'), channel: ledger.accounts.find(a => a.id === accountId)!.channel, accountId, category, reference: `DEMO${ledger.transactions.length + 1000}`, note: '仅用于体验的虚构演示数据', batchId: 'demo-batch', rawId: `raw-${id}` });
  };
  add('10-26 12:32:00', '山野食堂', 42, '餐饮美食');
  add('10-26 09:18:00', '瑞幸咖啡', 16.9, '餐饮美食', 'ali');
  add('10-25 19:42:00', '盒马鲜生', 186.5, '居家生活', 'ali');
  add('10-25 17:06:00', '滴滴出行', 32.8, '交通出行');
  add('10-25 10:00:00', '十月工资', 24800, '工资收入', 'bank', 'income');
  add('10-24 20:08:00', '优衣库', 399, '购物消费', 'ali');
  add('10-24 14:30:00', '周末咖啡', 38, '餐饮美食');
  add('10-23 18:15:00', '诚品书店', 128, '休闲娱乐');
  add('10-23 18:15:40', '财付通 · 诚品书店', 128, '休闲娱乐', 'bank');
  add('10-22 08:42:00', '地铁乘车', 6, '交通出行', 'ali');
  add('10-21 15:30:00', '项目稿费', 2800, '其他收入', 'ali', 'income');
  add('10-20 09:00:00', '房屋租金', 3200, '居家生活', 'bank');
  add('10-19 20:30:00', 'MUJI 无印良品', 268, '购物消费', 'ali');
  add('10-18 14:12:00', '网易云音乐', 18, '休闲娱乐', 'ali');
  add('10-17 12:05:00', '三餐四季', 56, '餐饮美食');
  add('10-16 18:20:00', '家用电费', 126.8, '居家生活', 'ali');
  add('10-15 16:00:00', '京东商城', 899, '购物消费', 'bank');
  add('10-14 13:20:00', '京东退款', 100, '购物消费', 'bank', 'refund');
  ledger.relations.push({ id: 'demo-refund', type: 'refund', primaryId: 'demo-17', secondaryId: 'demo-18' });
  add('10-13 08:30:00', '支付宝充值', 1000, '未分类', 'bank', 'transfer', 'out');
  add('10-13 08:30:45', '银行卡充值', 1000, '未分类', 'ali', 'transfer', 'in');
  add('10-12 19:40:00', '大光明电影院', 98, '休闲娱乐', 'ali');
  add('10-11 12:00:00', '小满手作', 76, '餐饮美食');
  add('10-10 10:30:00', '社区门诊', 185, '医疗健康', 'bank');
  add('10-09 18:10:00', '朴朴超市', 216.8, '居家生活');
  add('10-08 08:15:00', '滴滴出行', 48.6, '交通出行');
  add('10-07 17:00:00', '独立书店', 89, '休闲娱乐');
  add('10-06 12:00:00', '国庆聚餐', 468, '餐饮美食', 'ali');
  add('10-05 14:00:00', '运动装备', 458, '购物消费', 'bank');
  add('10-04 09:30:00', '高铁出行', 326, '交通出行', 'ali');
  add('10-03 19:00:00', '海边餐厅', 218, '餐饮美食');
  add('10-02 10:00:00', '民宿住宿', 680, '休闲娱乐', 'ali');
  add('10-01 08:00:00', '便利店', 24.6, '餐饮美食');
  add('09-25 10:00:00', '九月工资', 24800, '工资收入', 'bank', 'income');
  add('09-20 09:00:00', '房屋租金', 3200, '居家生活', 'bank');
  add('09-18 12:00:00', '日常消费', 3298, '购物消费', 'ali');
  add('09-12 12:00:00', '餐饮与出行', 1826, '餐饮美食');
  ledger.rawRows = ledger.transactions.map((t, i) => ({ id: t.rawId, batchId: 'demo-batch', rowNumber: i + 2, values: { '交易时间': t.date, '交易对方': t.merchant, '金额': (t.amountCents / 100).toFixed(2), '收支类型': t.kind, '流水号': t.reference } }));
  ledger.batches = [{ id: 'demo-batch', name: '十月生活账单 · 演示', hash: 'demo', accountId: 'wx', channel: '微信', importedAt: '2026-10-26T02:30:00Z', count: ledger.transactions.length, skipped: 0, originalName: 'demo.csv' }];
  ledger.rules = [{ id: 'r1', keyword: '咖啡', category: '餐饮美食' }, { id: 'r2', keyword: '滴滴', category: '交通出行' }, { id: 'r3', keyword: '工资', category: '工资收入' }];
  return ledger;
}
