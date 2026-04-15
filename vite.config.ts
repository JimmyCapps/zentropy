import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

function copyExtensionAssets(): Plugin {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      const copies: [string, string][] = [
        ['src/offscreen/offscreen.html', 'dist/offscreen/offscreen.html'],
        ['src/popup/popup.html', 'dist/popup/popup.html'],
      ];
      for (const [src, dest] of copies) {
        const destDir = resolve(__dirname, dest, '..');
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        copyFileSync(resolve(__dirname, src), resolve(__dirname, dest));
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        'service-worker/index': resolve(__dirname, 'src/service-worker/index.ts'),
        'content/index': resolve(__dirname, 'src/content/index.ts'),
        'content/main-world-inject': resolve(__dirname, 'src/content/main-world-inject.ts'),
        'offscreen/index': resolve(__dirname, 'src/offscreen/index.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        format: 'iife',
        inlineDynamicImports: false,
      },
    },
    sourcemap: process.env.NODE_ENV !== 'production',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [copyExtensionAssets()],
});
