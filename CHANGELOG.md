# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (M1)
- Replaced custom grocery/meal/recipe MCP servers with `@asachs01/grocy-mcp` backed by real Grocy instance
- Added `GROCY_URL` and `GROCY_API_KEY` config exports
- `spawnMcpServer` helper now takes explicit `command/args/env/label` for clean multi-server init
- TypeScript fix: filter `process.env` undefined values before spreading into `StdioClientTransport`

### Validated (M1)
- grocy-mcp loads via stdio MCP, navigation model works (2 root tools → domain tools on `grocy_navigate`)
- 4-step agent loop: navigate → get list → back → respond confirmed on virt06 with qwen2.5:3b
- Grocy API (192.168.156.246:9283) reachable from virt06 and responding correctly
- **Known limitation**: qwen2.5:3b hallucinates data on multi-hop tool tasks; qwen2.5:7b+ required for production-quality responses

## [0.1.0] - 2026-03-16

### Added
- Initial project scaffold: `package.json`, `tsconfig.json`
- `src/config.ts` - environment-variable-driven configuration with typed exports
- `src/logger.ts` - pino logger with pino-pretty in development, JSON in production
- `src/db.ts` - better-sqlite3 database initialization with full schema and WAL mode
- `mcp/db.ts` - shared database helper for MCP server subprocesses
- `.env.example` - documented environment variable template
- `CONTEXT.md.template` - per-household agent context template
- `CHANGELOG.md` - this file

### Added
- Agent loop using Vercel AI SDK `generateText` with tool use and session persistence
- WhatsApp channel integration via `@whiskeysockets/baileys`
- Telegram channel integration via Telegraf
- Discord channel integration via discord.js
- Four domain MCP servers: grocery, meal, recipe, chores (all with Zod-typed tool schemas)
- Docker Compose deployment configuration with Ollama + LiteLLM
- Background scheduler for recurring chore reminders
- Household member management and context file support
- Native deployment support (nvm + pip install for non-Docker environments)

### Validated (M0)
- Vercel AI SDK + Ollama + LiteLLM end-to-end tool calling confirmed working on virt06.sachshaus.net
- `qwen2.5:3b` model: tool invocation, multi-step agent loop, OpenAI-compatible API path all functional
- Direct Ollama path (`localhost:11434/v1`) and LiteLLM proxy path (`localhost:4000/v1`) both operational
- Conversation history persisted to SQLite

[Unreleased]: https://github.com/yourusername/homeclaw/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/homeclaw/releases/tag/v0.1.0
