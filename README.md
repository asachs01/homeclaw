# HomeClaw

<p align="center">
  <img src="branding/nisse-icon.png" alt="Nisse — HomeClaw's household guardian" width="180" />
</p>

**HomeClaw puts a Nisse in your kitchen.**

In Scandinavian folklore, a *nisse* (or *tomte*) is a small household spirit — ancient, devoted, and quietly competent. He lives in the home. He watches over the pantry. He makes sure the family doesn't run out of things. He has been doing this for a very long time, and he takes it personally.

HomeClaw's Nisse does the same thing, over Telegram.

> *"You've got chicken thawing and half a bag of rice. Want me to find something for tonight?"*

He knows your pantry. He knows your recipes. He tracks what's expiring, builds the shopping list, and manages the week's meal plan — without being asked twice. Warm, plain-spoken, and completely devoted to the household he belongs to.

Each family gets their own Nisse. Same spirit, different name — chosen by the family during their first conversation with him.

See [NISSE.md](NISSE.md) for the full character brief.

## Features

- **Pantry & stock** — check what's in stock, consume items, view expiry dates
- **Shopping list** — add, tick off, and manage items
- **Recipes** — list recipes, import from a URL (with auto-created products), add missing ingredients to the shopping list
- **Meal plan** — view and manage this week's plan
- **Chores** — track and schedule household chores
- **Web browsing** — can fetch URLs to find recipes, check nutrition info, etc.
- **Multi-channel** — Telegram (default), WhatsApp, Discord

---

## Quick Start (Docker — bundled Grocy)

```bash
git clone https://github.com/your-org/homeclaw.git
cd homeclaw

cp .env.example .env
# Edit .env — set TELEGRAM_BOT_TOKEN, AI_API_KEY, GROCY_API_KEY at minimum
$EDITOR .env

docker compose --profile with-grocy up -d
```

The first time Grocy starts, visit `http://localhost:9283` to finish setup and create an API key, then add it to `.env` as `GROCY_API_KEY` and restart:

```bash
docker compose --profile with-grocy restart homeclaw
```

---

## Bring Your Own Grocy

Already running Grocy? Just set `GROCY_URL` in `.env` and skip the `with-grocy` profile:

```bash
GROCY_URL=https://grocy.yourdomain.com
GROCY_API_KEY=your-api-key
```

```bash
docker compose up -d
```

---

## Telegram Setup

1. Message [@BotFather](https://t.me/botfather) on Telegram, run `/newbot`, and copy the token
2. Set `TELEGRAM_ENABLED=true` and `TELEGRAM_BOT_TOKEN=<token>` in `.env`
3. Add the bot to your household group or just DM it
4. (Optional) Restrict to specific chat IDs: `TELEGRAM_CHAT_IDS=123456789,987654321`

In groups, the bot only responds when a message contains the trigger word (default `@home`). In private chat it responds to everything.

Commands available in the bot menu:

| Command | Description |
|---------|-------------|
| `/start` or `/help` | Show help and examples |
| `/status` | Check Grocy connection status |
| `/setup` | Re-run household onboarding |
| `/history` | Clear conversation history |

---

## AI Provider

HomeClaw works with any OpenAI-compatible inference endpoint. The default is [OpenRouter](https://openrouter.ai) (easy, cloud, many models):

```env
AI_PROVIDER=openai
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=sk-or-v1-...
AI_MODEL=openai/gpt-4o-mini
```

For a fully local setup with [Ollama](https://ollama.ai):

```env
AI_BASE_URL=http://host.docker.internal:11434/v1
AI_API_KEY=ollama
AI_MODEL=qwen2.5:7b
```

---

## DigitalOcean Droplet Deploy

Spin up a $6/mo Ubuntu 24.04 droplet, then:

```bash
# On the droplet
apt update && apt install -y docker.io docker-compose-plugin
git clone https://github.com/your-org/homeclaw.git && cd homeclaw
cp .env.example .env && nano .env
docker compose --profile with-grocy up -d
```

---

## Cloudflare Tunnel (expose from home server)

Add `CLOUDFLARE_TUNNEL_TOKEN` to `.env` (create a tunnel at [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → Networks → Tunnels), then:

```bash
docker compose --profile with-grocy --profile tunnel up -d
```

The cloudflared sidecar starts automatically and routes traffic through your tunnel.

---

## Docker Compose Profiles

| Profile | What it adds |
|---------|-------------|
| *(none)* | HomeClaw only — point `GROCY_URL` at an existing Grocy |
| `with-grocy` | Bundled Grocy on port 9283 |
| `tunnel` | Cloudflare Tunnel sidecar |

Profiles can be combined:

```bash
docker compose --profile with-grocy --profile tunnel up -d
```

---

## Building from Source

Requires a GitHub PAT with `read:packages` scope (for `@asachs01/grocy-mcp`):

```bash
docker build --build-arg NODE_AUTH_TOKEN=ghp_... -t homeclaw -f docker/Dockerfile .
```

Or for local development (Node ≥ 20):

```bash
echo "@asachs01:registry=https://npm.pkg.github.com" >> .npmrc
echo "//npm.pkg.github.com/:_authToken=ghp_..." >> .npmrc
npm install
npm run dev
```

---

## Configuration

See [`.env.example`](.env.example) for all variables with descriptions.

---

## Pricing

HomeClaw has two variable costs: **hosting** and **AI inference**. For most families, the total is under $10/month.

### Hosting

| Option | RAM | Cost/mo | Notes |
|--------|-----|---------|-------|
| Home server | — | $0 | Any machine running Docker |
| DigitalOcean Basic | 1 GB | $6 | Minimum for HomeClaw + bundled Grocy |
| DigitalOcean Basic | 2 GB | $12 | Comfortable; recommended for heavy use |

### AI Inference (OpenRouter)

Token usage per conversation turn: ~5,650 input (system prompt + tool schemas + history) + ~400 output.

| Model | Input/1M | Output/1M | Light (~10 msg/day) | Moderate (~25/day) | Heavy (~75/day) |
|-------|----------|-----------|--------------------|--------------------|-----------------|
| `meta-llama/llama-3.1-8b-instruct` | $0.02 | $0.05 | ~$0.04 | ~$0.10 | ~$0.30 |
| `google/gemini-2.0-flash` | $0.10 | $0.40 | ~$0.22 | ~$0.54 | ~$1.63 |
| `openai/gpt-4o-mini` | $0.15 | $0.60 | ~$0.33 | ~$0.82 | ~$2.45 |
| `anthropic/claude-3-haiku` | $0.25 | $1.25 | ~$0.57 | ~$1.44 | ~$4.31 |

### Total Monthly (hosting + AI)

| Setup | Light use | Moderate use |
|-------|-----------|--------------|
| Home server + Llama 3.1 8B | **~$0.04** | **~$0.10** |
| Home server + GPT-4o-mini | **~$0.33** | **~$0.82** |
| DO $6 droplet + Llama 3.1 8B | **~$6.04** | **~$6.10** |
| DO $6 droplet + GPT-4o-mini | **~$6.33** | **~$6.82** |
| DO $12 droplet + GPT-4o-mini | **~$12.33** | **~$12.82** |

> **Tip:** Start with `openai/gpt-4o-mini` — it handles tool use reliably. Switch to Llama or Gemini Flash if you want to cut costs further once things are working.

---

## Architecture

```
HomeClaw (Node.js / TypeScript)
  ├── Channels: Telegram · WhatsApp · Discord
  ├── AI: Vercel AI SDK → any OpenAI-compatible endpoint
  └── MCP tools
        ├── grocy-mcp   (pantry, shopping, recipes, meal-plan, chores …)
        └── web_fetch   (built-in HTTP tool for browsing)
```
