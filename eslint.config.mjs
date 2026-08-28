// AIDE project: use the @typescript-eslint parser directly so .ts
// files don't stall eslint on first run (the prior config had no
// .ts block and npx eslint <staged .ts file> would spin in parsing).
// The typescript-eslint meta-package is CJS; using the individual
// parser+plugin keeps the config ESM-friendly.
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/desktop/",
      "**/skills/packs/",
      "**/.aide/",
      "**/logs/",
      "assets/monaco/**",
      "browser/dist/**",
      "legacy-shell-backup/**",
      "models/**",
    ],
  },
  {
    files: ["app.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: {
        console: "readonly", document: "readonly", window: "readonly",
        fetch: "readonly", localStorage: "readonly", navigator: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", alert: "readonly", confirm: "readonly",
        location: "readonly", FormData: "readonly", Blob: "readonly",
        CustomEvent: "readonly", monaco: "writable", URLSearchParams: "readonly",
        Event: "readonly", requestAnimationFrame: "readonly", AbortController: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-useless-escape": "error",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly", process: "readonly", Buffer: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", fetch: "readonly", URL: "readonly",
        AbortController: "readonly", performance: "readonly", crypto: "readonly",
        structuredClone: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-useless-escape": "error",
    },
  },
  // TypeScript files: use the @typescript-eslint parser so eslint
  // doesn't try to parse TS as JS. Without this block, npx eslint
  // on a staged .ts file spins forever (verified 2026-08-28).
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      "no-unused-vars": "off",  // typescript-eslint handles this
      "no-undef": "off",        // TS already enforces this
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];


