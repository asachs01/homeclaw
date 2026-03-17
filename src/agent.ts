import { generateText, experimental_createMCPClient, type CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
  ASSISTANT_NAME_FILE,
  BOOTSTRAP_FILE,
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

  const openai = createOpenAI({
    apiKey: AI_API_KEY,
    baseURL: AI_BASE_URL,
    headers: {
      'HTTP-Referer': 'https://github.com/homeclaw',
      'X-Title': 'HomeClaw',
    },
  });
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

// OpenAI requires every key in `properties` to appear in `required`.
// Vercel AI SDK wraps MCP schemas via jsonSchema(), so the raw schema is at
// tool.parameters.jsonSchema — not tool.parameters directly.
function sanitizeToolSchemas(tools: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const t = tool as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (t?.parameters as any)?.jsonSchema as Record<string, unknown> | undefined;
    if (raw?.properties && typeof raw.properties === 'object') {
      const allKeys = Object.keys(raw.properties as object);
      const existing = Array.isArray(raw.required) ? (raw.required as string[]) : [];
      const required = Array.from(new Set([...existing, ...allKeys]));
      result[name] = {
        ...t,
        parameters: { ...(t.parameters as object), jsonSchema: { ...raw, required } },
      };
    } else {
      result[name] = tool;
    }
  }
  return result;
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

    const GROCY_DOMAINS = ['shopping', 'pantry', 'meal-plan', 'recipes', 'chores', 'tasks', 'products'] as const;
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

  // OpenAI requires all properties to be listed in `required`.
  // MCP servers often have optional properties not in `required`, so we normalize.
  allMcpTools = sanitizeToolSchemas(allMcpTools);

  logger.info({ totalTools: Object.keys(allMcpTools).length }, 'Agent initialized');

  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  // Pre-warm the model so the first real message responds quickly.
  // Fire-and-forget — don't block startup.
  warmModel();
}

function warmModel(): void {
  const model = getModel();
  generateText({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    maxSteps: 1,
  }).then(() => {
    logger.info('Model warm');
  }).catch(() => {
    logger.warn('Model warm failed — will load on first request');
  });
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

// --- Onboarding state machine ---
// Small LLMs can't reliably drive a multi-turn interview themselves.
// We ask scripted questions from code and only use the LLM at the end
// to compile answers into a household profile summary.

const ONBOARDING_QUESTIONS = [
  "Hi! I'm your new household assistant 🏠 First things first — what would you like to call me? Give me a name!",
  "Love it! And what's your name, and what should I call your home? (e.g. 'The Smith House')",
  "Nice to meet you! Who else lives there? Tell me about your household members — kids, a partner, anyone else.",
  "Thanks! Does anyone have dietary restrictions or strong food preferences I should know about? Any allergies, vegetarian/vegan, or picky eaters?",
  "Got it. Where does your family usually shop, and roughly how often do you do a big grocery run?",
  "Last one — what's the biggest household headache I can help you with? Keeping track of what's in the fridge? Meal planning? Shopping lists? All of the above?",
];

interface OnboardingState {
  question: number;  // index of next question to ask (0-4), or 5 when complete
  answers: string[];
}

function getOnboardingStatePath(): string {
  return join(SESSIONS_DIR, '_onboarding.json');
}

function loadOnboardingState(): OnboardingState | null {
  if (existsSync(CONTEXT_FILE)) return null;  // already onboarded
  if (!existsSync(BOOTSTRAP_FILE)) return null;  // no bootstrap = no onboarding
  const statePath = getOnboardingStatePath();
  if (!existsSync(statePath)) return { question: 0, answers: [] };
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8')) as OnboardingState;
  } catch {
    return { question: 0, answers: [] };
  }
}

function saveOnboardingState(state: OnboardingState): void {
  writeFileSync(getOnboardingStatePath(), JSON.stringify(state, null, 2), 'utf-8');
}

function clearOnboardingState(): void {
  const statePath = getOnboardingStatePath();
  if (existsSync(statePath)) {
    try { unlinkSync(statePath); } catch { /* ignore */ }
  }
}

function getAssistantName(): string {
  if (existsSync(ASSISTANT_NAME_FILE)) {
    try {
      return readFileSync(ASSISTANT_NAME_FILE, 'utf-8').trim() || 'your household assistant';
    } catch { /* fall through */ }
  }
  return 'your household assistant';
}

function buildSystemPrompt(): string {
  const assistantName = getAssistantName();
  const lines: string[] = [
    `You are ${assistantName}, the household assistant for ${HOUSEHOLD_NAME}.`,
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
    'IMPORTANT: Always respond in plain natural language. Never output raw JSON, tool results, or code blocks.',
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

  // Check onboarding state machine before calling LLM
  const onboardingState = loadOnboardingState();
  if (onboardingState !== null) {
    // Still in onboarding — store user's answer and advance state
    if (onboardingState.question > 0) {
      onboardingState.answers.push(message);
    }

    if (onboardingState.question < ONBOARDING_QUESTIONS.length) {
      // Ask the next scripted question
      const question = ONBOARDING_QUESTIONS[onboardingState.question];
      onboardingState.question++;
      saveOnboardingState(onboardingState);
      saveSession(sessionKey, []);  // clear session — onboarding manages its own state
      return question;
    }

    // All 5 questions answered — use LLM to write profile summary
    // Q1 (index 0) was the assistant name — skip it for the household profile
    const qaPairs = ONBOARDING_QUESTIONS.slice(1).map((q, i) =>
      `Q: ${q}\nA: ${onboardingState.answers[i + 1] ?? '(no answer)'}`
    ).join('\n\n');

    const profileResult = await generateText({
      model,
      system: 'You are writing a household profile for an AI assistant. Based on the interview answers below, write a clear, readable 2-4 sentence summary the assistant can use as context. Include: household name, members, dietary needs, shopping habits, what they want help with.',
      messages: [{ role: 'user', content: qaPairs }],
      maxSteps: 1,
    });

    const assistantNameAnswer = onboardingState.answers[0]?.trim() || 'Assistant';
    const profile = profileResult.text || `Household of ${onboardingState.answers[1] ?? 'unknown'}. ${onboardingState.answers.slice(2).join(' ')}`;
    const dir = join(CONTEXT_FILE, '..');
    writeFileSync(ASSISTANT_NAME_FILE, assistantNameAnswer, 'utf-8');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONTEXT_FILE, profile, 'utf-8');
    clearOnboardingState();
    logger.info({ contextFile: CONTEXT_FILE }, 'Onboarding complete — profile saved');

    return `Great, I've got everything I need! 🎉\n\nHere's what I've learned about your household:\n\n${profile}\n\nI'm ${assistantNameAnswer}, and I'm all set to help with groceries, meal planning, and chores. Just ask!`;
  }

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

  // Small models sometimes exhaust maxSteps without writing a final text response.
  if (!result.text) {
    return 'Done.';
  }

  return result.text;
}
