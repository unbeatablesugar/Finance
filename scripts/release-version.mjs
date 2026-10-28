import fs from 'node:fs';

const packagePath = new URL('../package.json', import.meta.url);
const lockPath = new URL('../package-lock.json', import.meta.url);
const configPath = new URL('../src-tauri/tauri.conf.json', import.meta.url);
const cargoPaths = ['../src-tauri/Cargo.toml', '../src-tauri/core/Cargo.toml'].map(path => new URL(path, import.meta.url));
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const requested = process.argv[2];
const version = requested && requested !== '--check' ? requested.replace(/^v/, '') : pkg.version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Use a stable version such as 0.3.0.');

if (requested && requested !== '--check') {
  pkg.version = version;
  lock.version = version; lock.packages[''].version = version;
  config.version = version;
  for (const [path, value] of [[packagePath, pkg], [lockPath, lock], [configPath, config]]) {
    fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  for (const path of cargoPaths) {
    const text = fs.readFileSync(path, 'utf8');
    fs.writeFileSync(path, text.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${version}"`));
  }
  const cargoLockPath = new URL('../src-tauri/Cargo.lock', import.meta.url);
  const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
  fs.writeFileSync(cargoLockPath, cargoLock.replace(/(name = "qinghe-(?:finance|core)"\r?\nversion = ")[^"]+/g, `$1${version}`));
}

const versions = [pkg.version, lock.version, lock.packages[''].version, config.version,
  ...cargoPaths.map(path => /^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path, 'utf8'))?.[1])];
if (versions.some(value => value !== version)) throw new Error(`Version mismatch: ${versions.join(', ')}. Run npm run release:version -- ${version}`);
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('The pushed tag must match the application version.');
console.log(`Release version: ${version}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\n`);
