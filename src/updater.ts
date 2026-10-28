import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { version } from '../package.json';

export const APP_VERSION = version;
export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'backing-up' | 'installing' | 'error';
export interface UpdateState {
  phase: UpdatePhase;
  version?: string;
  notes?: string;
  checkedAt?: string;
  downloaded: number;
  total?: number;
  error?: string;
}

// Lives outside page components so navigation cannot discard a download or its native resource.
export class AppUpdater {
  private state: UpdateState = { phase: 'idle', downloaded: 0 };
  private listeners = new Set<() => void>();
  private pending: Update | null = null;
  private operation = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private publish(next: Partial<UpdateState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }
  async check() {
    if (this.operation) return;
    this.operation = true;
    this.publish({ phase: 'checking', error: undefined });
    // Keep a previously discovered update usable if a later request fails offline.
    try {
      const result = await check({ timeout: 20_000 });
      const previous = this.pending;
      this.pending = result;
      await previous?.close().catch(() => {});
      this.publish({ phase: result ? 'available' : 'latest', version: result?.version, notes: result?.body, checkedAt: new Date().toISOString(), downloaded: 0, total: undefined });
    } catch {
      this.publish({ phase: 'error', error: '暂时无法获取更新信息，可能尚未发布更新或网络不可用。请稍后重试。' });
    } finally { this.operation = false; }
  }
  async install() {
    if (this.operation || !this.pending) return;
    this.operation = true;
    this.publish({ phase: 'downloading', error: undefined, downloaded: 0, total: undefined });
    try {
      await this.pending.download(event => {
        if (event.event === 'Started') this.publish({ total: event.data.contentLength });
        if (event.event === 'Progress') this.publish({ downloaded: this.state.downloaded + event.data.chunkLength });
      }, { timeout: 300_000 });
      // download() verifies the signature before resolving. Never install or exit on failure.
      this.publish({ phase: 'backing-up' });
      await invoke('prepare_app_update');
      this.publish({ phase: 'installing' });
      await this.pending.install(); // Windows updater exits and restarts the installed app.
    } catch (error) {
      try { await invoke('cancel_app_update'); }
      catch (unlockError) {
        this.publish({ phase: 'error', error: `更新失败，账本暂时锁定，请关闭并重新打开软件。${String(error)}；${String(unlockError)}` });
        return;
      }
      this.publish({ phase: 'error', error: `更新未完成，当前版本可继续使用，请重试。${String(error)}` });
    } finally { this.operation = false; }
  }
}
export const appUpdater = new AppUpdater();
