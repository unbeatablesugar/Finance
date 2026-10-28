import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowDownToLine, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Modal, SectionTitle } from './components';
import { desktop } from './service';
import { APP_VERSION, appUpdater } from './updater';
import './updates.css';

export default function AppUpdates({ settings, busy, setBusy }: { settings: boolean; busy: boolean; setBusy: (value: boolean) => void }) {
  const update = useSyncExternalStore(appUpdater.subscribe, appUpdater.snapshot);
  const [confirm, setConfirm] = useState(false);
  const updating = ['downloading', 'backing-up', 'installing'].includes(update.phase);
  useEffect(() => {
    if (!desktop) return;
    // The shared controller coalesces React StrictMode's startup checks.
    void appUpdater.check();
    const timer = window.setInterval(() => { void appUpdater.check(); }, 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  const install = async () => {
    if (busy) return;
    setConfirm(false); setBusy(true);
    try { await appUpdater.install(); } finally { setBusy(false); }
  };
  const progress = update.total ? Math.min(100, Math.round(update.downloaded / update.total * 100)) : undefined;
  const message = !desktop ? '浏览器演示不支持安装更新，请使用 Windows 桌面版。'
    : update.phase === 'checking' ? '正在检查新版本…'
    : update.phase === 'latest' ? '当前已是最新版本'
    : update.phase === 'available' ? `发现新版本 v${update.version}`
    : update.phase === 'error' ? update.error
    : updating ? '正在更新软件…' : '启动时自动检查更新';
  return <>
    {desktop && update.version && !settings && !updating && <div className="update-notice" role="status"><span><ArrowDownToLine size={16} />青禾账本 v{update.version} 可更新</span><button className="text-button" disabled={busy} onClick={() => setConfirm(true)}>查看更新</button></div>}
    {settings && <section className="panel settings-panel app-update-panel"><SectionTitle title="软件更新" subtitle="启动时自动检查版本，直接在软件里升级" /><div className="update-heading"><div><strong>青禾账本 <span>v{APP_VERSION}</span></strong><p role="status" className={update.phase === 'error' ? 'update-error' : ''}>{message}</p>{update.checkedAt && <small>上次检查：{new Date(update.checkedAt).toLocaleString('zh-CN')}</small>}</div><div className="setting-actions"><button className="secondary-button" disabled={!desktop || busy || update.phase === 'checking' || updating} onClick={() => { void appUpdater.check(); }}><RefreshCw size={15} className={update.phase === 'checking' ? 'spin' : ''} />检查更新</button>{update.version && <button className="primary-button" disabled={busy || update.phase === 'checking' || updating} onClick={() => setConfirm(true)}><ArrowDownToLine size={15} />下载并安装</button>}</div></div>{update.notes && <pre className="update-notes">{update.notes}</pre>}<div className="info-note"><ShieldCheck size={18} /><p>从 GitHub Releases 获取更新，安装前验证签名并自动备份本地账本。安装时会关闭软件并重新启动。</p></div></section>}
    {confirm && <Modal title={`更新至 v${update.version}`} sub={`当前版本 v${APP_VERSION}`} onClose={() => setConfirm(false)}><p className="update-description">更新包下载并验证后，将自动备份本地账本，再关闭软件完成安装。</p>{update.notes && <pre className="update-notes">{update.notes}</pre>}<div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(false)}>稍后更新</button><button className="primary-button" disabled={busy || update.phase === 'checking' || updating} onClick={() => { void install(); }}>下载并安装</button></div></Modal>}
    {updating && <div className="update-overlay" role="dialog" aria-modal="true" aria-label="正在更新青禾账本"><section className="update-progress-card"><LoaderCircle className="spin" size={27} /><h3>{update.phase === 'backing-up' ? '正在备份账本…' : update.phase === 'installing' ? '正在安装，即将重新启动…' : `正在下载 v${update.version}`}</h3>{update.phase === 'downloading' && <><progress aria-label="更新下载进度" max={100} {...(progress === undefined ? {} : { value: progress })} /><p>{(update.downloaded / 1024 / 1024).toFixed(1)} MB{update.total ? ` / ${(update.total / 1024 / 1024).toFixed(1)} MB · ${progress}%` : ''}</p></>}<small>请保持软件打开，完成后将自动重新启动。</small></section></div>}
  </>;
}
