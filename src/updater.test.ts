import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
const { check, invoke } = vi.hoisted(() => ({ check: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { AppUpdater } from './updater';

function release() {
  return { version: '9.0.0', body: '更新说明', close: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined), install: vi.fn().mockResolvedValue(undefined) };
}
describe('桌面更新流程', () => {
  beforeEach(() => { check.mockReset(); invoke.mockReset(); invoke.mockResolvedValue([]); });
  it('不重复检查；只有服务器确认无更新才显示最新版本', async () => {
    let resolve!: (value: null) => void;
    check.mockImplementation(() => new Promise<null>(done => { resolve = done; }));
    const updater = new AppUpdater();
    const pending = updater.check();
    await updater.check();
    expect(check).toHaveBeenCalledTimes(1);
    expect(updater.snapshot().phase).toBe('checking');
    resolve(null); await pending;
    expect(updater.snapshot().phase).toBe('latest');
  });
  it('检查失败保留之前发现的更新，不误报已是最新', async () => {
    const update = release(); check.mockResolvedValueOnce(update).mockRejectedValueOnce('offline');
    const updater = new AppUpdater(); await updater.check(); await updater.check();
    expect(updater.snapshot()).toMatchObject({ phase: 'error', version: '9.0.0' });
    await updater.install(); expect(update.install).toHaveBeenCalledTimes(1);
  });
  it('下载和签名校验完成后才备份，再启动安装；连续点击只安装一次', async () => {
    const steps: string[] = [];
    const update = release();
    update.download.mockImplementation(async (onEvent: (event: DownloadEvent) => void) => {
      steps.push('verified-download');
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 30 } });
      onEvent({ event: 'Progress', data: { chunkLength: 70 } });
    });
    invoke.mockImplementation(async name => { steps.push(name); });
    update.install.mockImplementation(async () => { steps.push('install'); });
    check.mockResolvedValue(update as unknown as Update);
    const updater = new AppUpdater(); await updater.check();
    await Promise.all([updater.install(), updater.install()]);
    expect(steps).toEqual(['verified-download', 'prepare_app_update', 'install']);
    expect(updater.snapshot()).toMatchObject({ phase: 'installing', downloaded: 100, total: 100 });
  });
  it('下载失败或签名无效不会备份或启动安装，允许重试', async () => {
    const update = release(); update.download.mockRejectedValueOnce('invalid signature'); check.mockResolvedValue(update);
    const updater = new AppUpdater(); await updater.check(); await updater.install();
    expect(invoke).not.toHaveBeenCalledWith('prepare_app_update');
    expect(update.install).not.toHaveBeenCalled(); expect(updater.snapshot().phase).toBe('error');
    await updater.install(); expect(update.install).toHaveBeenCalledTimes(1);
  });
  it('自动备份失败会阻止安装', async () => {
    const update = release(); check.mockResolvedValue(update);
    invoke.mockImplementation(async name => { if (name === 'prepare_app_update') throw new Error('disk full'); });
    const updater = new AppUpdater(); await updater.check(); await updater.install();
    expect(update.install).not.toHaveBeenCalled(); expect(updater.snapshot().phase).toBe('error');
  });
  it('安装启动失败会解除账本写锁，保留更新以便重试', async () => {
    const update = release(); update.install.mockRejectedValueOnce('installer failed'); check.mockResolvedValue(update);
    const updater = new AppUpdater(); await updater.check(); await updater.install();
    expect(invoke).toHaveBeenCalledWith('cancel_app_update');
    expect(updater.snapshot()).toMatchObject({ phase: 'error', version: '9.0.0' });
    await updater.install(); expect(update.install).toHaveBeenCalledTimes(2);
  });
  it('解除写锁失败明确提示重新打开软件', async () => {
    const update = release(); update.install.mockRejectedValue('installer failed'); check.mockResolvedValue(update);
    invoke.mockImplementation(async name => { if (name === 'cancel_app_update') throw new Error('IPC failed'); });
    const updater = new AppUpdater(); await updater.check(); await updater.install();
    expect(updater.snapshot().error).toContain('请关闭并重新打开软件');
  });
  it('再次检查释放旧更新资源；无可用更新时不会安装', async () => {
    const update = release(); check.mockResolvedValueOnce(update).mockResolvedValueOnce(null);
    const updater = new AppUpdater(); await updater.check(); await updater.check(); await updater.install();
    expect(update.close).toHaveBeenCalledTimes(1); expect(update.install).not.toHaveBeenCalled();
    expect(updater.snapshot()).toMatchObject({ phase: 'latest', version: undefined });
  });
});
