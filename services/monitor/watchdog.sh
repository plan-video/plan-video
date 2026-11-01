#!/usr/bin/env bash
# Checks the plan.video server once and tells Healthchecks.io how it went.
#
# Healthchecks.io is the part that isn't on this server: it emails when a
# check reports a problem, and also when the pings stop, so a server that's
# down, cut off or frozen still raises an alert. Without HC_PING_URL the
# problems only go to the journal (journalctl -u plan-video-monitor).
#
# Run by plan-video-monitor.timer every minute. `watchdog.sh --dry-run`
# checks and prints without pinging.

set -uo pipefail

# The site it checks from outside, and the name on its certificate. PUBLIC_URL
# (in monitor.env) for a copy hosted somewhere else.
SITE=${PUBLIC_URL:-https://plan.video}
SITE=${SITE%/}
DOMAIN=${SITE#*://}
DOMAIN=${DOMAIN%%[/:]*}
STATE=${STATE_DIRECTORY:-/var/lib/plan-video-monitor}
# Each service answers on its own port; any HTTP answer, even a 404, means it's serving.
PORTS="agent:8796 billing:8799 linkedin:8795 mcp:8791 photos:8793 publisher:8798 storage:8788 tiktok:8789 transcribe:8792 x:8797 youtube:8790"
DISK_MAX_PCT=90
MEM_MIN_MB=150
CERT_MIN_DAYS=14

dry=false
[ "${1:-}" = "--dry-run" ] && dry=true

# Problems that may pass in a moment (a service restarting for a deploy). Asked twice before they count.
passing() {
  local out=()
  for unit in caddy $(systemctl list-units 'plan-video-*.service' --all --plain --no-legend | awk '{print $1}' | grep -v '^plan-video-monitor'); do
    systemctl is-active --quiet "$unit" || out+=("${unit%.service} is $(systemctl is-active "$unit")")
  done

  for pair in $PORTS; do
    local name=${pair%%:*} port=${pair##*:} code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$port/")
    [ "$code" = 000 ] && out+=("$name doesn't answer on port $port")
  done

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/")
  [ "$code" = 200 ] || out+=("$SITE answers $code")
  # 503 when no scheduled-post pass has finished for 15 minutes, a post is long past its
  # time, posts keep failing with none going out, or TOKEN_KEY opens none of the logins.
  # Its "problems" say which, and go in the alert.
  local health why
  health=$(curl -s -w '\n%{http_code}' --max-time 10 "$SITE/api/publisher/health")
  code=${health##*$'\n'}
  why=$(printf '%s' "${health%$'\n'*}" | sed -n 's/.*"problems":\[\(.*\)\].*/\1/p' | sed 's/","/; /g; s/"//g')
  [ "$code" = 200 ] || out+=("publisher health answers $code: ${why:-scheduled posts may not be going out}")

  local mem
  mem=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
  [ "$mem" -lt "$MEM_MIN_MB" ] && out+=("only ${mem} MB of memory free")

  printf '%s\n' "${out[@]}"
}

# Problems that stay until someone fixes them.
lasting() {
  local pct
  pct=$(df --output=pcent / | tail -1 | tr -dc 0-9)
  [ "$pct" -ge "$DISK_MAX_PCT" ] && echo "disk is ${pct}% full"

  # Caddy renews 30 days ahead, so a certificate this close to running out means renewing is failing.
  local end
  end=$(echo | openssl s_client -servername "$DOMAIN" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -z "$end" ]; then
    echo "couldn't read the TLS certificate"
  else
    local days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
    [ "$days" -lt "$CERT_MIN_DAYS" ] && echo "TLS certificate runs out in $days days"
  fi
}

# Crashes since the last run: Restart=always brings a service back within seconds, so they'd go unseen.
crashes() {
  local cursor=$STATE/journal-cursor
  if [ ! -f "$cursor" ]; then
    journalctl -q -n 0 --cursor-file="$cursor" >/dev/null
    return
  fi
  journalctl -q --no-pager -o cat --cursor-file="$cursor" -u 'plan-video-*' -u caddy |
    grep -E "Failed with result" | grep -v '^plan-video-monitor' | sed -E "s/\.service: Failed with result '([^']+)'\./ crashed (\1) and restarted/" | sort | uniq -c |
    awk '{n=$1; $1=""; sub(/^ /, ""); print (n > 1 ? $0 " " n " times" : $0)}'
}

problems=$(passing)
if [ -n "$problems" ]; then
  sleep 20
  problems=$(passing)
fi
problems=$(printf '%s\n%s\n%s\n' "$problems" "$(lasting)" "$($dry && echo || crashes)" | sed '/^$/d')

if [ -n "$problems" ]; then
  echo "$problems" >&2
  url=${HC_PING_URL:+$HC_PING_URL/fail}
else
  url=${HC_PING_URL:-}
  $dry && echo "all fine"
fi

$dry && exit 0
[ -n "$url" ] && curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${problems:-all fine}" "$url"
exit 0
