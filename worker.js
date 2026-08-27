/**
 * SIC Life — origin-down failover Worker.
 *
 * Sits in front of the *.siclife.com.gh hostnames. On every request it tries the
 * real origin (the Caddy box behind the Cloudflare Tunnel). If the tunnel/origin
 * is unreachable — connection thrown, or a Cloudflare edge 5xx/52x/530 (this is
 * what Error 1033 "tunnel not found" surfaces as) — it serves the branded
 * maintenance page instead of Cloudflare's default error screen.
 *
 * The maintenance page (index.html) polls "/" every 20s and reloads itself once
 * the origin answers 200 again, so visitors recover without touching anything.
 *
 * Deploy: see README.md.
 */

import MAINTENANCE_HTML from "./index.html";

// Edge status codes that mean "couldn't reach a healthy origin".
// 530 is what a down Cloudflare Tunnel (Error 1033) returns.
const ORIGIN_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

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
