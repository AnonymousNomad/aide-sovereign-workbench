# Phase 1C Before-State Launch Map

Date: 2026-09-12  
Starting commit: `a152d1d55cff10e4ee2cbf19113db78d20600472`  
Working branch: `covert-production`

## Normal repository start

`npm start` invokes `node scripts/start.mjs`.

`scripts/start.mjs` starts the TypeScript backend on `4778`, the legacy daemon on `4779`, and the facade on `4777`. It then serves static files from the repository root on `4173`. `/` resolves to the root `index.html`, which loads the root `app.js` and `styles.css` legacy frontend.

Before-state path:

`npm start -> scripts/start.mjs -> repository root index.html/app.js -> facade 4777 -> routed 4778/4779 backends`

The backend topology is canonical at the facade edge, but the selected frontend is not the typed browser frontend.

## Typed browser development and Playwright

`browser/vite.config.ts` owns the typed browser frontend. Vite development runs on `5173`; Vite preview runs on `4173`. Both `/api` and `/ws` proxy to the facade on `4777`. Phase 1B browser/facade tests prove the shared typed client and WebSocket client use that boundary.

Before-state paths:

- `Vite dev 5173 -> browser/index.html -> browser/src/main.ts -> facade 4777`
- `Vite preview 4173 -> browser/dist -> facade 4777`
- `Playwright -> build:frontend -> Vite preview 4173 -> facade 4777 -> TypeScript backend 4778`

This is a different frontend from `npm start`.

## Self-heal

`scripts/selfheal.mjs` treats Vite preview of `browser/dist` on `4173` as the UI service. This agrees with the typed browser frontend and disagrees with `npm start`.

## Desktop development and packaging

`desktop/tauri.conf.json` declares `desktop/frontend` as `frontendDist` and `http://127.0.0.1:4173` as `devUrl`. It has no frontend startup hook.

`desktop/prepare.mjs` recreates `desktop/frontend` from the root legacy `index.html`, `app.js`, and `styles.css`, then copies legacy support trees there. Therefore production desktop packaging embeds the legacy frontend.

The Tauri Rust shell expects a packaged `resources/stack-launcher.mjs`, which starts the TypeScript backend, legacy daemon, and facade. The current tracked preparation script does not create that launcher or copy the backend source trees expected by `desktop/verify-prepare.mjs`. The ignored local `desktop/resources` tree contains a stale launcher from a different branch/history, so a local staged tree is not clean-checkout evidence.

Before-state paths:

- `desktop:dev -> Tauri devUrl 4173` with no configured command proving which server owns `4173`
- `desktop:build -> desktop:prepare -> desktop/frontend legacy assets -> Tauri bundle`
- `installed Tauri shell -> ignored/generated resources/stack-launcher.mjs, if present -> 4778 + 4779 + 4777`

## Legacy ownership

The root legacy frontend remains directly exercised by legacy smoke and contract scripts. It is a retained compatibility implementation, but there is no independently named legacy launch command. Normal `npm start` selects it implicitly.

## Split-brain conclusion

There is no single truthful answer to "what frontend does Covert Coder launch?" at this starting commit:

- repository `npm start`: root legacy frontend;
- Vite/Playwright/self-heal: typed browser frontend;
- desktop packaged assets: root legacy frontend;
- desktop dev: whichever unowned process happens to answer on `4173`.

Phase 1C must make the typed browser build the explicit normal owner, retain the legacy frontend behind an explicitly named compatibility path, and make desktop preparation reproducible from tracked sources.
