Everything that needs a secret runs on your server as a small Node.js service. Each one listens on `127.0.0.1`, sits behind Caddy at its own path, and is kept running by systemd. Each service's code is in `services/<name>`, with its systemd unit beside it.

## The services

| Service | Port | Path | What it does |
| --- | --- | --- | --- |
| `gateway` | 8798 | `/api/publisher/` | Takes the publisher's public traffic. It holds no login, database or storage key. |
| `publisher` | 8794 | | Sends scheduled posts, keeps every network login, reads Analytics. Only the gateway reaches it. |
| `photos` | 8793 | | Makes pictures the size each network wants, for the publisher. It holds no keys and isn't reachable from outside. |
| `storage` | 8788 | `/api/storage/` | Signs upload and download links for your R2 bucket |
| `tiktok` | 8789 | `/api/tiktok` | Starts TikTok sign-ins |
| `youtube` | 8790 | `/api/youtube` | Starts YouTube sign-ins |
| `linkedin` | 8795 | `/api/linkedin` | Starts LinkedIn sign-ins |
| `x` | 8797 | `/api/x/` | Starts X sign-ins |
| `mcp` | 8791 | `/mcp` | The MCP server AI agents connect to |
| `agent` | 8796 | `/api/agent` | The dashboard's Assistant and the editor's caption tools, with Claude |
| `transcribe` | 8792 | `/api/transcribe` | Auto-captions, with ElevenLabs speech-to-text |
| `billing` | 8799 | `/api/billing/` | Paid plans, with Stripe |
| `monitor` | | | Checks the server every minute and reports to Healthchecks.io |

You need `publisher`, `gateway`, `photos` and `storage`, plus the service of each network you connect. The rest are optional: without `mcp` agents can't connect, without `agent` there's no Assistant, without `transcribe` there are no auto-captions, and without `billing` everyone stays on the Free plan unless you [give them a plan](/docs/self-hosting#give-yourself-a-plan).

## Settings files

The services read their settings from `/etc/plan-video`. Most have their own `<name>.env`; `storage` needs only the shared `r2.env`, which holds the Supabase address and the R2 bucket, and which every service but `mcp`, `monitor`, `gateway` and `photos` reads. `photos` reads no settings at all.

```bash /etc/plan-video/r2.env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-publishable-key
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET=your-bucket
# Your site's address. Without it, the network services refuse sign-ins to your domain.
PUBLIC_URL=https://your-domain.com
# Lets everyone with an account in. Leave it out to let in only emails you've added.
REQUIRE_INVITE=false
```

The services read these files themselves, once, when they start:

- One `KEY=value` per line, with no quotes around the value.
- A `#` starts a comment only at the start of a line.
- After changing a file, restart the services that read it.

Make each file owned by `root` and by the group of the service that reads it, with mode `640`: `<name>.env` by `planvideo-<name>`, `meta.env` by `planvideo-publisher`, and `r2.env`, which most services share, by `planvideo-r2`. `monitor` runs as root, so `monitor.env` needs no group of its own. Then a bug in one service can't read another's keys. [Environment variables](/docs/configuration) lists every key.

## Install a service

The units expect each service in `/opt/plan-video-<name>`, each run by a user of its own, `planvideo-<name>`. They run `/usr/bin/node`, so install Node.js 22 there first, from your distribution or [nodejs.org](https://nodejs.org). `services/deploy.sh` also needs `git`, `rsync`, `curl`, and `node` and `npm` on your path, and runs as root.

<Steps>
  <Step title="Make the users">
    ```bash
    groupadd --system planvideo-r2
    for name in agent billing linkedin mcp photos publisher storage tiktok transcribe x youtube; do
      useradd --system --no-create-home --shell /usr/sbin/nologin --user-group planvideo-$name
    done
    usermod -aG planvideo-r2,planvideo-tiktok,planvideo-youtube,planvideo-linkedin,planvideo-x planvideo-publisher
    ```
    Every service but `mcp`, `gateway` and `photos` also reads `r2.env`, so its unit adds `planvideo-r2`. `services/deploy.sh` makes the gateway's own user, `planvideo-gateway`. The publisher refreshes logins with each network's keys, so it's in those groups too.
  </Step>
  <Step title="Write its settings">
    Put its keys in `/etc/plan-video/<name>.env`, if it has any. Its section in [Environment variables](/docs/configuration) says which.
  </Step>
  <Step title="Install it">
    Clone the repository on the server once, then let `services/deploy.sh` install each service:
    ```bash
    git clone https://github.com/plan-video/plan-video.git /opt/plan-video-src
    cd /opt/plan-video-src
    services/deploy.sh storage
    ```
    It copies `services/<name>` to `/opt/plan-video-<name>`, installs its packages, installs and enables its systemd unit, starts it and checks it came up.
  </Step>
</Steps>

## Update

```bash
cd /opt/plan-video-src
git pull --ff-only
services/deploy.sh status
services/deploy.sh all
```

`status` shows the commit each service runs and how many of its files differ from the checkout. `all` updates every service that differs, the publisher and then the gateway last, and restarts only those. Each is backed up to `/var/backups/plan-video` first. One whose code doesn't parse, or that doesn't come up healthy, is put back as it was. `--dry-run` lists what would change without changing it.

`all` also installs and starts any service you skipped. `mcp` won't start without `mcp.env`, and that stops the run before the publisher, so if you skipped any, name the ones you run instead: `services/deploy.sh storage tiktok photos publisher`.

## The publisher

The publisher imports the network services' code, so it's laid out as the repository is:

```text
/opt/plan-video-publisher/
  publisher/   services/publisher, with its node_modules
  tiktok/      services/tiktok
  youtube/     services/youtube
  linkedin/    services/linkedin
  x/           services/x
```

It runs on the official Node.js 22 build from [nodejs.org](https://nodejs.org), at `/opt/node-v22.22.1`, the path its unit names. [Bluesky](/docs/bluesky-app#nodejs) says why. Unpack it there first, using `arm64` in place of `x64` on an ARM server:

```bash
curl -fsSL https://nodejs.org/dist/v22.22.1/node-v22.22.1-linux-x64.tar.xz | tar -xJ -C /opt
mv /opt/node-v22.22.1-linux-x64 /opt/node-v22.22.1
```
 `services/deploy.sh publisher` lays it out this way and installs the unit with its drop-in. It only comes up healthy once it has its keys, below: make them, then `systemctl restart plan-video-publisher`.

It reads `publisher.env`, `r2.env`, and each network's file. It sends each post the moment it's due, up to 16 at once, and looks for anything else due every 5 seconds. A restart lets the sends going finish first, for up to 30 seconds. It retries a failed send after 2, 10 and 30 minutes, and never sends one run twice.

## Photos

Pictures come from anyone with an account, and a damaged or crafted file can crash the code that decodes it, or worse. So the publisher never opens one itself: it sends each picture to `photos` on `127.0.0.1:8793` and gets the finished file back. Its unit runs it as a user of its own, with no settings file and no access to the internet, and restarts it if it stops.

If `photos` is down, text and video posts still go out. On Bluesky, a picture under 1 MB still goes out, and a larger one is tried again. Instagram, Facebook, Threads and TikTok fetch their pictures from your server, so their picture posts can fail while it's down.

Install it before updating the publisher: `services/deploy.sh all` does this for you, once the `planvideo-photos` user exists.

## The gateway

`services/deploy.sh publisher` installs it too, the first time. It starts as the publisher leaves port 8798, and if either doesn't come up, the old publisher goes back on that port.

The publisher holds every login and sends every post, so nothing on the internet talks to it directly. The gateway takes `/api/publisher/` from Caddy and passes each request on.

- **What it holds:** only `SENDER_SECRET`, the password for reaching the publisher, in `gateway.env`. `services/deploy.sh` makes it, adds it to `publisher.env` and writes `gateway.env`, so there's nothing to set up. It has no login, database or storage key, and its unit lets it talk only to this server.
- **If someone broke into it:** they couldn't read logins, or post on their own. The publisher still checks every session and signed link, so they'd get only what comes through while they're there, such as the sessions of people using the dashboard at the time. Fix the hole, change the password below, and end everyone's sessions in Supabase.
- **What it doesn't cover:** both services run on one server as separate users. Someone who gets root there has everything.

To change the password, remove the `SENDER_SECRET` line from `publisher.env`, then run `services/deploy.sh gateway`. It makes a new one and restarts both.

## The publisher's keys

`TOKEN_KEY` seals every network login, and `BLUESKY_OAUTH_JWK` is your "Sign in with Bluesky" client's private key. Make both once, on the server, after `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are in `publisher.env`:

```bash
cd /opt/plan-video-publisher/publisher
PUBLIC_URL=https://your-domain.com /opt/node-v22.22.1/bin/node scripts/make-keys.mjs >> /etc/plan-video/publisher.env
```

It also adds `SEND_FROM`, the moment from which scheduled runs are sent, and `PUBLIC_URL`, your site's address, unless `publisher.env` has one already. Without `PUBLIC_URL=` in front, it writes plan.video's.

`make-keys` refuses to run when `publisher.env` already has keys, or when the database already keeps logins sealed with an earlier key.

<Warning>
If you lose `TOKEN_KEY`, every connected account has to connect again. Keep a copy off the server, then check that the copy opens every kept login:

```bash
sudo -u planvideo-publisher /opt/node-v22.22.1/bin/node scripts/check-keys.mjs --stdin < key-backup
```

It exits with 0 when every login opens, and prints a fingerprint, never the key.
</Warning>

## Check it works

```bash
curl https://your-domain.com/api/publisher/health
journalctl -u plan-video-publisher -f
```

Health answers `200` with `"ok": true`, or `503` with a list of problems: posts running late, sends failing, a `TOKEN_KEY` that doesn't open the logins, no sending pass in 15 minutes, or a publisher the gateway can't reach.

## Monitoring

`services/monitor/watchdog.sh` checks the server every minute:

- Caddy and each `plan-video-*` unit are running, and each port answers.
- The site and the publisher's health answer.
- Memory, disk space and the TLS certificate are fine.

It pings `HC_PING_URL` from `/etc/plan-video/monitor.env` when all is well, and its `/fail` address when something isn't. [Healthchecks.io](https://healthchecks.io) then emails you about problems, and also when the server stops checking in.

To set it up:

1. Put `PUBLIC_URL=https://your-domain.com` in `/etc/plan-video/monitor.env`, beside `HC_PING_URL`.
2. Run `services/deploy.sh monitor`. It copies the script to `/opt/plan-video-monitor` and installs and starts the timer.

The script checks every service in its `PORTS` list, so a service you skipped reports as a problem every minute.
