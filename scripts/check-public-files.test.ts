import { describe, expect, it } from 'vitest';
// The audit is shared by the Git hook and release workflow.
// @ts-expect-error The standalone Node script is JavaScript.
import { inspectPublicFile } from './check-public-files.mjs';
describe('公开源码与个人数据隔离', () => {
  it('默认拒绝未审核的新增文件', () => {
    expect(inspectPublicFile('notes.json', '{}', new Set())).not.toHaveLength(0);
  });
  it.each(['data/ledger.db', '.keys/updater.key', 'backups/ledger.qinghe', '.env', 'release/app.exe', 'src/statement.xlsx'])('即使加入清单也拒绝隐私或产物路径 %s', name => {
    expect(inspectPublicFile(name, '', new Set([name]))).not.toHaveLength(0);
  });
  it('任意 CSV 不会因为改名或加入清单而被允许', () => {
    expect(inspectPublicFile('src/records.csv', '示例', new Set(['src/records.csv']))).not.toHaveLength(0);
  });
  it('只允许两个已审核的虚构导入示例', () => {
    const name = 'examples/通用流水示例.csv';
    expect(inspectPublicFile(name, '虚构数据，EXAMPLE001', new Set([name]))).toEqual([]);
  });
  it('源码中误粘贴的凭据也会被拦截', () => {
    const name = 'src/example.ts';
    const credential = ['ghp', 'a'.repeat(30)].join('_');
    expect(inspectPublicFile(name, credential, new Set([name]))).not.toHaveLength(0);
  });
});
