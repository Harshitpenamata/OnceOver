import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Minified third-party build artifact copied into public/ as a static
    // asset (see src/components/PdfViewer.tsx) - not source to lint.
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;
