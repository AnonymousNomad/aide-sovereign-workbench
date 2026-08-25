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
];
