import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    base: './',
    plugins: [react()],
    esbuild: {
        jsx: 'automatic',
        loader: 'jsx',
        include: /src\/.*\.[jt]sx?$/,
    },
    optimizeDeps: {
        esbuildOptions: {
            jsx: 'automatic',
            loader: {
                '.js': 'jsx',
                '.jsx': 'jsx'
            }
        }
    },
    server: {
        port: 5174,
        strictPort: true
    },
    build: {
        outDir: 'dist'
    }
});
