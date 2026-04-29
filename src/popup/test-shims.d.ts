// Issue #114 (N3) — Vite/vitest `?raw` import returns a file's contents
// as a string. Used by popup-accordion.test.ts to load popup.html.
declare module '*.html?raw' {
  const content: string;
  export default content;
}
