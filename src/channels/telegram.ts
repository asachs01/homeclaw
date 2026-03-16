import { Telegraf } from 'telegraf';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS, TRIGGER_WORD } from '../config.js';
import type { MessageHandler } from '../index.js';

let _bot: Telegraf | null = null;

export async function broadcastTelegram(text: string): Promise<void> {
  if (!_bot) return;
  const ids = TELEGRAM_CHAT_IDS.length > 0 ? TELEGRAM_CHAT_IDS : [];
  const sends = ids.map((id) => _bot!.telegram.sendMessage(id, text).catch(() => {}));
  await Promise.all(sends);
}

export async function startTelegram(onMessage: MessageHandler): Promise<void> {
  const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
  _bot = bot;

  bot.on('text', async (ctx) => {
    const chatId = String(ctx.chat.id);

    if (TELEGRAM_CHAT_IDS.length > 0 && !TELEGRAM_CHAT_IDS.includes(chatId)) {
      return;
    }

    const text = ctx.message.text;
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const containsTrigger = text.toLowerCase().includes(TRIGGER_WORD.toLowerCase());

    if (isGroup && !containsTrigger) return;

    await onMessage({
      channelType: 'telegram',
      channelId: chatId,
      sender: String(ctx.from.id),
      senderName: ctx.from.first_name,
      text,
      reply: async (replyText: string) => {
        await ctx.reply(replyText);
      },
    });
  });

  await bot.launch();
  console.log('[telegram] Bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
