# targetly-mcp

[![npm](https://img.shields.io/npm/v/targetly-mcp)](https://www.npmjs.com/package/targetly-mcp) [![license](https://img.shields.io/npm/l/targetly-mcp)](LICENSE) [![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io) [![Tawakkul Labs](https://img.shields.io/badge/by-Tawakkul%20Labs-0f766e)](https://tawakkul-labs.co.ke)

Deployment truth verification for AI agents. Targetly answers the question every deploy ignores: is the thing you see at the domain the thing you just built?

It resolves where a domain actually serves from, verifies live content against expectations, judges whether a cache is hiding the new build, and catches the classic mistake of deploying to a platform that does not serve the domain.

Built as an MCP server, so it works in any platform that speaks Model Context Protocol.

## Why

Deploys lie. The build passes, the tool prints "Production URL", and the live site still serves last week. The causes are ordinary: the domain is proxied behind a CDN, the CNAME points at a platform you do not deploy to, a cache holds the old HTML, or two sites share a name and you pushed to the wrong one. Agents cannot see any of this from a build log. Targetly goes to the actual internet and checks.

## Tools

### targetly.origin

Resolve where a domain serves from. Returns the CNAME chain, A records, the detected platform, and whether the origin is hidden behind a CDN proxy. When a domain is proxied, Targetly says so plainly and tells you the origin must be read from the CDN configuration, not DNS.

### targetly.verify

Fetch a live URL and check it against expectations. Provide markers the page must contain and markers that would prove it is stale. Returns a verdict of `LIVE_AND_CURRENT` or `MISMATCH` with the exact missing or stale content.

### targetly.cache

Inspect cache headers and judge whether a deploy is hidden behind a cached copy. Reports CDN cache status, cache control, age, entity tags, and the server.

### targetly.route

Compare what a domain points at with the deploy tooling present in a build directory. Detects platform markers like `netlify.toml`, `wrangler.toml`, and `vercel.json`, and returns `ROUTE_ALIGNED` or `ROUTE_MISMATCH`.

## Usage

Run the server:

```bash
targetly-mcp
```

Configure it as an MCP server in your client:

```json
{
  "mcpServers": {
    "targetly": {
      "command": "targetly-mcp",
      "args": []
    }
  }
}
```

Then, after any deploy, ask the agent:

* "Deploy this build and then verify the live site shows the new content."
* "Is tawakkul-labs.co.ke served by Cloudflare or Netlify?"
* "Is the live homepage stale?"
* "Where does this domain actually point?"

## Install

```bash
npm install -g targetly-mcp
```

## Requirements

* Node 18 or newer
* Network access for DNS resolution and HTTP requests

## License

MIT. Part of the Tawakkul Labs open source family alongside HEIDES, Heides Lens, Cornea, HEIDES VOLT, and harmony-mcp.

---

Links: [npm](https://www.npmjs.com/package/targetly-mcp) | [GitHub](https://github.com/AbduljabbarBXR/targetly-mcp) | [Tawakkul Labs](https://tawakkul-labs.co.ke)
