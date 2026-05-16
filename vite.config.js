import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsOutDir = path.resolve(__dirname, 'docs/out');

// Must match the GitHub Pages project path.
// Local dev also uses this prefix so dev mirrors production.
const BASE = '/AudioVisualizer/';
const DOCS_MOUNT = BASE + 'docs';   // '/AudioVisualizer/docs'

/**
 * Serve docs/out/ at <DOCS_MOUNT> in dev, copy into dist/docs at build.
 * Requires `npm run docs:build` to have been run at least once.
 */
function serveDocsPlugin() {
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.js':   'application/javascript; charset=utf-8',
        '.mjs':  'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.txt':  'text/plain; charset=utf-8',
        '.svg':  'image/svg+xml',
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif':  'image/gif',
        '.ico':  'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
    };

    function resolveDocFile(urlPath) {
        let rel = urlPath.replace(new RegExp('^' + DOCS_MOUNT), '');
        try { rel = decodeURIComponent(rel); } catch {}
        if (rel === '' || rel === '/') return path.join(docsOutDir, 'index.html');

        let target = path.join(docsOutDir, rel);
        try {
            const stat = fs.statSync(target);
            if (stat.isDirectory()) {
                const idx = path.join(target, 'index.html');
                return fs.existsSync(idx) ? idx : null;
            }
            return target;
        } catch {
            if (fs.existsSync(target + '.html')) return target + '.html';
            const idx = path.join(target, 'index.html');
            if (fs.existsSync(idx)) return idx;
            return null;
        }
    }

    return {
        name: 'serve-docs',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (!req.url?.startsWith(DOCS_MOUNT)) return next();
                const pathname = req.url.split('?')[0];
                const filePath = resolveDocFile(pathname);
                if (!filePath) return next();
                const ext = path.extname(filePath).toLowerCase();
                res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
                fs.createReadStream(filePath).pipe(res);
            });
        },
        closeBundle() {
            if (!fs.existsSync(docsOutDir)) {
                console.warn('[serve-docs] docs/out/ missing — run `npm run docs:build` then rebuild.');
                return;
            }
            const dest = path.resolve(__dirname, 'dist/docs');
            fs.rmSync(dest, { recursive: true, force: true });
            fs.cpSync(docsOutDir, dest, { recursive: true });
            console.log('[serve-docs] copied docs/out → dist/docs');
        },
    };
}

/** Drop a .nojekyll into dist/ so GitHub Pages stops mangling _next/ etc. */
function nojekyllPlugin() {
    return {
        name: 'nojekyll',
        apply: 'build',
        closeBundle() {
            const target = path.resolve(__dirname, 'dist/.nojekyll');
            fs.writeFileSync(target, '');
        },
    };
}

export default defineConfig({
    base: BASE,
    server: {
        port: 5173,
        open: BASE,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    plugins: [serveDocsPlugin(), nojekyllPlugin()],
});
