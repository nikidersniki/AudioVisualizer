# Revisualize 3D

Real-time 3D audio visualizer. Three.js + vanilla JS + Vite.

## Setup

```bash
npm install
npm run docs:build   # one time — builds the docs sub-project
npm run dev          # http://localhost:5173
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR. Docs served at `/docs/` from `docs/out/`. |
| `npm run build` | Builds docs first, then the main app. Output: `dist/`. |
| `npm run preview` | Preview the production build at http://localhost:4173. |
| `npm run docs:dev` | Edit docs with HMR (Next.js dev server on :3000, separate). |
| `npm run docs:build` | Rebuild docs to `docs/out/`. Re-run after editing MDX. |

## Layout

```
.
├── index.html          ← Vite entry
├── main.js             ← app entry — imports three, scene, UI
├── SceneBuilder.js     ← 3D scene + audio analysis
├── Sceneobjects.js     ← Model / Wave / Light / Image classes + bindings
├── PostProcessing.js   ← shader and native PP passes
├── PreviewRenderer.js  ← thumbnail render for catalogue dialogs
├── SoundNameReader.js  ← ID3 tag parser
├── gl-ui.js            ← Golden Layout panes
├── mobile-ui.js        ← mobile drawer
├── style.css
├── public/             ← static assets served at /
│   ├── shaders/
│   ├── Graphics/
│   ├── models/
│   └── sounds/
├── docs/               ← Fumadocs sub-project (own package.json)
└── dist/               ← build output (gitignored)
```

Three.js comes from npm (`three`) — `from 'three'` and `from 'three/examples/jsm/...'` everywhere.

## Docs site

Lives in `docs/` as a separate Next.js + Fumadocs sub-project. After `npm run docs:build` the static export at `docs/out/` is served by Vite at `/docs/` (dev) and copied to `dist/docs/` (build).

Edit docs in `docs/content/docs/**/*.mdx` and rerun `npm run docs:build`. For HMR while editing docs, use `npm run docs:dev` in a separate terminal.
