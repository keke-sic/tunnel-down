# SIC Life — tunnel-down landing page

Branded page shown to customers when the Cloudflare Tunnel (or the Caddy box
behind it) is unreachable and Cloudflare would otherwise show its default
**Error 1033 / 5xx** screen.

| File            | Purpose                                                              |
| --------------- | ------------------------------------------------------------------- |
| `index.html`    | The page. Fully self-contained — logo inlined as a data URI, no external requests, ~52 KB. Light/dark aware. Auto-polls `/` every 20s and reloads when the origin recovers. |
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

### Option A — Worker failover (recommended, works on every plan)

Fronts the hostnames, forwards to origin, and swaps in `index.html` when the
origin throws or returns `502/503/504/52x/530`.

```bash
cd "custom Error"
npx wrangler login          # once, against the account that owns siclife.com.gh
npx wrangler deploy
```

Edit the `routes` list in `wrangler.toml` first so it matches exactly the
hostnames the tunnel serves.

Notes:

- Workers Free = 100k requests/day across all routes. If staff + self-service
  traffic is higher, add the Workers Paid plan ($5/mo → 10M/month).
- The Worker is on the request path at all times but does nothing except an
  extra `fetch()` passthrough while the origin is healthy (sub-millisecond CPU).
- Recovery is automatic: the page's poller sees `/` return 200 and reloads.

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

## Testing

- **Look:** open `index.html` directly in a browser; toggle OS dark mode.
- **Worker logic:** `npx wrangler dev` then point a route's origin at a dead
  port, or temporarily add `return maintenancePage();` at the top of `fetch`.
- **Recovery poll:** serve the folder (`npx serve`), load the page, then bring
  a server up on `/` — the page should reload itself within ~20s.
