/**
 * SIC Life — origin-down failover Worker.
 *
 * Sits in front of the *.siclife.com.gh hostnames. On every request it tries the
 * real origin (the Caddy box behind the Cloudflare Tunnel). If Cloudflare itself
 * could not reach the tunnel — a thrown connection, or a Cloudflare-generated
 * 52x/530 edge error (530 is what Argo Tunnel error 1033 "tunnel not found"
 * surfaces as) — it serves the branded maintenance page instead of Cloudflare's
 * default error screen.
 *
 * The maintenance page (index.html) polls "/" every 20s and reloads itself once
 * the origin answers 200 again, so visitors recover without touching anything.
 *
 * Deploy: see README.md.
 */

import MAINTENANCE_HTML from "./index.html";

// Cloudflare *edge* status codes that mean "the tunnel/origin could not be
// reached at all". Deliberately NOT 502/503/504 or 520/525/526: the origin
// (SvelteKit) serves its own real 503 for the portal's scheduled nightly
// maintenance window — portal/+layout.server.ts throws error(503,'maintenance'),
// rendered by +error.svelte — plus its own 5xx error pages. Those must pass
// through untouched, otherwise this Worker overrides the portal's own
// "we reopen at 8am / Monday" page every night from 17:00 and all weekend.
//   521 web server is down    522 connection timed out
//   523 origin unreachable    524 origin timeout
//   530 paired with Argo Tunnel error 1033 (tunnel not found)
const ORIGIN_DOWN = new Set([521, 522, 523, 524, 530]);

export default {
  async fetch(request) {
    let response;
    try {
      // A Worker's fetch() for its own route bypasses the Worker and hits origin,
      // so this cannot recurse.
      response = await fetch(request);
    } catch (err) {
      return maintenancePage();
    }

    if (ORIGIN_DOWN.has(response.status)) {
      return maintenancePage();
    }

    return response;
  },
};

function maintenancePage() {
  return new Response(MAINTENANCE_HTML, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "retry-after": "60",
    },
  });
}
