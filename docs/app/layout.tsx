import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { source } from '@/lib/source';
import { baseOptions } from '@/app/layout.config';
import type { ReactNode } from 'react';

export const metadata = {
    title: 'Revisualize 3D — Docs',
    description: 'Real-time 3D audio visualizer documentation.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" className="dark" suppressHydrationWarning>
            <body className="flex flex-col min-h-screen">
                <RootProvider
                    theme={{ defaultTheme: 'dark', forcedTheme: 'dark', enableSystem: false }}
                    search={{
                        options: {
                            type: 'static',
                            // Must include the Next basePath — the static client
                            // does a bare fetch() and does not auto-prefix it.
                            api: '/AudioVisualizer/docs/api/search',
                        },
                    }}
                >
                    <DocsLayout tree={source.pageTree} {...baseOptions}>
                        {children}
                    </DocsLayout>
                </RootProvider>
            </body>
        </html>
    );
}
