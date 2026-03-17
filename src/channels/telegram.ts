import { Telegraf, type Context } from 'telegraf';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS, TRIGGER_WORD, HOUSEHOLD_NAME } from '../config.js';
import { logger } from '../logger.js';
import { clearSession } from '../agent.js';
import type { MessageHandler } from '../index.js';

let _bot: Telegraf | null = null;

export async function broadcastTelegram(text: string): Promise<void> {
  if (!_bot) return;
  const sends = TELEGRAM_CHAT_IDS.map((id) => _bot!.telegram.sendMessage(id, text).catch(() => {}));
  await Promise.all(sends);
}

const HELP_TEXT = `*HomeClaw* 🏠

I'm your household AI assistant for *${HOUSEHOLD_NAME}*, connected to your Grocy pantry.

*What I can do:*
• Check what's in stock
• Add items to your shopping list
• Import recipes from URLs and add ingredients
• Find recipes based on what you have
• Track chores and tasks
• Answer questions about your household

*How to use me:*
• In private chat: just send me a message
• In groups: mention @${TRIGGER_WORD.replace(/^@/, '')} to get my attention

*Example messages:*
• "What do we have in the fridge?"
• "Add milk and eggs to the shopping list"
• "Import this recipe: [URL]"
• "What can I make with what we have?"
• "Show me this week's meal plan"

*Commands:*
/status — Check HomeClaw and Grocy connection status
/setup — Re-run household setup
/history — Clear conversation history`;

function allowedChatId(ctx: Context): string | null {
  const chatId = String(ctx.chat!.id);
  if (TELEGRAM_CHAT_IDS.length > 0 && !TELEGRAM_CHAT_IDS.includes(chatId)) return null;
  return chatId;
}

function delegateToAgent(
  ctx: Context,
  onMessage: MessageHandler,
  ack: string,
  prompt: string,
  label: string,
): void {
  const chatId = allowedChatId(ctx);
  if (!chatId) return;
  ctx.reply(ack);
  onMessage({
    channelType: 'telegram',
    channelId: chatId,
    sender: String(ctx.from!.id),
    senderName: ctx.from!.first_name,
    text: prompt,
    reply: (replyText) => ctx.reply(replyText).then(() => {}),
  }).catch((err) => logger.error({ err, chatId }, `Telegram ${label} handler error`));
}

export async function startTelegram(onMessage: MessageHandler): Promise<void> {
  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
  _bot = bot;

  await bot.telegram.setMyCommands([
    { command: 'start',   description: 'Get started with HomeClaw' },
    { command: 'help',    description: 'Show available commands and tips' },
    { command: 'status',  description: 'Check HomeClaw and Grocy connection status' },
    { command: 'setup',   description: 'Re-run household setup' },
    { command: 'history', description: 'Clear conversation history' },
  ]);

  bot.command(['start', 'help'], async (ctx) => {
    await ctx.replyWithMarkdown(HELP_TEXT);
  });

  bot.command('status', (ctx) => {
    delegateToAgent(ctx, onMessage,
      'Checking status...',
      "What's your status? Check all Grocy connections and report back.",
      '/status');
  });

  bot.command('setup', (ctx) => {
    delegateToAgent(ctx, onMessage,
      "Let's set up your household...",
      "Let's set up HomeClaw for my household. Please ask me for the household name and any other setup needed.",
      '/setup');
  });

  bot.command('history', async (ctx) => {
    const chatId = allowedChatId(ctx);
    if (!chatId) return;
    clearSession(`telegram_${chatId}`);
    await ctx.reply('Conversation history cleared. Your next message will start a fresh session.');
  });

  bot.on('text', async (ctx) => {
    const chatId = allowedChatId(ctx);
    if (!chatId) return;

    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    if (isGroup && !text.toLowerCase().includes(TRIGGER_WORD.toLowerCase())) return;

    // Fire-and-forget: don't await so Telegraf's polling cycle completes
    // immediately and doesn't hit its 90s per-cycle timeout during LLM inference.
    onMessage({
      channelType: 'telegram',
      channelId: chatId,
      sender: String(ctx.from.id),
      senderName: ctx.from.first_name,
      text,
      reply: (replyText) => ctx.reply(replyText).then(() => {}),
    }).catch((err) => logger.error({ err, chatId }, 'Telegram message handler error'));
  });

  await bot.launch();
  logger.info('Telegram bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
