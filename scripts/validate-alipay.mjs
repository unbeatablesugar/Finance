// Read-only local verification. No source rows, names, identifiers or amounts are printed or saved.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { createServer } from 'vite';
const target = process.argv[2];
if (!target) throw new Error('Usage: node scripts/validate-alipay.mjs <local csv path>');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { normalizedSheet, ignoredAlipay, alipayKind } = await vite.ssrLoadModule('/src/alipay.ts');
  const { previewRows } = await vite.ssrLoadModule('/src/domain.ts');
  const { emptyLedger } = await vite.ssrLoadModule('/src/seed.ts');
  const buffer = await fs.readFile(target);
  let content = new TextDecoder('utf-8').decode(buffer);
  if (content.includes('\uFFFD')) content = new TextDecoder('gb18030').decode(buffer);
  const parsed = Papa.parse(content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), { skipEmptyLines: false, delimiter: ',' });
  assert.equal(parsed.errors.length, 0, 'CSV parsing must succeed');
  const sheet = normalizedSheet(path.basename(target), [], parsed.data, 'local-verification-only');
  assert.equal(sheet.format, 'alipay');
  const mapping = { date: '交易时间', amount: '金额', kind: '收/支', merchant: '交易对方', reference: '交易订单号', note: '备注' };
  const preview = previewRows(emptyLedger(), sheet, mapping, '', '支付宝');
  assert.deepEqual(preview.errors, [], 'Every row must be understood');
  const active = sheet.rows.filter(r => !ignoredAlipay(r));
  assert.equal(preview.transactions.length, active.length, 'No active order may be silently dropped');
  const expected = Object.groupBy(active, r => alipayKind(r, sheet.rows).kind);
  for (const [kind, rows] of Object.entries(expected)) assert.equal(preview.transactions.filter(t => t.kind === kind).length, rows.length);
  // Independent integer parsing reconciles the amounts without exposing them.
  const cents = s => { const [a, b = ''] = s.trim().split('.'); return BigInt(a) * 100n + BigInt(b.padEnd(2, '0')); };
  assert.equal(preview.transactions.reduce((sum, t) => sum + BigInt(t.amountCents), 0n), active.reduce((sum, r) => sum + cents(r['金额']), 0n));
  assert.equal(preview.rawRows.length, sheet.rows.length);
  console.log(JSON.stringify({ success: true, headerRow: sheet.headerRow, sourceRows: sheet.rows.length, importedRows: preview.transactions.length, ignoredClosedOrFailed: preview.ignored, zeroAmountRowsPreserved: preview.transactions.filter(t => t.amountCents === 0).length, neutralRows: preview.neutralCount, refundsAwaitingReview: preview.transactions.filter(t => t.kind === 'refund').length, duplicateRowsSkipped: preview.skipped, rowCountsAndAmountsReconcile: true }, null, 2));
} finally { await vite.close(); }
