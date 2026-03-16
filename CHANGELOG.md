# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project scaffold: `package.json`, `tsconfig.json`
- `src/config.ts` - environment-variable-driven configuration with typed exports
- `src/logger.ts` - pino logger with pino-pretty in development, JSON in production
- `src/db.ts` - better-sqlite3 database initialization with full schema and WAL mode
- `mcp/db.ts` - shared database helper for MCP server subprocesses
- `.env.example` - documented environment variable template
- `CONTEXT.md.template` - per-household agent context template
- `CHANGELOG.md` - this file

## [0.1.0] - Planned

### Added
- Agent loop using Vercel AI SDK `generateText` with tool use
- WhatsApp channel integration via `@whiskeysockets/baileys`
- Telegram channel integration via Telegraf
- Discord channel integration via discord.js
- Four domain MCP servers: grocery, meal, recipe, chores
- Docker Compose deployment configuration with Ollama + LiteLLM
- Background scheduler for recurring chore reminders and meal planning prompts
- Household member management
- Conversation history persisted to SQLite

[Unreleased]: https://github.com/yourusername/homeclaw/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/homeclaw/releases/tag/v0.1.0
