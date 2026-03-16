# HomeClaw Project Context

## Architecture
- TypeScript/Node.js agent using Vercel AI SDK (`generateText` + MCP tools)
- Channels: WhatsApp (Baileys), Telegram (Telegraf), Discord (discord.js)
- MCP servers: grocy-mcp (3 per-domain clients), chores-mcp (SQLite)
- Inference: Ollama via LiteLLM proxy on virt06.sachshaus.net

## Deployment
- Runtime: virt06.sachshaus.net (Proxmox VM, Ubuntu, Node via nvm)
- Grocy: VM 103 at 192.168.156.246:9283 (on virt05)
- Model: qwen2.5:7b via LiteLLM at localhost:4000/v1
- .env at ~/homeclaw/.env on virt06 (never committed)
- Deploy: `npm run build` locally → rsync to ~/homeclaw/ (exclude node_modules/.env)

## Learnings - 2026-03-16

### grocy-mcp navigation model requires per-domain MCP clients
grocy-mcp uses a decision-tree navigation model: initially exposes only
`grocy_navigate` + `grocy_status`. After calling `grocy_navigate(domain)`,
the server switches state and exposes that domain's tools. Tool calls for
a domain only work when the server is in that domain's state.
**Fix**: Spawn one `experimental_createMCPClient` instance per domain
(shopping/pantry/meal-plan), each permanently navigated to its domain.
`client.tools()` is dynamic and refreshes after navigation.

### qwen3.5:9b thinking mode broken with tools on Ollama 0.18.0
Ollama 0.18.0's `/v1/chat/completions` endpoint ignores `options.think=false`
when `tools` are present in the request. The model generates reasoning tokens
but returns empty `content` and no `tool_calls`. Works fine via `/api/chat`
(native Ollama format) with `think: false`. **Workaround**: use qwen2.5:7b
for tool calling until Ollama fixes this. Track for upgrade.

### Vercel AI SDK allMcpTools must be dynamic for navigation-based servers
`experimental_createMCPClient.tools()` is a live call — it returns different
tools based on server state. But `allMcpTools` in agent.ts is built once at
init. If you cache nav tools only, domain tools never appear. Per-domain
clients solve this by locking each client's state at init time.

### Grocy API keys need specific expiry in SQLite
When inserting API keys directly into grocy.db, use
`expires = '2099-12-31 23:59:59'` — Grocy's `IsValidApiKey()` rejects keys
with NULL or past expiry even if the key string matches.

### LiteLLM extra_body does not forward Ollama options for tool calls
`extra_body: { options: { think: false } }` in litellm.config.yaml does not
reliably forward to Ollama when the request includes `tools`. Use model-level
approach (qwen2.5 instead of qwen3.5) or wait for Ollama fix.
