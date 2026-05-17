import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Static export needs the search index baked at build time —
// `staticGET` writes a JSON file the client fetches at runtime.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
