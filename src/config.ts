/**
 * Application configuration loaded from environment variables.
 * All values have sensible defaults for local development.
 */

function bool(key: string, fallback = false): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  return val.toLowerCase() === 'true';
}

function num(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function str(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function strOpt(key: string): string {
  return process.env[key] ?? '';
}

function strList(key: string): string[] {
  const val = process.env[key];
  if (!val) return [];
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

// --- Storage ---
export const DB_PATH = str('DB_PATH', '/data/homeclaw.db');
export const CONTEXT_FILE = str('CONTEXT_FILE', '/data/CONTEXT.md');
export const SESSIONS_DIR = str('SESSIONS_DIR', '/data/sessions');

// --- AI Inference ---
export const AI_PROVIDER = str('AI_PROVIDER', 'openai') as 'openai' | 'anthropic';
export const AI_MODEL = str('AI_MODEL', 'qwen2.5:7b-instruct');
export const AI_BASE_URL = str('AI_BASE_URL', 'http://litellm:4000');
export const AI_API_KEY = str('AI_API_KEY', 'homeclaw');

// --- Grocy ---
export const GROCY_URL = str('GROCY_URL', 'http://192.168.156.246:9283');
export const GROCY_API_KEY = str('GROCY_API_KEY', '');

// --- Household ---
export const HOUSEHOLD_NAME = str('HOUSEHOLD_NAME', 'Home');
export const TRIGGER_WORD = str('TRIGGER_WORD', '@home');

// --- WhatsApp ---
export const WHATSAPP_ENABLED = bool('WHATSAPP_ENABLED', true);
export const WHATSAPP_AUTH_DIR = str('WHATSAPP_AUTH_DIR', '/data/whatsapp-auth');

// --- Telegram ---
export const TELEGRAM_ENABLED = bool('TELEGRAM_ENABLED', false);
export const TELEGRAM_BOT_TOKEN = strOpt('TELEGRAM_BOT_TOKEN');
export const TELEGRAM_CHAT_IDS = strList('TELEGRAM_CHAT_IDS');

// --- Discord ---
export const DISCORD_ENABLED = bool('DISCORD_ENABLED', false);
export const DISCORD_BOT_TOKEN = strOpt('DISCORD_BOT_TOKEN');
export const DISCORD_CHANNEL_IDS = strList('DISCORD_CHANNEL_IDS');

// --- Agent tuning ---
export const MAX_HISTORY_MESSAGES = num('MAX_HISTORY_MESSAGES', 60);
export const MAX_STEPS = num('MAX_STEPS', 20);
export const SCHEDULER_INTERVAL_MS = num('SCHEDULER_INTERVAL_MS', 60_000);
