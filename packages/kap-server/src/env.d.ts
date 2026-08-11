// Raw-string imports for prompt sources. `SpiderByte Agent Core` loads several prompt
// templates via `*.md?raw`; this declaration lets server-v2's typecheck process
// those transitive imports. Vite/Vitest handles `?raw` natively; tsdown uses the
// shared `raw-text-plugin` for the same import shape.

declare module '*?raw' {
  const content: string;
  export default content;
}
