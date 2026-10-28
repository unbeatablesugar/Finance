import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = new URL('./public-files.json', import.meta.url);
const dangerousPath = /(?:^|\/)(?:\.keys|\.tools|\.git|node_modules|target|dist|release|data|personal|demo|backups|imports|originals|private)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:db(?:-shm|-wal|-journal)?|sqlite3?|qinghe|key|zip|exe|dll|xlsx?|pdf|log)$/i;
const approvedSamples = new Set(['examples/通用流水示例.csv', 'examples/支付宝格式演示.csv']);
export function inspectPublicFile(name, content, approved) {
  const findings = [];
  if (!approved.has(name)) findings.push('file is not in the reviewed public manifest');
  if (dangerousPath.test(name)) findings.push('private data or build output path');
  if (/\.(?:csv|tsv)$/i.test(name) && !approvedSamples.has(name)) findings.push('unapproved financial input file');
  if (content && !/\.(?:png|ico)$/i.test(name)) {
    const rules = [
      [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
      [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/, 'GitHub credential'],
      [/(?:[A-Za-z]:[\\/]Users[\\/][^\s\\/]+|\/(?:Users|home)\/[^\s/]+)[\\/]/, 'personal home directory'],
      [/\b1[3-9]\d{9}\b/, 'possible personal phone number'],
      [/\b\d{17}[0-9Xx]\b/, 'possible identity document number'],
      [/[\w.+-]+@(?:qq|163|126|gmail|outlook|hotmail)\.[A-Za-z]+\b/i, 'personal email address'],
    ];
    for (const [pattern, label] of rules) if (pattern.test(content)) findings.push(label);
    if (name.startsWith('examples/') && !/虚构|示例/.test(content)) findings.push('sample is missing its fictional-data notice');
  }
  return findings;
}

export function runAudit(staged = false) {
  const approved = new Set(JSON.parse(fs.readFileSync(manifest, 'utf8')));
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const failures = [];
  for (const name of files) {
    const bytes = staged
      ? execFileSync('git', ['show', `:${name}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
      : fs.readFileSync(path.join(root, name));
    const findings = inspectPublicFile(name, bytes.toString('utf8'), approved);
    for (const finding of findings) failures.push(`${name}: ${finding}`);
  }
  if (failures.length) throw new Error(`Public source audit blocked:\n${failures.join('\n')}`);
  console.log(`Public source audit passed: ${files.length} reviewed files; private inputs and build output excluded.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runAudit(process.argv.includes('--staged'));
