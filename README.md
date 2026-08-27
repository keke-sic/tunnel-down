# SIC Life — tunnel-down landing page

Branded page shown to customers when the Cloudflare Tunnel (or the Caddy box
behind it) is unreachable and Cloudflare would otherwise show its default
**Error 1033 / 5xx** screen.

| File            | Purpose                                                              |
| --------------- | ------------------------------------------------------------------- |
| `index.html`    | The page. Fully self-contained — logo inlined as a data URI, no external requests, ~59 KB. Light/dark aware. Shows a GitHub-status-style recovery tracker (Investigating → Identified → Recovering → Resolved) with a live indicator and indeterminate progress bar. No "retry" button — it polls `/` every 20s on its own, animates the tracker to *Resolved*, and reloads the moment the origin recovers. |
| `worker.js`     | Cloudflare Worker that detects an unreachable origin and serves `index.html`. For Free/Pro/Business plans. |
| `wrangler.toml` | Deploy config for the Worker. |

Contacts, logo and wording were taken from the live self-service portal
(`siclife-ui`). Update `index.html` directly if any of those change.

---

## Why a Worker (and not "Custom Error Pages")

Cloudflare only lets you replace the **1033 / 5xx** screens natively on the
**Enterprise** plan (Dashboard → your zone → *Custom Pages*). The newer
**Custom Error Rules** (Pro+) only fire on errors returned by *your origin* —
they explicitly do **not** fire on Cloudflare-generated errors like 1033, which
is exactly the tunnel-down case.

So unless the zone is Enterprise, the page has to be served by something that
runs at the edge *instead of* the dead origin. Pick one:

### Option A — Worker failover (recommended, works on every plan) — CHOSEN

The zone is on Free/Pro/Business (confirmed Aug 2026), so this is the path.
The Worker fronts the hostnames, forwards to origin, and swaps in `index.html`
only when Cloudflare could not reach the tunnel at all — a thrown connection, or
a Cloudflare-generated edge error `521/522/523/524/530` (Error 1033 surfaces to
a Worker subrequest as **530**).

It deliberately does **not** trigger on `502/503/504`: the SvelteKit origin
serves its own real `503` for the portal's scheduled maintenance window
(`portal/+layout.server.ts` → `error(503, 'maintenance')`, nightly 17:00–08:00 +
weekends) and its own 5xx error pages — those pass straight through, so the
Worker can't override the portal's own "reopens at 8am" page. See the
`ORIGIN_DOWN` set in `worker.js`.

`index.html` is pulled into the Worker bundle by `import MAINTENANCE_HTML from
"./index.html"` — Wrangler treats `.html` as a Text module by default, no
config needed. Build verified on Wrangler 4.127 (~52 KiB, ~20 KiB gzipped).

#### Deploy

```bash
cd "/home/kekeli/Desktop/custom Error"

# 1. Authenticate against the account that owns siclife.com.gh.
npx wrangler login
#    Headless box (no browser)? Instead:
#      export CLOUDFLARE_API_TOKEN=...        # token needs, on the siclife.com.gh zone:
#      #   Account · Workers Scripts · Edit
#      #   Zone    · Workers Routes  · Edit

# 2. Make sure the `routes` in wrangler.toml match the tunnel's real hostnames.

# 3. Build check — no auth needed, just confirms the bundle.
npx wrangler deploy --dry-run          # expect: Total Upload: ~52 KiB

# 4. Ship it. Uploads the Worker + binds the routes, global in a few seconds.
npx wrangler deploy
```

#### Verify

| Check | How | Expect |
| --- | --- | --- |
| Transparent when healthy | Load `https://self-service.siclife.com.gh` | Normal site, unchanged |
| Failover fires | Stop `cloudflared` ~30s (try `preview.` first) | Branded page, not CF's 1033 |
| Auto-recovery | Restart `cloudflared` | Page reloads to the real site within ~20s |

#### Operate

- **Update the page:** edit `index.html`, re-run `npx wrangler deploy`. If the
  logo changes, re-inline it — it's a base64 `data:` URI in the `<img src>`
  (`base64 -w0 logo.svg`, prefix `data:image/svg+xml;base64,`).
- **Roll back:** `npx wrangler rollback`.
- **Remove entirely:** `npx wrangler delete` — drops the Worker and its routes;
  traffic goes straight to origin again, exactly like before deploy.
- **Watch usage:** Cloudflare dash → Workers & Pages → `siclife-origin-failover`
  → Metrics. Free tier ceiling is 100k requests/day across all routes combined;
  Workers Paid ($5/mo) lifts it to 10M/month.
- The Worker is on the request path at all times but only does an extra
  `fetch()` passthrough while origin is healthy (sub-millisecond CPU).

### Option B — Load Balancer failover (no Worker on the hot path)

1. Host `index.html` somewhere always-up and **not behind the tunnel** —
   easiest is a Cloudflare Pages project (free): `npx wrangler pages deploy .`
2. Cloudflare Dashboard → *Traffic → Load Balancing*:
   - Primary pool → the tunnel origin, with a health check on `/`.
   - Fallback pool → the Pages URL from step 1.
   - Attach the LB to the `*.siclife.com.gh` hostnames.
3. When the health check fails, Cloudflare routes to the fallback pool.

Cost: Load Balancing is ~$5/mo + $5 per extra origin/health-check bundle.
Failover lag = one failed health-check interval (min 60s, or faster on paid).

### Option C — Enterprise Custom Pages

If the zone is Enterprise:

1. Add this line somewhere inside `<body>` of `index.html` (Cloudflare rejects
   the upload without it and replaces it with its own details box):

   ```html
   <!-- keep visible: Cloudflare injects the error box here -->
   <div style="margin-top:24px">::CLOUDFLARE_ERROR_1000S_BOX::</div>
   ```

   For the 5xx page use `::CLOUDFLARE_ERROR_500S_BOX::` instead.
2. Host the file at a public URL Cloudflare can fetch once (Pages, R2, anything).
3. Dashboard → zone → *Custom Pages* → **1XXX Errors** (and **500 Class Errors**)
   → *Add page* → paste the URL → **Publish**.

These pages are **zone-wide** — they replace the error screen for every
hostname in `siclife.com.gh`, not just the tunnel ones.

---

## Also worth doing: make the tunnel harder to drop

Independent of the page — run `cloudflared` with more than one replica /
connector so a single crash or host reboot doesn't take the tunnel down at all.
The failover page is the safety net, not the fix.

---

## Local testing (before deploy)

- **Look:** open `index.html` directly in a browser; toggle OS dark mode. Or
  screenshot both themes with Playwright (`colorScheme: 'light' | 'dark'`).
- **Worker logic:** temporarily add `return maintenancePage();` at the top of
  `fetch()` in `worker.js`, run `npx wrangler dev`, hit `http://localhost:8787`.
- **Recovery poll:** `npx serve .` (or any static server), open the page, then
  start something answering 200 on `/` — the page should reload within ~20s.

## History

- **2026-08-27** — Built. `index.html` content (logo, contacts, wording) mirrors
  the `siclife-ui` self-service portal at that date. Committed to `main`
  (`d3e0955`). Not yet deployed to Cloudflare — handed over for manual wiring.
- **2026-08-27** — Added the GitHub-status-style recovery tracker + animations,
  dropped the "Try again" button (the auto-poll already covers it).
