import { generateText, experimental_createMCPClient, type CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AI_PROVIDER,
  AI_MODEL,
  AI_BASE_URL,
  AI_API_KEY,
  DB_PATH,
  GROCY_URL,
  GROCY_API_KEY,
  HOUSEHOLD_NAME,
  CONTEXT_FILE,
  SESSIONS_DIR,
  MAX_HISTORY_MESSAGES,
  MAX_STEPS,
} from './config.js';
import { logger } from './logger.js';

export interface AgentRequest {
  message: string;
  sessionKey: string;
  sender: string;
  senderName?: string;
}

type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

let allMcpTools: Record<string, unknown> = {};
const mcpClients: MCPClient[] = [];

function getModel() {
  if (AI_PROVIDER === 'anthropic') {
    const anthropic = createAnthropic({ apiKey: AI_API_KEY });
    return anthropic(AI_MODEL);
  }

  const openai = createOpenAI({ apiKey: AI_API_KEY, baseURL: AI_BASE_URL });
  return openai(AI_MODEL);
}

async function spawnMcpServer(
  command: string,
  args: string[],
  env: Record<string, string>,
  label: string,
): Promise<MCPClient | null> {
  try {
    const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;
    const transport = new StdioClientTransport({ command, args, env: { ...baseEnv, ...env } });
    const client = await experimental_createMCPClient({ transport });
    logger.info({ label }, 'MCP server started');
    return client;
  } catch (err) {
    logger.warn({ label, err }, 'Failed to start MCP server — skipping');
    return null;
  }
}

export async function initAgent(): Promise<void> {
  // grocy-mcp: shopping, pantry, and meal plan via Grocy REST API
  const grocyClient = await spawnMcpServer(
    'node',
    [new URL('../../node_modules/@asachs01/grocy-mcp/dist/index.js', import.meta.url).pathname],
    { GROCY_URL, GROCY_API_KEY },
    'grocy-mcp',
  );

  // chores MCP: local SQLite (Grocy has no chore tracking equivalent)
  const choresClient = await spawnMcpServer(
    'node',
    [new URL('../../dist/mcp/chores.js', import.meta.url).pathname],
    { DB_PATH },
    'chores-mcp',
  );

  // grocy-mcp uses a navigation model: tool list changes per domain.
  // Spawn one client per domain so each stays permanently in its domain state.
  // This avoids navigation state conflicts when the model calls domain tools.
  if (grocyClient) {
    await grocyClient.close?.();  // close the initial client we don't need

    const GROCY_DOMAINS = ['shopping', 'pantry', 'meal-plan'] as const;
    const grocyEnv = { GROCY_URL, GROCY_API_KEY };
    const grocyArgs = [new URL('../../node_modules/@asachs01/grocy-mcp/dist/index.js', import.meta.url).pathname];

    for (const domain of GROCY_DOMAINS) {
      const domainClient = await spawnMcpServer('node', grocyArgs, grocyEnv, `grocy-mcp:${domain}`);
      if (!domainClient) continue;
      mcpClients.push(domainClient);
      try {
        const navTools = await domainClient.tools();
        if (navTools.grocy_navigate) {
          await (navTools.grocy_navigate as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> })
            .execute({ domain }, { toolCallId: `init-${domain}`, messages: [], abortSignal: new AbortController().signal });
        }
        const domainTools = await domainClient.tools();
        const { grocy_back: _back, ...toolsToExpose } = domainTools;
        allMcpTools = { ...allMcpTools, ...toolsToExpose };
        logger.info({ domain, toolCount: Object.keys(toolsToExpose).length }, 'Loaded grocy-mcp domain');
      } catch (err) {
        logger.warn({ domain, err }, 'Failed to load grocy-mcp domain tools');
      }
    }
  }

  for (const client of [choresClient]) {
    if (!client) continue;
    mcpClients.push(client);
    try {
      const tools = await client.tools();
      allMcpTools = { ...allMcpTools, ...tools };
      logger.info({ toolCount: Object.keys(tools).length }, 'Loaded MCP tools');
    } catch (err) {
      logger.warn({ err }, 'Failed to load tools from MCP server');
    }
  }

  logger.info({ totalTools: Object.keys(allMcpTools).length }, 'Agent initialized');

  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function loadSession(sessionKey: string): CoreMessage[] {
  const sessionFile = join(SESSIONS_DIR, `${sessionKey}.json`);
  if (!existsSync(sessionFile)) return [];

  try {
    const raw = readFileSync(sessionFile, 'utf-8');
    return JSON.parse(raw) as CoreMessage[];
  } catch {
    return [];
  }
}

function saveSession(sessionKey: string, messages: CoreMessage[]): void {
  const sessionFile = join(SESSIONS_DIR, `${sessionKey}.json`);
  try {
    writeFileSync(sessionFile, JSON.stringify(messages, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ sessionKey, err }, 'Failed to save session');
  }
}

function buildSystemPrompt(): string {
  const lines: string[] = [
    `You are the household assistant for ${HOUSEHOLD_NAME}.`,
    'You help household members manage their home in a friendly, concise, and practical way.',
    '',
    'You can help with:',
    '- Groceries: manage shopping lists, add/remove items, mark items as bought',
    '- Meal planning: plan meals for the week, view the meal schedule',
    '- Recipes: look up recipes, add new ones, find what to cook based on ingredients',
    '- Chores: track household tasks, assign chores, mark them done, set due dates',
    '',
    'Keep responses short and actionable. When managing data, confirm what you did.',
    'If a request is ambiguous, ask a short clarifying question.',
  ];

  if (existsSync(CONTEXT_FILE)) {
    try {
      const context = readFileSync(CONTEXT_FILE, 'utf-8').trim();
      if (context) {
        lines.push('', '--- Household context ---', context);
      }
    } catch {
      // context file is optional; skip silently
    }
  }

  return lines.join('\n');
}

export async function runTurn(req: AgentRequest): Promise<string> {
  const { message, sessionKey, sender, senderName } = req;

  const history = loadSession(sessionKey);

  const userContent = senderName
    ? `[${senderName}]: ${message}`
    : message;

  const messages: CoreMessage[] = [
    ...history,
    { role: 'user', content: userContent },
  ];

  const systemPrompt = buildSystemPrompt();
  const model = getModel();

  logger.debug({ sessionKey, sender, messageLength: message.length }, 'Running agent turn');

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    tools: allMcpTools as Parameters<typeof generateText>[0]['tools'],
    maxSteps: MAX_STEPS,
  });

  const updatedHistory: CoreMessage[] = [
    ...messages,
    ...result.response.messages,
  ];

  const trimmed =
    updatedHistory.length > MAX_HISTORY_MESSAGES
      ? updatedHistory.slice(updatedHistory.length - MAX_HISTORY_MESSAGES)
      : updatedHistory;

  saveSession(sessionKey, trimmed);

  logger.debug({ sessionKey, steps: result.steps?.length ?? 0 }, 'Agent turn complete');

  return result.text;
}
