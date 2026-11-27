import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Serves root-level `data/` at `/data/*` in dev/preview and copies it into `dist/data/*` on build.
 * Keeps `data/*.json` as the single source of truth for Phase 2 parallel agents and static hosts.
 */
function serveAndCopyDataPlugin(): Plugin {
  const dataDir = path.resolve(__dirname, 'data');

  return {
    name: 'cozyhouse-data-dir',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const cleanPath = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
        const filePath = path.resolve(dataDir, cleanPath);
        if (!filePath.startsWith(dataDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        fs.createReadStream(filePath).pipe(res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const cleanPath = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
        const filePath = path.resolve(dataDir, cleanPath);
        if (!filePath.startsWith(dataDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        fs.createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      const outDataDir = path.resolve(__dirname, 'dist', 'data');
      if (fs.existsSync(dataDir)) {
        fs.mkdirSync(outDataDir, { recursive: true });
        fs.cpSync(dataDir, outDataDir, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serveAndCopyDataPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
