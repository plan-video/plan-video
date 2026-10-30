The website is static files: build them once, copy them to your server, and let Caddy serve them alongside the services.

## Build it

Put your settings in `apps/web/.env` first. The build reads them and writes them into the pages. [Environment variables](/docs/configuration#the-website) lists them.

```bash
npm ci
npm run build
```

The build type-checks the code, then writes `apps/web/dist`: the app, which serves the dashboard and the editor, with a Content-Security-Policy in every page. A copy you run has no homepage of its own, so `/` opens the dashboard.

Copy `dist` to the folder Caddy serves:

```bash
rsync -a --delete apps/web/dist/ your-server:/var/www/plan.video/
```

## Serve it with Caddy

[Caddy](https://caddyserver.com) gets HTTPS certificates on its own. This `Caddyfile` routes each service's path to its port and serves the site:

```text /etc/caddy/Caddyfile
your-domain.com {
	# Each service, at its own path.
	handle /api/publisher/* {
		reverse_proxy 127.0.0.1:8798
	}
	handle /api/storage/* {
		reverse_proxy 127.0.0.1:8788
	}
	handle /api/tiktok* {
		reverse_proxy 127.0.0.1:8789
	}
	handle /api/youtube* {
		reverse_proxy 127.0.0.1:8790
	}
	handle /api/linkedin* {
		reverse_proxy 127.0.0.1:8795
	}
	handle /api/x/* {
		reverse_proxy 127.0.0.1:8797
	}
	handle /api/transcribe {
		reverse_proxy 127.0.0.1:8792
	}
	handle /api/billing/* {
		reverse_proxy 127.0.0.1:8799
	}
	# The Assistant streams its replies, so pass them on as they come.
	handle /api/agent* {
		reverse_proxy 127.0.0.1:8796 {
			flush_interval -1
		}
	}
	# Agents, and the WebSocket each open tab keeps to the MCP server.
	@mcp path /mcp /api/mcp/tab /.well-known/oauth-protected-resource*
	handle @mcp {
		reverse_proxy 127.0.0.1:8791
	}

	# The website: a built page for each address, or the app.
	handle {
		root * /var/www/plan.video
		encode zstd gzip
		header {
			# The editor needs these to use SharedArrayBuffer.
			Cross-Origin-Opener-Policy same-origin
			Cross-Origin-Embedder-Policy credentialless
			# No other site may show these pages in a frame.
			Content-Security-Policy "frame-ancestors 'none'"
			X-Frame-Options DENY
		}
		header /assets/* Cache-Control "public, max-age=31536000, immutable"
		try_files {path} {path}.html /index.html
		file_server
	}
}

www.your-domain.com {
	redir https://your-domain.com{uri} permanent
}
```

Then check it and load it:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

A few things the services expect from the proxy, which this file does:

- **No compression or buffering on the API.** `encode` stays in the website's block, so the Assistant's replies stream as they're written.
- **WebSockets on `/api/mcp/tab`.** Caddy passes them through on its own.
- **Large uploads on `/api/transcribe`**, up to 100 MB of audio. Caddy sets no limit unless you add one.

Addresses with no page of their own, like `/dashboard`, get the app, which shows its own "not found" page for an address it doesn't know.

## Your domain in the website

The website takes your address from `VITE_APP_URL` in `apps/web/.env`, and reports errors to Sentry only when you give it your own project's `VITE_SENTRY_DSN`. Nothing in its code needs changing. The sign-in callbacks the services keep are on [Network apps](/docs/network-apps#your-domain).
