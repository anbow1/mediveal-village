import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

type OfflineTier = 'minimal' | 'low' | 'high';

function classifyOfflineTier(relPath: string): OfflineTier | null {
  if (relPath === 'sw.js' || relPath === 'offline-manifest.json') return null;
  if (relPath.endsWith('.md')) return null;
  if (relPath === 'assets/marchland/people/smith.json') return null;

  if (relPath.startsWith('assets/marchland/photo/')) return 'low';
  if (relPath.startsWith('assets/marchland/buildings/')) return 'low';
  if (
    relPath === 'assets/marchland/people/townsman-beard.json' ||
    relPath === 'assets/marchland/people/townswoman-dress.json'
  ) {
    return 'low';
  }
  if (
    relPath === 'assets/marchland/people/townsman-linen.json' ||
    relPath === 'assets/marchland/people/townsman-wool.json' ||
    relPath === 'assets/marchland/people/townswoman-worker.json'
  ) {
    return 'high';
  }
  return 'minimal';
}

function offlineManifestPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'marchland-offline-manifest',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      const files: { path: string; bytes: number; tier: OfflineTier }[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full);
          } else if (st.isFile()) {
            const rel = relative(outDir, full).replace(/\\/g, '/');
            const tier = classifyOfflineTier(rel);
            if (!tier) continue;
            files.push({ path: rel, bytes: st.size, tier });
          }
        }
      };
      walk(outDir);
      files.sort((a, b) => a.path.localeCompare(b.path));
      const hash = createHash('sha256');
      for (const f of files) {
        hash.update(`${f.path}:${f.bytes}\n`);
      }
      const version = hash.digest('hex').slice(0, 12);
      writeFileSync(
        join(outDir, 'offline-manifest.json'),
        JSON.stringify({ version, files }),
        'utf8',
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineManifestPlugin()],
  optimizeDeps: {
    // Keep three un-prebundled in dev mode so KTX2Loader's `new URL('../libs/basis/basis_transcoder.*', import.meta.url)`
    // resolves cleanly instead of hitting Vite's SPA HTML fallback!
    exclude: ['three'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
