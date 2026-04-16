#!/usr/bin/env node
import { build } from 'vite';
import { resolve, dirname } from 'path';
import { cpSync, mkdirSync, existsSync, rmSync, renameSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, 'dist');
const tmp = resolve(__dirname, '.build-tmp');

// Clean
if (existsSync(dist)) rmSync(dist, { recursive: true });
if (existsSync(tmp)) rmSync(tmp, { recursive: true });
mkdirSync(dist, { recursive: true });

const entries = [
  { entry: 'src/background.js', name: 'background' },
  { entry: 'src/content.js', name: 'content' },
  { entry: 'src/offscreen.js', name: 'offscreen' },
];

for (const { entry, name } of entries) {
  const outDir = resolve(tmp, name);
  console.log(`Building ${name}...`);
  await build({
    logLevel: 'warn',
    configFile: false,
    build: {
      outDir,
      emptyDirFirst: true,
      minify: false,
      lib: {
        entry: resolve(__dirname, entry),
        formats: ['es'],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });
  // Move built file to dist
  cpSync(resolve(outDir, `${name}.js`), resolve(dist, `${name}.js`));
}

// Clean temp
rmSync(tmp, { recursive: true });

// Copy static files
console.log('Copying static files...');
cpSync('src/manifest.json', resolve(dist, 'manifest.json'));
cpSync('src/signal.js', resolve(dist, 'signal.js'));
cpSync('src/popup.html', resolve(dist, 'popup.html'));
cpSync('src/popup.js', resolve(dist, 'popup.js'));
cpSync('src/offscreen.html', resolve(dist, 'offscreen.html'));
cpSync('src/icons', resolve(dist, 'icons'), { recursive: true });

// Copy bundled model files (Prompt Guard 22M — pre-downloaded, no network needed)
const modelSrc = resolve(__dirname, 'models/prompt-guard');
const modelOnnx = resolve(modelSrc, 'model.quant.onnx');
if (!existsSync(modelOnnx)) {
  console.error('\n✗ Prompt Guard model not found at models/prompt-guard/');
  console.error('  Run: npm run models');
  console.error('  Or:  bash scripts/download-models.sh\n');
  process.exit(1);
}
console.log('Copying Prompt Guard model (69MB)...');
cpSync(modelSrc, resolve(dist, 'models/prompt-guard'), { recursive: true });

// Copy WASM files from onnxruntime-web
mkdirSync(resolve(dist, 'wasm'), { recursive: true });
const onnxDist = resolve(__dirname, 'node_modules/onnxruntime-web/dist');
cpSync(resolve(onnxDist, 'ort-wasm-simd-threaded.jsep.wasm'), resolve(dist, 'wasm/ort-wasm-simd-threaded.jsep.wasm'));

const mjsPath = resolve(__dirname, 'node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs');
if (existsSync(mjsPath)) {
  cpSync(mjsPath, resolve(dist, 'wasm/ort-wasm-simd-threaded.jsep.mjs'));
}

console.log('Build complete! Load dist/ as unpacked extension in chrome://extensions/');
console.log('Files:', existsSync(resolve(dist, 'background.js')) ? '✓ background.js' : '✗ background.js',
  existsSync(resolve(dist, 'content.js')) ? '✓ content.js' : '✗ content.js',
  existsSync(resolve(dist, 'offscreen.js')) ? '✓ offscreen.js' : '✗ offscreen.js');
