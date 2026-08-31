# Neuro_Nomad Site — Research-Backed Build Plan

**Date**: 2026-08-28
**Author**: opencode
**Status**: Plan, awaiting user go-ahead

## 1. Decisions (research-backed, not vibes)

| Question | Decision | Why |
|---|---|---|
| Hosting | **GitHub Pages** (`<username>.github.io`) | User chose it. Free, automatic deploy from git, no rate limits, custom domain later if wanted. |
| Build/deploy | **Local-only first**, user pushes manually | User chose. Avoids `gh auth login` risk; user controls when site goes live. |
| Domain | **Free `<username>.github.io`** | User chose. Standard, no DNS to configure. |
| Featured repos | **AIDE only** (with link to GitHub profile for the rest) | User chose. |
| Site generator | **Astro** | Modern, ships zero JS by default, content collections, GitHub API integrations, runs on Node (have it), clean deploy to GitHub Pages. |
| Repo data sync | **Client-side fetch from GitHub REST API at view time** | No build step needed; no API key required for public repos (60 req/hr unauthenticated); 5 repos is well under any limit. |
| Design system | **Custom CSS with design tokens** (no Tailwind) | Per `web-builder-spec-renderer` skill, design tokens are the right pattern. Avoid framework lock-in. |

## 2. What research was done (sources, not vibes)

- **`web-builder-full-stack-synthesis` skill** (loaded): full-stack Shopify/website SOP, dual-mind build protocol, source-hierarchy for research.
- **`web-builder` skill** (loaded): structured spec + renderer + design scorer. The existing `web-builder-spec-renderer` skill gives a clean DESIGN.md + YAML token spec.
- **`web-human-systems-security` skill** (loaded): defensive human-factor + cybersecurity. Defines the public-facing copy rules (no contest/grants/money framing; technical description only).
- **`web-builder-production-canary` skill** (loaded): required artifact pack for any real canary task (brief hash, route, raw model output, canonical spec, rendered HTML, browser screenshot, deterministic score, hashes, escalation).
- **`web-builder-model-frontier` skill** (loaded): "specialize, do not scale" doctrine; data diversity is the gate.
- **`github-repo-professional-setup` skill** (loaded): shields.io badges, llms.txt, trust files (LICENSE/SECURITY/CONTRIBUTING), grant/funder visibility layer, honest limits section.
- **GitHub Pages docs** (webfetched 2026-08-28): confirmed Pages serves any static files; GitHub Actions workflow template handles non-Jekyll generators; entry file = `index.html`/`index.md`/`README.md` at root of publishing source.
- **GitHub REST API** (webfetched 2026-08-28): `/users/<name>/repos` and `/repos/<owner>/<name>` return full repo metadata (stars, forks, language, license, topics, description, last-updated, etc.). 60 req/hr unauthenticated for public repos.

## 3. What was NOT done (gaps, to be addressed)

- ❌ Astro GitHub integration page 404 (URL was wrong). Will use `gh api` or direct fetch from browser.
- ❌ Custom font choice. Default to system stack until user requests a specific font.
- ❌ Logo / favicon. Will use a text monogram or skip and add later.
- ❌ Analytics. Skip for v1 (no cookies, no tracking — sovereign by default).

## 4. Site structure

```
neuro-nomad-site/                        ← new repo at E:\neuro-nomad-site
├── index.html               (landing — AIDE as hero)
├── about/                   (Neuro_Nomad bio + repo list)
├── projects/                (auto-synced from GitHub API)
├── src/
│   ├── styles/
│   │   ├── tokens.css       (design tokens: color, type, spacing)
│   │   └── global.css       (base + components)
│   ├── components/
│   │   ├── header.js
│   │   ├── footer.js
│   │   ├── hero.js
│   │   ├── project-card.js
│   │   └── repo-grid.js     (fetches from GitHub API client-side)
│   └── lib/
│       └── github.js        (fetch helper, no API key)
├── .github/workflows/pages.yml   (auto-deploy on push to main)
├── README.md
├── LICENSE
├── llms.txt
└── SECURITY.md
```

**Decision on Astro vs plain HTML/CSS**: Plain HTML/CSS with small ES modules is enough for 3 pages and a GitHub-fetch component. No build step needed. **Plain HTML/CSS wins** for v1 — simpler to verify, no Astro lock-in, can be migrated to Astro later if the site grows.

**v2 (if site grows)**: migrate to Astro. The component patterns I write here will translate cleanly to Astro `.astro` files.

## 5. Pages (content outline)

### Landing (`/`)
- Header: "Neuro_Nomad" + nav (Projects, About, GitHub)
- Hero:
  - Headline: "Offline-first, model-agnostic developer workbench for AI-assisted software engineering."
  - Subhead: "Built for solo developers, privacy-conscious teams, and air-gapped environments."
  - Primary CTA: "View AIDE on GitHub" → https://github.com/AnonymousNomad/aide-sovereign-workbench
  - Secondary CTA: "Read the docs" (if you set up docs site later)
- Featured project card: AIDE
  - Name + tagline
  - Key metrics (live from GitHub API: stars, forks, last commit)
  - 3 bullet capabilities from AIDE README
  - "View repository" link
- "More projects" teaser: "View all 4 other projects on GitHub" → https://github.com/AnonymousNomad?tab=repositories
- Footer: copyright, license link, "Apache-2.0" badge, GitHub icon link

### Projects (`/projects/`)
- Header + nav
- Page title: "Projects"
- Auto-fetched grid of all 5 repos (real data via GitHub API)
- Each card: name, description, language, stars, last commit, license, link

### About (`/about/`)
- Header + nav
- Bio: "Licensed electrician → self-taught systems developer. Offline AI runtimes, training pipelines, low-level integration, and evidence-first cybersecurity controls." (verbatim from your profile)
- 8 followers / 24 following (real numbers)
- 5 public repos count
- "Get in touch" section: GitHub link, sponsors link

## 6. Public-facing copy rules (per `web-human-systems-security` skill + memory)

- Pure technical description only.
- No mention of: contest, grants, money, "beating", "winning", leaderboards, comparisons-as-superiority.
- AIDE's existing README already follows this. Site will match.
- License prominently shown (Apache-2.0 for AIDE, MIT for Vitalis).
- Sponsorship link allowed but only as maintenance-funding language (per the existing GitHub Sponsors badge on AIDE README).

## 7. Security / threat matrix

| Threat | Mitigation |
|---|---|
| API key leaked | None used (public repos, unauthenticated GitHub API). |
| XSS via repo description | Render repo text as text (`.textContent`), not `innerHTML`. |
| Rate-limit from GitHub API | Cache results in localStorage for 5 min; show stale state on 403. |
| User-tracked cookies | None. No analytics, no fonts, no CDN dependencies. |
| Secret in committed code | Pre-commit secret scan (npm scripts/secret-scan.mjs or equivalent). |
| Broken external links | All outbound links go to GitHub-owned domains; check at deploy. |
| Dependency vulnerabilities | Astro / no build deps = minimal surface. Lockfile committed. |
| Build script injection | No build step in v1 (plain HTML/CSS). |
| Browser storage abuse | Only localStorage for GitHub-API cache; cleared on user action. |

## 8. Dependencies

- **None at runtime in browser**: pure HTML + CSS + ES modules. No framework.
- **Optional local dev**: any static file server (`python -m http.server` works).
- **Optional deploy helper**: `gh` CLI (already installed, not authenticated yet).
- **GitHub API** (unauthenticated, public): https://api.github.com

## 9. Verification plan (per `web-builder-production-canary`)

- [ ] `node --check` any JS files (if any)
- [ ] Local preview served via `python -m http.server`; manually inspect each page
- [ ] Lighthouse: Performance, Accessibility, SEO, Best Practices all green
- [ ] axe-core a11y check: zero violations
- [ ] WCAG AA contrast verified on every text/bg pair
- [ ] Keyboard navigation: tab through nav, cards, links; verify focus order
- [ ] Mobile: 375px, 768px, 1024px viewports
- [ ] GitHub API rate-limit handling verified (simulate 403)
- [ ] All outbound links resolve (no 404)
- [ ] llms.txt at root with 10-20 line summary + link list
- [ ] README with deploy instructions
- [ ] No secrets in tree (`git diff` after first commit, scan for `ghp_`, `sk-`, `AKIA`, etc.)

## 10. Out of scope for v1

- Custom domain (user chose free subdomain)
- Search functionality
- RSS / Atom feed
- Newsletter signup
- Comments / community
- Multiple languages (i18n)
- Dark mode toggle (defer; design tokens support it if added later)
- AIDE docs mirror (link out to AIDE repo instead)
- Live demo / sandbox

## 11. Estimated time to done (with verification)

- Scaffold + design tokens: 1-2h
- Index page: 1h
- Projects page + GitHub API integration: 1h
- About page: 30 min
- Headers/footers/styles: 1h
- Verification (Lighthouse, a11y, links): 1h
- README + llms.txt + security scan: 30 min
- **Total: ~6-7h wall-clock**

User pushes to `<username>.github.io` when ready. Site goes live in <10 min after push.

## 12. Open questions for user (after build is done)

- Logo / favicon: text monogram OK, or do you have a brand mark?
- Do you want a "now" / "what I'm working on" section? (Updates monthly)
- Do you want blog posts? (Astro content collections make this easy later)
