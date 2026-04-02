#!/bin/bash
# ICT Paper Trader — VPS Deploy Script
# Run on a fresh Ubuntu/Debian VPS as root
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/ShrPaw/ict-footprint-paper-trader/main/deploy.sh | bash
#   OR
#   bash deploy.sh

set -e

echo "╔══════════════════════════════════════════╗"
echo "║   🚀 ICT Paper Trader — Deploy           ║"
echo "╚══════════════════════════════════════════╝"

# 1. Install Node.js 22
echo ""
echo "📦 Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 2. Install PM2
echo ""
echo "📦 Installing PM2..."
npm install -g pm2

# 3. Clone repo
echo ""
echo "📥 Cloning repo..."
cd /opt

# Support private repo: check for GITHUB_TOKEN env var
if [ -n "$GITHUB_TOKEN" ]; then
  REPO_URL="https://${GITHUB_TOKEN}@github.com/ShrPaw/ict-footprint-paper-trader.git"
  echo "   (using GITHUB_TOKEN for private repo)"
else
  REPO_URL="https://github.com/ShrPaw/ict-footprint-paper-trader.git"
  echo "   (no GITHUB_TOKEN set — will fail if repo is private)"
  echo "   Set GITHUB_TOKEN before running: export GITHUB_TOKEN=ghp_xxx"
fi

if [ -d "ict-footprint-paper-trader" ]; then
  cd ict-footprint-paper-trader
  git pull
else
  git clone "$REPO_URL"
  cd ict-footprint-paper-trader
fi

# Clean token from git remote URL (security)
if [ -n "$GITHUB_TOKEN" ]; then
  git remote set-url origin https://github.com/ShrPaw/ict-footprint-paper-trader.git
fi

# 4. Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# 5. Setup .env if not exists
if [ ! -f .env ]; then
  echo ""
  echo "⚙️  Creating .env from template..."
  cp .env.example .env
  echo ""
  echo "⚠️  EDIT .env with your Telegram credentials:"
  echo "   nano /opt/ict-footprint-paper-trader/.env"
  echo ""
fi

# 6. Start with PM2
echo ""
echo "🚀 Starting bots..."
pm2 start ecosystem.config.cjs
pm2 save

# 7. Setup PM2 startup on boot
pm2 startup systemd -u root --hp /root
pm2 save

# 8. Open firewall for dashboard
echo ""
echo "🔥 Opening firewall for dashboard (port 3500)..."
if command -v ufw &> /dev/null; then
  ufw allow 3500/tcp
  ufw --force enable
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅ DEPLOYED                             ║"
echo "╠══════════════════════════════════════════╣"
echo "║                                          ║"
echo "║   Dashboard: http://YOUR-IP:3500         ║"
echo "║                                          ║"
echo "║   Commands:                              ║"
echo "║   pm2 logs          — live logs          ║"
echo "║   pm2 monit         — terminal dashboard ║"
echo "║   pm2 restart all   — restart all bots   ║"
echo "║   pm2 stop all      — stop all           ║"
echo "║                                          ║"
echo "║   ⚠️  Edit .env with Telegram creds:     ║"
echo "║   nano /opt/ict-footprint-paper-trader/.env║"
echo "║                                          ║"
echo "╚══════════════════════════════════════════╝"
