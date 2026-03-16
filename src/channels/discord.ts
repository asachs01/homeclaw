import { Client, GatewayIntentBits } from 'discord.js';
import { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_IDS, TRIGGER_WORD } from '../config.js';
import type { MessageHandler } from '../index.js';

const DISCORD_MAX_LENGTH = 2000;

function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, DISCORD_MAX_LENGTH));
    remaining = remaining.slice(DISCORD_MAX_LENGTH);
  }
  return chunks;
}

let _client: Client | null = null;

export async function broadcastDiscord(text: string): Promise<void> {
  if (!_client) return;
  const ids = DISCORD_CHANNEL_IDS.length > 0 ? DISCORD_CHANNEL_IDS : [];
  const sends = ids.map(async (id) => {
    try {
      const ch = await _client!.channels.fetch(id);
      if (ch?.isTextBased() && 'send' in ch) await ch.send(text);
    } catch { /* ignore */ }
  });
  await Promise.all(sends);
}

export async function startDiscord(onMessage: MessageHandler): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  _client = client;
  client.once('ready', () => {
    console.log(`[discord] Logged in as ${client.user?.username}`);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (
      DISCORD_CHANNEL_IDS.length > 0 &&
      !DISCORD_CHANNEL_IDS.includes(message.channelId)
    ) {
      return;
    }

    const text = message.content;
    const isDM = message.guild === null;
    const containsTrigger = text.toLowerCase().includes(TRIGGER_WORD.toLowerCase());

    if (!isDM && !containsTrigger) return;

    await onMessage({
      channelType: 'discord',
      channelId: message.channelId,
      sender: message.author.id,
      senderName: message.author.displayName,
      text,
      reply: async (replyText: string) => {
        const chunks = splitMessage(replyText);
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      },
    });
  });

  await client.login(DISCORD_BOT_TOKEN);
}
