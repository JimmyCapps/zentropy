import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyDirFirst: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.js'),
        content: resolve(__dirname, 'src/content.js'),
        offscreen: resolve(__dirname, 'src/offscreen.html'),
        signal: resolve(__dirname, 'src/signal.js'),
        popup: resolve(__dirname, 'src/popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm',
          dest: 'wasm',
        },
        {
          src: 'node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs',
          dest: 'wasm',
        },
        {
          src: 'src/manifest.json',
          dest: '.',
        },
        {
          src: 'src/icons',
          dest: '.',
        },
      ],
    }),
  ],
});
