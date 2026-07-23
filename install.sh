#!/usr/bin/env bash
#
# MemoriWA one-line installer
#
#   Interactive:
#     curl -fsSL https://raw.githubusercontent.com/KaryaPutraS/memoriwa/main/install.sh | bash
#
#   Non-interactive:
#     curl -fsSL ... | bash -s -- --domain dash.example.com -y
#
#   Update to the latest version:
#     run the same command again — .env, WhatsApp session and data are kept.
#
set -euo pipefail

REPO="KaryaPutraS/memoriwa"
BRANCH="main"
TARBALL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"

INSTALL_DIR="$HOME/memoriwa"
DOMAIN=""
WEB_PORT="80"
PORT_SET=0
ADMIN_PASSWORD=""
ASSUME_YES=0

log()  { printf '\033[1;36m[memoriwa]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[memoriwa]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[memoriwa] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() { cat <<EOF
MemoriWA installer

  bash install.sh [options]

Options:
  --domain DOMAIN   Public domain or IP of this server (e.g. dash.example.com or 203.0.113.10)
  --port PORT       Host port for the dashboard (default: 80)
  --dir PATH        Install directory (default: ~/memoriwa)
  --password PASS   Admin password (default: random — shown once at the end)
  -y, --yes         Non-interactive: accept defaults, skip all prompts
  -h, --help        Show this help

Re-running the script updates an existing installation; your .env,
WhatsApp session and document data are preserved.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)   DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --port)     WEB_PORT="${2:?--port needs a value}"; PORT_SET=1; shift 2 ;;
    --dir)      INSTALL_DIR="${2:?--dir needs a value}"; shift 2 ;;
    --password) ADMIN_PASSWORD="${2:?--password needs a value}"; shift 2 ;;
    -y|--yes)   ASSUME_YES=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

# Prompt helpers read from /dev/tty so they also work through `curl | bash`.
ask() {
  local __var="$1" __prompt="$2" __default="$3" __reply=""
  if [ "$ASSUME_YES" = "1" ]; then printf -v "$__var" '%s' "$__default"; return; fi
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '%s [%s]: ' "$__prompt" "$__default" > /dev/tty
    read -r __reply < /dev/tty || true
    printf -v "$__var" '%s' "${__reply:-$__default}"
  else
    printf -v "$__var" '%s' "$__default"
  fi
}

ask_yesno() {
  local __prompt="$1" __reply=""
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '%s [Y/n]: ' "$__prompt" > /dev/tty
    read -r __reply < /dev/tty || true
    case "${__reply:-y}" in [Yy]*) return 0 ;; *) return 1 ;; esac
  fi
  return 0
}

rand_hex() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# --- 1. Docker ---------------------------------------------------------------
docker_ok() { command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; }

if ! docker_ok; then
  warn "Docker (with the compose plugin) was not found."
  if ask_yesno "Install Docker now via https://get.docker.com ?"; then
    curl -fsSL https://get.docker.com | sh
    docker_ok || die "Docker installation failed — install it manually and re-run."
  else
    die "Docker is required: https://docs.docker.com/engine/install/"
  fi
fi
docker info >/dev/null 2>&1 || die "Docker daemon is not running (or re-run as root/sudo)."

# --- 2. Source code ----------------------------------------------------------
UPDATE=0
[ -f "$INSTALL_DIR/.env" ] && UPDATE=1
mkdir -p "$INSTALL_DIR"

if command -v git >/dev/null 2>&1; then
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Updating source code (git pull)…"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
  else
    log "Cloning $REPO…"
    _tmp="$(mktemp -d)"
    git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$_tmp/repo"
    cp -a "$_tmp/repo/." "$INSTALL_DIR/"
    rm -rf "$_tmp"
  fi
else
  log "Downloading source tarball…"
  _tmp="$(mktemp -d)"
  curl -fsSL "$TARBALL" | tar -xz --strip-components=1 -C "$_tmp"
  cp -a "$_tmp/." "$INSTALL_DIR/"
  rm -rf "$_tmp"
fi
cd "$INSTALL_DIR"

# --- 3. Configuration --------------------------------------------------------
if [ "$UPDATE" = "1" ]; then
  log "Existing installation found — keeping your .env and data (update mode)."
  set -a; . ./.env; set +a
  # explicit flags may still override the public URL / port
  if [ -n "$DOMAIN" ]; then
    case "$DOMAIN" in http://*|https://*) PUBLIC_URL="$DOMAIN" ;; *) PUBLIC_URL="http://$DOMAIN" ;; esac
    sed -i.bak "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" .env && rm -f .env.bak
  fi
  if [ "$PORT_SET" = "1" ]; then
    sed -i.bak "s|^WEB_PORT=.*|WEB_PORT=$WEB_PORT|" .env && rm -f .env.bak
  fi
  # Display-only: never overwrite the real ADMIN_PASSWORD sourced from .env,
  # or docker compose would inject this text into the api container instead
  # (shell env beats --env-file during compose variable substitution).
  DISPLAY_PW="(unchanged — see $INSTALL_DIR/.env)"
else
  if [ -z "$DOMAIN" ]; then
    _detected="$(curl -fs --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
    ask DOMAIN "Public domain or IP of this server" "${_detected:-localhost}"
  fi
  [ -n "$DOMAIN" ] || die "A public domain or IP is required."
  case "$DOMAIN" in http://*|https://*) PUBLIC_URL="$DOMAIN" ;; *) PUBLIC_URL="http://$DOMAIN" ;; esac

  ADMIN_USERNAME="admin"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(rand_hex 9)}"
  JWT_SECRET="$(rand_hex 32)"
  WEBHOOK_SECRET="$(rand_hex 16)"
  WAHA_API_KEY="$(rand_hex 16)"

  cat > .env <<EOF
# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
PUBLIC_URL=$PUBLIC_URL
WEB_PORT=$WEB_PORT
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
JWT_SECRET=$JWT_SECRET
WEBHOOK_SECRET=$WEBHOOK_SECRET
WAHA_API_KEY=$WAHA_API_KEY
# Optional fallback AI key (can also be configured later in the dashboard)
GROQ_API_KEY=
EOF
  chmod 600 .env
  log "Configuration written to $INSTALL_DIR/.env"
fi

# --- 4. Build & launch -------------------------------------------------------
log "Building and starting containers (first run can take a few minutes)…"
docker compose --env-file .env pull waha 2>/dev/null || true
docker compose --env-file .env up -d --build

# --- 5. Wait for health ------------------------------------------------------
log "Waiting for the dashboard…"
_up=0
for _ in $(seq 1 40); do
  if curl -fs --max-time 3 "http://127.0.0.1:$WEB_PORT/health" >/dev/null 2>&1; then _up=1; break; fi
  sleep 3
done
[ "$_up" = "1" ] || warn "Health check timed out — inspect with: docker compose -C '$INSTALL_DIR' logs -f"

# --- 6. Summary --------------------------------------------------------------
cat <<EOF

  ✅  MemoriWA installed!

  Dashboard : $PUBLIC_URL   (locally: http://127.0.0.1:$WEB_PORT)
  Username  : ${ADMIN_USERNAME:-admin}
  Password  : ${DISPLAY_PW:-$ADMIN_PASSWORD}

  Next step: open the dashboard → Settings → Connect, and scan the QR code
  with the WhatsApp number that will receive documents.

  Manage:
    cd $INSTALL_DIR
    docker compose logs -f     # follow logs
    docker compose down        # stop
    docker compose up -d       # start

  Update: re-run this installer — it pulls the latest version and rebuilds,
  keeping your login, WhatsApp session and documents.
EOF
