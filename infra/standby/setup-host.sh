#!/usr/bin/env bash
set -euo pipefail

# Run as root on a fresh Ubuntu/Debian VM.
# This prepares the host; application secrets are intentionally NOT handled here.

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo -i)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git ufw

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker

install -d -m 0750 /opt/sonalit-standby
chown root:root /opt/sonalit-standby

# SSH is required for GitHub Actions deployment; HTTP remains localhost-only in compose.
ufw allow OpenSSH || true
ufw --force enable

echo
 echo "Host prepared. Next steps:"
 echo "  1. Put docker-compose.yml, docker-compose.active.yml and .env in /opt/sonalit-standby"
 echo "  2. Authenticate Docker to GHCR"
 echo "  3. Start with SONALIT_STANDBY=true"
 echo "  4. Add GitHub Actions secrets for automatic deployments"
