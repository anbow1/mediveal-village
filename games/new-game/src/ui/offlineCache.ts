// Safe Post-Boot Offline PWA Cache Manager:
// Populates `marchland-assets-v3` and `marchland-shell-v3` sequentially (1 file at a time with
// brief idle yields) AFTER the game has finished booting so iPadOS Safari / low-RAM tablets never
// stall or OOM during startup. Reads from the browser's warm HTTP disk cache whenever possible
// and handles QuotaExceededError cleanly.

import type { QualityPreset } from '../config.ts';

export const SHELL_CACHE_NAME = 'marchland-shell-v3';
export const ASSET_CACHE_NAME = 'marchland-assets-v3';
const OFFLINE_VERSION_KEY = 'marchland.offlineVersion';

type OfflineTier = 'minimal' | 'low' | 'high';

interface OfflineManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly tier: OfflineTier;
}

interface OfflineManifest {
  readonly version: string;
  readonly files: readonly OfflineManifestFile[];
}

export type OfflineSyncState =
  | 'unsupported'
  | 'checking'
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'quota'
  | 'error';

export interface OfflineStatus {
  readonly state: OfflineSyncState;
  readonly quality: QualityPreset;
  readonly cachedFiles: number;
  readonly totalFiles: number;
  readonly cachedBytes: number;
  readonly totalBytes: number;
  readonly version: string | null;
}

type OfflineListener = (status: OfflineStatus) => void;

const TIER_RANK: Record<OfflineTier, number> = {
  minimal: 0,
  low: 1,
  high: 2,
};

function tierIncluded(fileTier: OfflineTier, quality: QualityPreset): boolean {
  return TIER_RANK[fileTier] <= TIER_RANK[quality];
}

function isCacheApiAvailable(): boolean {
  if (typeof window === 'undefined' || typeof caches === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  return (
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    new URLSearchParams(window.location.search).has('sw')
  );
}

function resolveAssetUrl(relPath: string): string {
  return new URL(relPath, window.location.href).href;
}

function cacheNameForPath(relPath: string): string {
  return relPath.startsWith('assets/') ? ASSET_CACHE_NAME : SHELL_CACHE_NAME;
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'QuotaExceededError' || /quota/i.test(err.message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

class OfflineCacheManager {
  private status: OfflineStatus = {
    state: isCacheApiAvailable() ? 'checking' : 'unsupported',
    quality: 'high',
    cachedFiles: 0,
    totalFiles: 0,
    cachedBytes: 0,
    totalBytes: 0,
    version: null,
  };
  private listeners = new Set<OfflineListener>();
  private activeDownload: Promise<void> | null = null;
  private autoTimer: number | null = null;
  private manifestCache: OfflineManifest | null = null;

  public getStatus(): OfflineStatus {
    return this.status;
  }

  public subscribe(listener: OfflineListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: OfflineStatus): void {
    this.status = next;
    for (const fn of this.listeners) {
      fn(next);
    }
  }

  private async fetchManifest(forceNetwork = false): Promise<OfflineManifest | null> {
    if (this.manifestCache && !forceNetwork) return this.manifestCache;
    try {
      const url = resolveAssetUrl('./offline-manifest.json');
      const res = await fetch(url, { cache: forceNetwork ? 'no-cache' : 'default' });
      if (!res.ok) return this.manifestCache;
      const parsed = (await res.json()) as OfflineManifest;
      if (parsed && Array.isArray(parsed.files) && typeof parsed.version === 'string') {
        this.manifestCache = parsed;
        return parsed;
      }
    } catch {
      // Offline without manifest cached yet (or dev server without production manifest)
    }
    return this.manifestCache;
  }

  public async refresh(quality: QualityPreset): Promise<OfflineStatus> {
    if (!isCacheApiAvailable()) {
      const next: OfflineStatus = {
        state: 'unsupported',
        quality,
        cachedFiles: 0,
        totalFiles: 0,
        cachedBytes: 0,
        totalBytes: 0,
        version: null,
      };
      this.emit(next);
      return next;
    }

    const manifest = await this.fetchManifest(false);
    if (!manifest) {
      const next: OfflineStatus = {
        state: 'unsupported',
        quality,
        cachedFiles: 0,
        totalFiles: 0,
        cachedBytes: 0,
        totalBytes: 0,
        version: null,
      };
      this.emit(next);
      return next;
    }

    const required = manifest.files.filter((f) => tierIncluded(f.tier, quality));
    const [shellCache, assetCache] = await Promise.all([
      caches.open(SHELL_CACHE_NAME),
      caches.open(ASSET_CACHE_NAME),
    ]);
    const [shellKeys, assetKeys] = await Promise.all([shellCache.keys(), assetCache.keys()]);
    const present = new Set<string>();
    for (const req of shellKeys) present.add(req.url);
    for (const req of assetKeys) present.add(req.url);

    let cachedFiles = 0;
    let cachedBytes = 0;
    let totalBytes = 0;
    for (const f of required) {
      totalBytes += f.bytes;
      if (present.has(resolveAssetUrl(`./${f.path}`))) {
        cachedFiles++;
        cachedBytes += f.bytes;
      }
    }

    const ready = required.length > 0 && cachedFiles >= required.length;
    const next: OfflineStatus = {
      state: this.activeDownload ? 'downloading' : ready ? 'ready' : 'idle',
      quality,
      cachedFiles,
      totalFiles: required.length,
      cachedBytes,
      totalBytes,
      version: manifest.version,
    };
    this.emit(next);
    return next;
  }

  /**
   * Schedules a gentle post-boot background save once the initial frame & menu have settled.
   * Safe on iPad 7: runs 3.5 s after boot finishes, 1 file at a time, reading already-fetched
   * files directly from the browser's warm HTTP cache.
   */
  public scheduleAutoDownload(quality: QualityPreset): void {
    if (!isCacheApiAvailable()) return;
    if (this.autoTimer !== null) {
      window.clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    void this.refresh(quality).then((st) => {
      if (st.state === 'unsupported') return;
      if (st.state === 'ready' || !navigator.onLine) return;
      this.autoTimer = window.setTimeout(() => {
        this.autoTimer = null;
        if (!navigator.onLine) return;
        void this.startDownload(quality);
      }, 3500);
    });
  }

  public startDownload(quality: QualityPreset): Promise<void> {
    if (this.activeDownload) return this.activeDownload;
    if (!isCacheApiAvailable()) return Promise.resolve();

    const run = async (): Promise<void> => {
      try {
        // Politely request persistent storage so the OS keeps our offline cache
        try {
          await navigator.storage?.persist?.();
        } catch {
          // Non-fatal
        }

        const manifest = await this.fetchManifest(navigator.onLine);
        if (!manifest) {
          this.emit({
            state: 'unsupported',
            quality,
            cachedFiles: 0,
            totalFiles: 0,
            cachedBytes: 0,
            totalBytes: 0,
            version: null,
          });
          return;
        }

        const required = manifest.files.filter((f) => tierIncluded(f.tier, quality));
        const totalBytes = required.reduce((acc, f) => acc + f.bytes, 0);
        const [shellCache, assetCache] = await Promise.all([
          caches.open(SHELL_CACHE_NAME),
          caches.open(ASSET_CACHE_NAME),
        ]);

        // Purge obsolete Vite-hashed bundles from previous deploys so storage never grows unbounded
        const validUrls = new Set(manifest.files.map((f) => resolveAssetUrl(`./${f.path}`)));
        const existingAssetKeys = await assetCache.keys();
        for (const req of existingAssetKeys) {
          if (!validUrls.has(req.url)) {
            await assetCache.delete(req).catch(() => undefined);
          }
        }

        const [shellKeys, assetKeys] = await Promise.all([shellCache.keys(), assetCache.keys()]);
        const present = new Set<string>();
        for (const req of shellKeys) present.add(req.url);
        for (const req of assetKeys) present.add(req.url);

        let prevVersion: string | null = null;
        try {
          prevVersion = localStorage.getItem(OFFLINE_VERSION_KEY);
        } catch {
          // Ignore storage restrictions
        }
        const versionChanged = prevVersion !== manifest.version;

        // Always lock the current app shell & offline-manifest together so HTML + hashed JS match
        const shellCore = ['./', './index.html', './manifest.webmanifest', './offline-manifest.json'];
        for (const rel of shellCore) {
          try {
            const url = resolveAssetUrl(rel);
            const res = await fetch(url, { cache: versionChanged ? 'no-cache' : 'default' });
            if (res.ok && res.type === 'basic') {
              await shellCache.put(url, res);
              present.add(url);
            }
          } catch (err) {
            if (isQuotaError(err)) {
              this.emit({
                state: 'quota',
                quality,
                cachedFiles: 0,
                totalFiles: required.length,
                cachedBytes: 0,
                totalBytes,
                version: manifest.version,
              });
              return;
            }
          }
        }

        let cachedFiles = 0;
        let cachedBytes = 0;
        const missing: OfflineManifestFile[] = [];
        for (const f of required) {
          const url = resolveAssetUrl(`./${f.path}`);
          const forceRefresh = versionChanged && (f.path === 'index.html' || f.path === 'assets/manifest.json');
          if (!forceRefresh && present.has(url)) {
            cachedFiles++;
            cachedBytes += f.bytes;
          } else {
            missing.push(f);
          }
        }

        this.emit({
          state: missing.length === 0 ? 'ready' : 'downloading',
          quality,
          cachedFiles,
          totalFiles: required.length,
          cachedBytes,
          totalBytes,
          version: manifest.version,
        });

        // Strictly sequential (1 file at a time + 25 ms yield) to keep frame rate smooth & peak RAM tiny!
        let failedCount = 0;
        for (let i = 0; i < missing.length; i++) {
          const f = missing[i]!;
          const url = resolveAssetUrl(`./${f.path}`);
          const targetCache = cacheNameForPath(f.path) === ASSET_CACHE_NAME ? assetCache : shellCache;
          try {
            const res = await fetch(url, { cache: 'default' });
            if (!res.ok) {
              failedCount++;
            } else {
              await targetCache.put(url, res);
              cachedFiles++;
              cachedBytes += f.bytes;
            }
          } catch (err) {
            if (isQuotaError(err)) {
              this.emit({
                state: 'quota',
                quality,
                cachedFiles,
                totalFiles: required.length,
                cachedBytes,
                totalBytes,
                version: manifest.version,
              });
              return;
            }
            failedCount++;
          }

          if (i % 2 === 0 || i === missing.length - 1) {
            this.emit({
              state: 'downloading',
              quality,
              cachedFiles,
              totalFiles: required.length,
              cachedBytes,
              totalBytes,
              version: manifest.version,
            });
          }
          await sleep(25);
        }

        if (failedCount === 0) {
          try {
            localStorage.setItem(OFFLINE_VERSION_KEY, manifest.version);
          } catch {
            // Ignore storage restrictions
          }
          this.emit({
            state: 'ready',
            quality,
            cachedFiles,
            totalFiles: required.length,
            cachedBytes,
            totalBytes,
            version: manifest.version,
          });
        } else {
          this.emit({
            state: 'error',
            quality,
            cachedFiles,
            totalFiles: required.length,
            cachedBytes,
            totalBytes,
            version: manifest.version,
          });
        }
      } catch (err) {
        this.emit({
          ...this.status,
          quality,
          state: isQuotaError(err) ? 'quota' : 'error',
        });
      } finally {
        this.activeDownload = null;
      }
    };

    this.activeDownload = run();
    return this.activeDownload;
  }
}

export const offlineManager = new OfflineCacheManager();
