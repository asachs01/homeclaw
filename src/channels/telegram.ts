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

const HELP_TEXT = `*${HOUSEHOLD_NAME}'s Nisse* 🏠

I'm your household guardian — keeping the pantry, shopping list, and meal plan running quietly in the background.

*What I can do:*
• Tell you what's in stock and flag things expiring soon
• Build and manage the shopping list
• Import recipes from URLs and add their ingredients
• Suggest what to cook based on what you have
• Plan the week's dinners
• Track household chores

*How to reach me:*
• Private chat: just send a message
• Group chat: mention @${TRIGGER_WORD.replace(/^@/, '')}

*Examples:*
• "What do we have in the fridge?"
• "Add oat milk and eggs to the list"
• "Import this recipe: [URL]"
• "What can I make with what we have?"
• "What's on the meal plan this week?"

*Commands:*
/status — Check connection status
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
