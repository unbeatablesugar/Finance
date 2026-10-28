import { invoke, isTauri } from '@tauri-apps/api/core';
import Papa from 'papaparse';
import { assetLabels } from './assets';
import { applyAction, prepareLedger, previewRows, uid } from './domain';
import { normalizedSheet } from './alipay';
import { demoLedger } from './seed';
import type { Action, ImportPreview, ImportSheet, Ledger, Mapping, Mode, Channel, FundingMap } from './types';
export const desktop = isTauri();
let db: IDBDatabase | undefined;
async function database() {
  if (db) return db;
  db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('qinghe-preview-demo-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('state');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return db;
}
async function previewRead(): Promise<Ledger> {
  const d = await database();
  return new Promise((resolve, reject) => {
    const r = d.transaction('state').objectStore('state').get('demo');
    r.onsuccess = () => resolve(prepareLedger(r.result ?? demoLedger())); r.onerror = () => reject(r.error);
  });
}
async function previewWrite(ledger: Ledger) {
  const d = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('state', 'readwrite'); tx.objectStore('state').put(ledger, 'demo');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
export const service = {
  async load(mode: Mode): Promise<Ledger> {
    if (desktop) return invoke('load_ledger', { mode, seed: mode === 'demo' ? demoLedger() : null });
    if (mode !== 'demo') throw new Error('个人账本请在桌面应用中打开');
    return previewRead();
  },
  async act(mode: Mode, action: Action, revision: number): Promise<Ledger> {
    if (desktop) return invoke('apply_action', { mode, action, revision });
    const ledger = await previewRead();
    if (ledger.revision !== revision) throw new Error('账本已更新，请刷新后重试');
    const next = applyAction(ledger, action); await previewWrite(next); return next;
  },
  async readFile(file: File): Promise<ImportSheet> {
    if (file.size > 20 * 1024 * 1024) throw new Error('单个文件请控制在 20 MB 内');
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('请选择 CSV 或 XLSX 文件');
    const buffer = await file.arrayBuffer(), bytes = Array.from(new Uint8Array(buffer));
    if (desktop) return invoke('read_import', { name: file.name, bytes });
    let matrix: string[][];
    if (/\.xlsx$/i.test(file.name)) {
      const { default: readXlsxFile } = await import('read-excel-file');
      const rows = await readXlsxFile(file);
      matrix = rows.map(r => r.map(v => v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v ?? '')));
    } else {
      let content = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      if (content.includes('\uFFFD')) content = new TextDecoder('gb18030').decode(buffer);
      const parsed = Papa.parse<string[]>(content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), { skipEmptyLines: false, delimiter: ',' });
      if (parsed.errors.length) throw new Error(`CSV 解析失败：${parsed.errors[0].message}`);
      matrix = parsed.data;
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))).map(b => b.toString(16).padStart(2, '0')).join('');
    return normalizedSheet(file.name, bytes, matrix, hash);
  },
  async preview(mode: Mode, sheet: ImportSheet, mapping: Mapping, accountId: string, channel: Channel, fundingMap: FundingMap = {}): Promise<ImportPreview> {
    if (desktop) return invoke('preview_import', { mode, name: sheet.name, bytes: sheet.bytes, mapping, accountId, channel, fundingMap });
    return previewRows(await previewRead(), sheet, mapping, accountId, channel, fundingMap);
  },
  async commit(mode: Mode, sheet: ImportSheet, mapping: Mapping, accountId: string, channel: Channel, revision: number, fundingMap: FundingMap = {}): Promise<Ledger> {
    if (desktop) return invoke('commit_import', { mode, name: sheet.name, bytes: sheet.bytes, mapping, accountId, channel, revision, fundingMap });
    const ledger = await previewRead();
    if (ledger.revision !== revision) throw new Error('账本已更新，请重新预览');
    const p = previewRows(ledger, sheet, mapping, accountId, channel, fundingMap);
    if (p.errors.length || p.fileDuplicate || !p.transactions.length) throw new Error('请处理预览中的问题后重新导入');
    const id = uid(); p.transactions.forEach(t => t.batchId = id); p.rawRows.forEach(r => r.batchId = id);
    ledger.accounts.push(...(p.proposedAccounts ?? []));
    ledger.transactions.push(...p.transactions); ledger.rawRows.push(...p.rawRows);
    ledger.batches.push({ id, name: sheet.name, originalName: sheet.name, hash: sheet.hash, accountId: sheet.format === 'alipay' ? 'mixed-alipay' : accountId, channel, importedAt: new Date().toISOString(), count: p.transactions.length, skipped: p.skipped });
    const affected = new Set(p.transactions.map(t => t.accountId));
    ledger.accounts.forEach(a => { if (affected.has(a.id)) a.complete = false; });
    ledger.revision++; const next = prepareLedger(ledger); await previewWrite(next); return next;
  },
  async backup(mode: Mode): Promise<string | null> {
    if (!desktop) { download(JSON.stringify({ format: 'qinghe-preview', ledger: await previewRead() }), '青禾-演示备份.json', 'application/json'); return '已下载演示账本备份'; }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: `青禾-${mode}-${new Date().toISOString().slice(0, 10)}.qinghe`, filters: [{ name: '青禾备份', extensions: ['qinghe'] }] });
    return path ? invoke('backup_ledger', { mode, path }) : null;
  },
  async restore(mode: Mode): Promise<Ledger | null> {
    if (!desktop) throw new Error('备份恢复请在桌面应用中使用');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, filters: [{ name: '青禾备份', extensions: ['qinghe'] }] });
    return path ? invoke('restore_ledger', { mode, path }) : null;
  },
  async dataPath(): Promise<string> { return desktop ? invoke('data_path') : '浏览器 IndexedDB · 仅演示账本'; },
};
export function download(content: string, name: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportCsv(ledger: Ledger) {
  const safe = (s: string) => /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  download('\uFEFF' + Papa.unparse(ledger.transactions.map(t => ({ '时间': t.date, '商户': safe(t.merchant), '金额': (t.amountCents / 100).toFixed(2), '类型': t.kind, '资金用途': t.assetAction ? assetLabels[t.assetAction] : '', '目标账户': safe(ledger.accounts.find(a => a.id === t.targetAccountId)?.name ?? ''), '资金方向': t.flow, '渠道': t.channel, '账户': safe(ledger.accounts.find(a => a.id === t.accountId)?.name ?? ''), '分类': t.category, '流水号': safe(t.reference), '备注': safe(t.note) }))), '青禾-流水明细.csv');
}
