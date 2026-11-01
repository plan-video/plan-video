#!/usr/bin/env bash
# Installs the services from this checkout as Services in the docs lays them out, then restarts
# and checks what changed. Run as root on the server, from a clean clone of the repository:
#
#   services/deploy.sh status               which commit each service runs, and what differs
#   services/deploy.sh [--dry-run] all      every service, the publisher and then its gateway last
#   services/deploy.sh [--dry-run] <name>…  agent billing gateway linkedin mcp monitor photos publisher storage tiktok transcribe x youtube
#
# A failed check puts the service's previous files back and restarts it.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
DEST=${DEPLOY_ROOT:-/opt}
UNITS=${DEPLOY_UNITS:-/etc/systemd/system}
BACKUPS=${DEPLOY_BACKUPS:-/var/backups/plan-video}
RESTART=${DEPLOY_RESTART:-1}
ENV_DIR=${DEPLOY_ENV:-/etc/plan-video}
NETWORKS=(tiktok youtube linkedin x)
ONE_PIXEL_PNG=iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==
ORDER=(transcribe mcp storage agent billing tiktok youtube linkedin x monitor photos publisher gateway)

say() { printf '%s\n' "$*"; }
fail() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

# "from:to" pairs, from services/ to the service's folder.
parts() {
  case $1 in
    publisher) echo "publisher:plan-video-publisher/publisher"; for n in "${NETWORKS[@]}"; do echo "$n:plan-video-publisher/$n"; done ;;
    *) echo "$1:plan-video-$1" ;;
  esac
}

put() { # $1 from, $2 to, $3 owner, then rsync's own flags
  local from=$1 to=$2 owner=$3
  shift 3
  rsync -rlpc --delete --delete-excluded --itemize-changes --chown="$owner" \
    --filter='P node_modules/' --filter='P node_modules.previous/' --filter='P *.bak*' --filter='P backup-*' --filter='P DEPLOYED' \
    --exclude='node_modules/' --exclude='*.test.mjs' --exclude='fake-db.mjs' --exclude='*.d.mts' --exclude='*.d.ts' \
    --exclude='*.service' --exclude='*.timer' --exclude='*.service.d/' --exclude='deploy.sh' \
    "$@" "$REPO/services/$from/" "$DEST/$to/" | grep -v '^\.d' || true
}

units_of() { find "$REPO/services/$1" -maxdepth 2 \( -name '*.service' -o -name '*.timer' -o -path '*.service.d/*.conf' \) 2>/dev/null; }

unit_target() { # repo path → installed path
  case $1 in
    *.service.d/*) echo "$UNITS/$(basename "$(dirname "$1")")/$(basename "$1")" ;;
    *) echo "$UNITS/$(basename "$1")" ;;
  esac
}

changes() { # what installing $1 would change, one line each
  local name=$1 pair from to owner
  for pair in $(parts "$name"); do
    from=${pair%%:*} to=${pair#*:}
    owner=$(stat -c '%U:%G' "$DEST/${to%%/*}" 2>/dev/null || echo root:root)
    put "$from" "$to" "$owner" --dry-run | sed "s#^#$to: #"
  done
  local unit
  for unit in $(units_of "$name"); do
    cmp -s "$unit" "$(unit_target "$unit")" || echo "unit: $(unit_target "$unit")"
  done
}

healthy() {
  local name=$1 since=$2 i
  [ "$name" = monitor ] && return 0
  for i in $(seq 1 30); do
    if systemctl is-active --quiet "plan-video-$name"; then
      if [ "$name" = photos ]; then
        # A real picture: the unit's sandbox could let it start, yet stop it working.
        base64 -d <<<"$ONE_PIXEL_PNG" | curl -fsS --max-time 10 --data-binary @- -o /dev/null http://127.0.0.1:8793/tiktok 2>/dev/null && return 0
        sleep 2
        continue
      fi
      local body
      if [ "$name" = gateway ]; then
        # The publisher asking for a session, not the gateway's 503 or a 403 for the wrong secret: it got through.
        body=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8798/api/publisher/logins 2>/dev/null || true)
        [ "$body" = 401 ] && return 0
        sleep 2
        continue
      fi
      if [ "$name" != publisher ]; then
        sleep 3
        systemctl is-active --quiet "plan-video-$name" && return 0
        return 1
      fi
      body=$(curl -fsS http://127.0.0.1:8794/api/publisher/health 2>/dev/null || true)
      # Healthy once a pass has finished since the restart.
      if [[ $body == *'"ok":true'* ]] && [[ $(sed -E 's/.*"lastPass":"([^"]+)".*/\1/' <<<"$body") > $since ]]; then return 0; fi
    fi
    sleep 2
  done
  return 1
}

restore() {
  local name=$1 backup=$2 pair to owner
  [ -n "$backup" ] || return 0
  say "  putting back $(basename "$backup")"
  local old
  old=$(mktemp -d)
  tar -xzf "$backup" -C "$old"
  for pair in $(parts "$name"); do
    to=${pair#*:}
    owner=$(stat -c '%U:%G' "$DEST/${to%%/*}")
    rsync -rlpc --delete --chown="$owner" --filter='P node_modules/' --filter='P node_modules.previous/' --filter='P *.bak*' --filter='P backup-*' --filter='P DEPLOYED' \
      "$old/$to/" "$DEST/$to/" >/dev/null
    if [ -d "$DEST/$to/node_modules.previous" ]; then
      rm -rf "$DEST/$to/node_modules"
      mv "$DEST/$to/node_modules.previous" "$DEST/$to/node_modules"
    fi
  done
  rm -rf "$old"
  # Back to a publisher from before the gateway, which needs its port.
  if [ "$name" = publisher ] && [ "$RESTART" = 1 ] && [ ! -f "$DEST/plan-video-publisher/publisher/gateway-link.mjs" ]; then
    systemctl disable --now plan-video-gateway 2>/dev/null || true
    rm -f "$UNITS/plan-video-gateway.service"
    systemctl daemon-reload
  fi
  [ "$name" = monitor ] || [ "$RESTART" != 1 ] || systemctl restart "plan-video-$name"
}

deploy() {
  local name=$1 dry=$2
  local changed
  changed=$(changes "$name")
  # A publisher still to move has to restart even with its files in place.
  if [ -z "$changed" ] && { [ "$name" != publisher ] || [ "$gateway_new" != 1 ]; }; then
    say "$name: up to date"
    [ "$dry" = 1 ] || write_deployed "$name"
    return 0
  fi
  say "$name:"
  sed 's/^/  /' <<<"$changed"
  [ "$dry" = 1 ] && return 0

  local stamp backup="" existing
  existing=$(for pair in $(parts "$name"); do if [ -d "$DEST/${pair#*:}" ]; then echo "${pair#*:}"; fi; done)
  if [ -n "$existing" ]; then
    stamp=$(date -u +%Y%m%d-%H%M%S)
    backup="$BACKUPS/$name-$stamp.tgz"
    mkdir -p "$BACKUPS"
    tar -czf "$backup" -C "$DEST" --exclude=node_modules --exclude='*.bak*' --exclude='backup-*' $existing
  fi

  local pair from to owner synced
  for pair in $(parts "$name"); do
    from=${pair%%:*} to=${pair#*:}
    owner=$(stat -c '%U:%G' "$DEST/${to%%/*}" 2>/dev/null || echo root:root)
    mkdir -p "$DEST/$to"
    synced=$(put "$from" "$to" "$owner")
    if grep -q 'package-lock.json' <<<"$synced" || { [ -f "$DEST/$to/package-lock.json" ] && [ ! -d "$DEST/$to/node_modules" ]; }; then
      say "  installing packages in $to"
      rm -rf "$DEST/$to/node_modules.previous"
      [ -d "$DEST/$to/node_modules" ] && mv "$DEST/$to/node_modules" "$DEST/$to/node_modules.previous"
      (cd "$DEST/$to" && npm ci --omit=dev --no-audit --no-fund --loglevel=error) || { restore "$name" "$backup"; fail "$name: npm ci failed, so the previous version is back"; }
      chown -R "$owner" "$DEST/$to/node_modules"
    fi
  done

  local file
  while read -r file; do
    node --check "$file" || { restore "$name" "$backup"; fail "$name: $file doesn't parse, so the previous version is back"; }
  done < <(for pair in $(parts "$name"); do find "$DEST/${pair#*:}" -name node_modules -prune -o -name '*.mjs' -print; done)

  local unit reload=0 enable=()
  for unit in $(units_of "$name"); do
    if ! cmp -s "$unit" "$(unit_target "$unit")"; then
      install -D -m 644 "$unit" "$(unit_target "$unit")"
      reload=1
      grep -q '^\[Install\]' "$unit" && enable+=("$(basename "$unit")")
    fi
  done
  if [ "$reload" = 1 ] && [ "$RESTART" = 1 ]; then
    systemctl daemon-reload
    for unit in "${enable[@]}"; do
      systemctl enable --quiet "$unit"
      [[ $unit == *.timer ]] && systemctl start "$unit"
    done
  fi

  if [ "$RESTART" = 1 ] && [ "$name" != monitor ]; then
    local since
    since=$(date -u +%Y-%m-%dT%H:%M:%S)
    # The gateway takes the port as the old publisher leaves it, before the new one sends anything:
    # a network that can't pull a post's files fails that post for good.
    if [ "$name" = publisher ] && [ "$gateway_new" = 1 ]; then
      systemctl stop plan-video-publisher
      systemctl restart plan-video-gateway || true
      if ! gateway_answers; then
        journalctl -u plan-video-gateway --since "-2min" --no-pager | tail -20 >&2
        restore "$name" "$backup"
        fail "the gateway didn't start${backup:+, so the previous publisher is back}"
      fi
    fi
    systemctl restart "plan-video-$name"
    # A publisher networks can't pull files from through the gateway would fail posts, so that counts too.
    if ! healthy "$name" "$since" || { [ "$name" = publisher ] && [ "$gateway_new" = 1 ] && ! healthy gateway ""; }; then
      journalctl -u "plan-video-$name" --since "-2min" --no-pager | tail -20 >&2
      restore "$name" "$backup"
      fail "$name didn't come up healthy${backup:+, so the previous version is back}"
    fi
  fi
  for pair in $(parts "$name"); do rm -rf "$DEST/${pair#*:}/node_modules.previous"; done
  write_deployed "$name"
  say "  done${backup:+; previous version in $backup}"
  if [[ " ${NETWORKS[*]} " == *" $name "* ]] && [[ " ${names[*]} " != *" publisher "* ]] && [ -n "$(changes publisher)" ]; then
    say "  the publisher keeps its own copy of $name: deploy publisher too"
  fi
  return 0
}

# Asks the running publisher, not the files, so a retry finishes a run that was cut off at any point.
gateway_moved() {
  [ -f "$UNITS/plan-video-gateway.service" ] &&
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8794/api/publisher/health 2>/dev/null || true)" != 000 ]
}

gateway_answers() {
  local i
  for i in $(seq 1 15); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8798/api/publisher/health 2>/dev/null || true)" != 000 ] && return 0
    sleep 2
  done
  return 1
}

# The gateway's first time: ready to start before anything moves.
prepare_gateway() {
  local to=$DEST/plan-video-gateway unit file
  mkdir -p "$to"
  put gateway plan-video-gateway "$(stat -c '%U:%G' "$to")" >/dev/null
  for file in "$to"/*.mjs; do node --check "$file" || fail "gateway: $file doesn't parse, so nothing was moved"; done
  for unit in $(units_of gateway); do install -D -m 644 "$unit" "$(unit_target "$unit")"; done
  systemctl daemon-reload
  systemctl enable --quiet plan-video-gateway.service
}

# The password between the publisher and its gateway, and the gateway's user. Nothing to do once they exist.
gateway_ready() {
  local own=$ENV_DIR/publisher.env gate=$ENV_DIR/gateway.env secret
  [ -f "$own" ] || fail "write $own first"
  id planvideo-gateway >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin --user-group planvideo-gateway
  secret=$(sed -n 's/^SENDER_SECRET=//p' "$own" | tail -1)
  if [ -z "$secret" ]; then
    secret=$(openssl rand -hex 32)
    [ -z "$(tail -c1 "$own")" ] || echo >> "$own"
    printf 'SENDER_SECRET=%s\n' "$secret" >> "$own"
    secret_new=1
    say "added SENDER_SECRET to $own"
  fi
  if [ "$(cat "$gate" 2>/dev/null)" != "SENDER_SECRET=$secret" ]; then
    install -m 640 -o root -g planvideo-gateway /dev/null "$gate"
    printf 'SENDER_SECRET=%s\n' "$secret" > "$gate"
    secret_new=1
    say "wrote $gate"
  fi
}

write_deployed() {
  local dir="$DEST/plan-video-$1"
  [ -d "$dir" ] || return 0
  printf '%s %s\n' "$(git -C "$REPO" rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/DEPLOYED"
}

status() {
  local name head
  head=$(git -C "$REPO" rev-parse --short HEAD)
  say "checkout at $head"
  for name in "${ORDER[@]}"; do
    local at differs
    at=$(cut -c1-7 "$DEST/plan-video-$name/DEPLOYED" 2>/dev/null || echo "-------")
    differs=$(changes "$name" | wc -l)
    if [ "$differs" = 0 ]; then say "$name: $at, same as the checkout"; else say "$name: $at, $differs file(s) differ"; fi
  done
}

[ $# -gt 0 ] || { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[ "$1" = status ] && { status; exit 0; }

dry=0
[ "$1" = --dry-run ] && { dry=1; shift; }
[ $# -gt 0 ] || fail "name a service, or all"
[ "$(id -u)" = 0 ] || [ "$dry" = 1 ] || [ -n "${DEPLOY_ROOT:-}" ] || fail "run as root"
[ -z "$(git -C "$REPO" status --porcelain)" ] || [ "$dry" = 1 ] || fail "the checkout has changes; deploy from a clean clone"

names=()
if [ "$1" = all ]; then names=("${ORDER[@]}"); else
  for name in "$@"; do [[ " ${ORDER[*]} " == *" $name "* ]] || fail "no service called $name"; done
  # The first time, the two move together: the gateway takes the port the publisher has had.
  if ! gateway_moved && [[ " $* " == *" publisher "* || " $* " == *" gateway "* ]]; then set -- "$@" publisher gateway; fi
  # The publisher and then its gateway go last, whatever order they were named in.
  for name in "${ORDER[@]}"; do [[ " $* " == *" $name "* ]] && names+=("$name"); done
fi
gateway_new=0
gateway_named=0
secret_new=0
if [ "$dry" = 0 ] && [ "$RESTART" = 1 ] && [[ " ${names[*]} " == *" publisher "* || " ${names[*]} " == *" gateway "* ]]; then
  gateway_named=1
  gateway_ready
  if ! gateway_moved; then
    gateway_new=1
    prepare_gateway
  fi
fi
for name in "${names[@]}"; do deploy "$name" "$dry"; done
if [ "$gateway_named" = 1 ]; then
  # Each read it when it started, so they'd no longer know each other. The first switch has started both already.
  if [ "$secret_new" = 1 ] && [ "$gateway_new" = 0 ]; then
    systemctl restart plan-video-publisher
    systemctl restart plan-video-gateway
  fi
  systemctl is-active --quiet plan-video-gateway || systemctl start plan-video-gateway || true
  healthy gateway "" || fail "the gateway doesn't reach the publisher. Check SENDER_SECRET in publisher.env and gateway.env, and journalctl -u plan-video-gateway"
  [ "$gateway_new" = 0 ] || say "gateway: now takes the publisher's traffic"
fi
