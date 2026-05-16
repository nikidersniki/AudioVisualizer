# Revisualize 3D — Documentation site

Fumadocs (Next.js) static site. Source for the **Help** page linked from the main app header.

## First-time setup

```bash
cd docs
npm install
```

This installs Next.js, Fumadocs, and Tailwind, and also runs `fumadocs-mdx` (via `postinstall`) to generate the MDX type definitions in `.source/`.

## Develop with hot reload

```bash
npm run dev
```

Open <http://localhost:3000>. Edits to `content/docs/**/*.mdx` reload instantly.

## Build static site

```bash
npm run build
```

Output: `docs/out/`. The main app's **Help** button points at `docs/out/index.html`.

## Editing content

All documentation lives in `content/docs/`:

```
content/docs/
├── meta.json              ← sidebar order
├── index.mdx              ← Overview
├── getting-started.mdx
├── interface.mdx
├── layers.mdx
├── bindings.mdx
├── audio-sources.mdx
├── displacement.mdx
├── animation.mdx
├── projects.mdx
├── shortcuts.mdx
├── objects/
│   ├── meta.json
│   ├── index.mdx
│   ├── model.mdx
│   ├── wave.mdx
│   ├── image.mdx
│   └── light.mdx
└── post-processing/
    ├── meta.json
    ├── index.mdx
    ├── native.mdx
    └── shaders.mdx
```

Each MDX file starts with frontmatter:

```mdx
---
title: Page Title
description: One-line description for SEO and TOC.
---
```

Then standard Markdown with optional React/JSX components.

## Adding a new page

1. Create `content/docs/my-page.mdx` with frontmatter.
2. Add `"my-page"` to the relevant `meta.json` `pages` array.
3. Re-run dev / build.
