#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as dns } from "node:dns";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const server = new McpServer({
  name: "targetly-mcp",
  version: "0.1.0",
});

function detectPlatform(host) {
  const h = host.toLowerCase();
  if (h.includes("pages.dev") || h.includes("pages.cloudflare")) return "Cloudflare Pages";
  if (h.includes("netlify.app")) return "Netlify";
  if (h.includes("vercel.app")) return "Vercel";
  if (h.includes("github.io") || h.includes("githubusercontent")) return "GitHub Pages";
  if (h.includes("cloudflare")) return "Cloudflare";
  if (h.includes("workers.dev")) return "Cloudflare Workers";
  if (h.includes("firebaseapp") || h.includes("web.app")) return "Firebase Hosting";
  if (h.includes("surge.sh")) return "Surge";
  return "unknown";
}

function normalizeDomain(input) {
  let d = String(input || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return d;
}

function isCloudflareIp(ip) {
  const [a, b] = ip.split(".").map(Number);
  if (a === 104 && b >= 16 && b <= 31) return true; // 104.16.0.0/13
  if (a === 172 && b >= 64 && b <= 71) return true; // 172.64.0.0/13
  if (a === 188 && b === 114 && ip.split(".")[2] >= 96 && ip.split(".")[2] <= 127) return true; // 188.114.96.0/20
  if (a === 162 && (b === 158 || b === 159)) return true; // 162.158.0.0/15
  if (a === 190 && b === 93 && ip.split(".")[2] >= 240) return true; // 190.93.240.0/20
  if (a === 173 && b === 245 && ip.split(".")[2] >= 48) return true; // 173.245.48.0/20
  if (a === 141 && b === 101) return true; // 141.101.64.0/18
  if (a === 198 && b === 41) return true; // 198.41.128.0/17
  return false;
}

async function detectLivePlatform(domain) {
  const chain = await resolveCnameChain(domain);
  if (chain.length) {
    const finalTarget = chain[chain.length - 1];
    return { platform: detectPlatform(finalTarget), target: finalTarget, hidden: false };
  }
  let a = [];
  try {
    a = await dns.resolve4(domain);
  } catch {
    /* no A records */
  }
  if (a.length && a.every(isCloudflareIp)) {
    return {
      platform: "Cloudflare (proxied)",
      target: a.join(", "),
      hidden: true,
      note: "The CNAME is not visible externally because Cloudflare masks it behind proxy addresses. Check the Cloudflare zone config for the true origin.",
    };
  }
  return { platform: "direct hosting (no CNAME, no CDN ranges)", target: a.join(", ") || domain, hidden: false };
}

function normalizeUrl(input, path) {
  let u = String(input || "").trim();
  if (!/^https?:\/\//.test(u)) u = `https://${u}`;
  if (path) u = `${u.replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
  return u;
}

async function resolveCnameChain(domain) {
  const chain = [];
  let current = domain;
  for (let i = 0; i < 5; i++) {
    try {
      const cnames = await dns.resolveCname(current);
      if (!cnames.length) break;
      const next = cnames[0].replace(/\.$/, "");
      chain.push(next);
      current = next;
    } catch {
      break;
    }
  }
  return chain;
}

server.registerTool(
  "targetly.origin",
  {
    description:
      "Resolve where a domain actually serves from. Returns the CNAME chain, A records, the detected platform, and the proxied status, so an agent knows the real origin before deploying.",
    inputSchema: {
      domain: z.string().describe("The domain to resolve, for example tawakkul-labs.co.ke"),
    },
  },
  async ({ domain }) => {
    const d = normalizeDomain(domain);
    const cnameChain = await resolveCnameChain(d);
    const live = await detectLivePlatform(d);
    let aRecords = [];
    try {
      aRecords = (await dns.resolve4(d)).slice(0, 8);
    } catch {
      /* no A records at apex */
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              domain: d,
              cnameChain,
              aRecords,
              platform: live.platform,
              finalTarget: live.target,
              originHidden: live.hidden,
              verdict: live.hidden
                ? `Domain is proxied through ${live.platform}. The true origin is hidden behind the CDN, check the CDN configuration for where it serves from.`
                : cnameChain.length
                  ? `Domain is a CNAME to ${live.target}, served by ${live.platform}`
                  : live.platform,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function fetchText(url, timeoutMs) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs || 25000),
    headers: { "user-agent": "targetly-mcp/0.1.0" },
  });
  const text = await res.text();
  return { res, text };
}

server.registerTool(
  "targetly.verify",
  {
    description:
      "Fetch a live URL and check whether it contains the expected markers and none of the forbidden markers. Use this after a deploy to prove the live site is the new build, not a stale one.",
    inputSchema: {
      url: z.string().describe("The URL to fetch, for example https://tawakkul-labs.co.ke/products"),
      markers: z.array(z.string()).optional().describe("Strings the live page must contain, for example new feature names or version strings"),
      mustNotContain: z.array(z.string()).optional().describe("Strings that would prove the page is stale, for example old branding or removed names"),
    },
  },
  async ({ url, markers, mustNotContain }) => {
    const u = normalizeUrl(url, "");
    const { res, text } = await fetchText(u);
    const found = (markers || []).filter((m) => text.includes(m));
    const missing = (markers || []).filter((m) => !text.includes(m));
    const staleHits = (mustNotContain || []).filter((m) => text.includes(m));
    const verdict = missing.length === 0 && staleHits.length === 0 ? "LIVE_AND_CURRENT" : "MISMATCH";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              url: res.url || u,
              status: res.status,
              bytes: text.length,
              verdict,
              markersFound: found,
              markersMissing: missing,
              staleMarkersPresent: staleHits,
              notes: verdict === "MISMATCH"
                ? (missing.length ? `Missing expected content: ${missing.join(", ")}. ` : "") +
                  (staleHits.length ? `Stale content still present: ${staleHits.join(", ")}.` : "")
                : "Live content matches expectations",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "targetly.cache",
  {
    description:
      "Inspect the cache headers of a live URL and judge whether a deploy might be hidden behind a cached copy. Reports CDN cache status, cache control, age, and entity tags.",
    inputSchema: {
      url: z.string().describe("The URL to inspect"),
    },
  },
  async ({ url }) => {
    const u = normalizeUrl(url, "");
    const res = await fetch(u, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
      headers: { "user-agent": "targetly-mcp/0.1.0" },
    });
    await res.arrayBuffer();
    const headers = {};
    for (const [k, v] of res.headers.entries()) headers[k] = v;
    const cf = headers["cf-cache-status"] || null;
    const cacheControl = headers["cache-control"] || null;
    const age = headers["age"] || null;
    const verdict =
      cf === "HIT" || (cacheControl && /max-age=(\d+)/.test(cacheControl) && parseInt(cacheControl.match(/max-age=(\d+)/)[1], 10) > 0 && age && parseInt(age, 10) > 60)
        ? "POSSIBLY_STALE"
        : "NOT_STALE";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              url: res.url || u,
              status: res.status,
              verdict,
              cacheStatus: cf || "no CDN cache header",
              cacheControl,
              age: age || "no age header",
              etag: headers["etag"] || null,
              lastModified: headers["last-modified"] || null,
              server: headers["server"] || null,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

const PLATFORM_MARKERS = [
  { platform: "Cloudflare Pages", files: ["wrangler.toml", "wrangler.jsonc", ".dev.vars"], hint: "pages.project" },
  { platform: "Netlify", files: ["netlify.toml"], hint: null },
  { platform: "Vercel", files: ["vercel.json"], hint: null },
];

server.registerTool(
  "targetly.route",
  {
    description:
      "Compare what a domain points at with the deploy tooling present in a build directory. Catches the classic mistake of deploying to a platform that does not serve the domain.",
    inputSchema: {
      domain: z.string().describe("The domain that should be serving the build"),
      buildDir: z.string().optional().describe("Local build or project directory to inspect for platform markers"),
    },
  },
  async ({ domain, buildDir }) => {
    const d = normalizeDomain(domain);
    const live = await detectLivePlatform(d);
    const livePlatform = live.platform;
    let localPlatforms = [];
    let localMarkers = [];
    if (buildDir) {
      for (const m of PLATFORM_MARKERS) {
        for (const f of m.files) {
          if (existsSync(join(buildDir, f))) {
            localMarkers.push(`${m.platform}:${f}`);
            localPlatforms.push(m.platform);
          }
        }
      }
    }
    const aligned = localPlatforms.length === 0 || localPlatforms.some((p) => livePlatform.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(livePlatform.toLowerCase().split(" ")[0]));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              domain: d,
              liveTarget: live.target,
              livePlatform,
              originHidden: live.hidden,
              localPlatformMarkers: localMarkers,
              verdict: aligned ? "ROUTE_ALIGNED" : "ROUTE_MISMATCH",
              note: aligned
                ? localPlatforms.length === 0
                  ? "No local platform markers found, deploy tooling unknown"
                  : `Live platform ${livePlatform} matches local deploy tooling`
                : `Domain is served by ${livePlatform} but the build directory is set up for ${localPlatforms.join(", ")}. Deploying here would not update the domain.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);