#!/usr/bin/env bash
# Bootstrap the reader on a fresh Ubuntu Server host: Docker, repo, data, stack.
# Idempotent: safe to re-run. Expects .env and (optionally) reader-data.tgz
# sitting next to it.
set -euo pipefail

REPO_URL="https://github.com/horizonfps/horizonreader.git"
APP_DIR="${APP_DIR:-/srv/docker/horizonreader}"
BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "rode com sudo: sudo bash $0"

say "Pacotes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates sqlite3 openssh-server

say "Docker Engine"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "ja instalado: $(docker --version)"
fi
systemctl enable --now docker
[ -n "${SUDO_USER:-}" ] && usermod -aG docker "$SUDO_USER" || true

# A laptop server must not sleep when the lid closes.
say "Tampa fechada nao suspende"
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/99-server.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchDocked=ignore
HandleLidSwitchExternalPower=ignore
EOF
systemctl restart systemd-logind || true

say "Codigo em $APP_DIR"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

say "Configuracao"
[ -f "$BUNDLE/.env" ] || die "faltou o .env ao lado deste script"
cp "$BUNDLE/.env" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

if [ -f "$BUNDLE/reader-data.tgz" ]; then
  say "Importando dados de producao"
  mkdir -p "$APP_DIR/data"
  if [ -s "$APP_DIR/data/app.db" ]; then
    cp "$APP_DIR/data/app.db" "$APP_DIR/data/app.db.bak.$(date +%Y%m%d-%H%M%S)"
  fi
  tar xzf "$BUNDLE/reader-data.tgz" -C "$APP_DIR/data"
  sqlite3 "$APP_DIR/data/app.db" 'PRAGMA integrity_check;' | grep -qx ok \
    || die "banco importado corrompido"
  echo "usuarios importados: $(sqlite3 "$APP_DIR/data/app.db" 'SELECT COUNT(*) FROM User;')"
else
  echo "sem reader-data.tgz: subindo com banco vazio"
fi

# The image runs as uid 1000, but Docker creates missing bind mounts as root,
# which leaves the server crash-looping on a config it cannot write.
say "Volumes do Suwayomi"
mkdir -p "$APP_DIR/suwayomi/data" "$APP_DIR/suwayomi/downloads"
chown -R 1000:1000 "$APP_DIR/suwayomi"

say "Subindo a stack"
cd "$APP_DIR"
docker compose up -d --build --remove-orphans

say "Aguardando o app responder"
port="$(grep -E '^WEB_PORT=' .env | cut -d= -f2 | tr -d '[:space:]')"
port="${port:-3000}"
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:$port"; then
    echo "app no ar em http://127.0.0.1:$port"
    break
  fi
  sleep 5
done

say "Instalando as fontes do Suwayomi (demora)"
docker compose exec -T web npm run sync-extensions || \
  echo "sync-extensions falhou; rode de novo depois: docker compose exec web npm run sync-extensions"

say "Pronto"
cat <<EOF

  app        http://$(hostname -I | awk '{print $1}'):$port
  suwayomi   http://127.0.0.1:4567 (so local)
  status     cd $APP_DIR && docker compose ps

  Falta expor pela internet: cloudflared tunnel (ver DEPLOY.md).
EOF
