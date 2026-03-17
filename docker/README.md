# HomeClaw — Docker Deployment

## Quick Start (local home server)

```bash
git clone https://github.com/youruser/homeclaw.git && cd homeclaw
cp .env.example .env   # edit .env — at minimum set AI_API_KEY, GROCY_API_KEY, and a channel token
docker compose --profile with-grocy up -d
```

Grocy is available at `http://localhost:9283`.
On first run, create a Grocy API key (Grocy → Manage API Keys) and add it to `.env` as `GROCY_API_KEY`, then restart the `homeclaw` service.

---

## DigitalOcean Droplet Deploy

1. Create a **$6/mo Ubuntu 24.04** Droplet in the DigitalOcean console.
2. SSH in and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Clone the repo and configure:
   ```bash
   git clone https://github.com/youruser/homeclaw.git && cd homeclaw
   cp .env.example .env && nano .env
   ```
4. Start everything:
   ```bash
   docker compose --profile with-grocy up -d
   ```

---

## Bring Your Own Grocy

If you already run Grocy elsewhere, skip the `with-grocy` profile and point HomeClaw at your instance:

```ini
# .env
GROCY_URL=https://grocy.yourdomain.com
GROCY_API_KEY=your-existing-key
```

```bash
docker compose up -d   # no --profile with-grocy
```

---

## Cloudflare Tunnel (remote access without opening ports)

1. Create a tunnel at [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → Networks → Tunnels.
2. Copy the tunnel token into `.env`:
   ```ini
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoixx...
   ```
3. Add `--profile tunnel` to your compose command:
   ```bash
   docker compose --profile with-grocy --profile tunnel up -d
   ```

---

## Telegram Bot Token

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot` and follow the prompts to name your bot.
3. Copy the token into `.env` as `TELEGRAM_BOT_TOKEN` and set `TELEGRAM_ENABLED=true`.
4. Add the bot to your household group or start a direct chat with it.

---

## Profiles Reference

| Profile | What it adds |
|---------|-------------|
| `with-grocy` | Bundled Grocy container (port 9283) |
| `tunnel` | Cloudflare Tunnel sidecar |
