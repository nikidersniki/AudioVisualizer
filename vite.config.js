import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsOutDir = path.resolve(__dirname, 'docs/out');

/**
 * Serve docs/out/ at /docs in both dev and prod.
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
        // /docs            -> docs/out/index.html
        // /docs/           -> docs/out/index.html
        // /docs/intro      -> docs/out/intro/index.html (trailingSlash: true) or docs/out/intro.html
        // /docs/_next/...  -> docs/out/_next/...
        let rel = urlPath.replace(/^\/docs/, '');
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
                if (!req.url?.startsWith('/docs')) return next();
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

export default defineConfig({
    server: {
        port: 5173,
        open: true,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    plugins: [serveDocsPlugin()],
});
