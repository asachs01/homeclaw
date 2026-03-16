import { randomUUID } from 'node:crypto';

import { logger } from './logger.js';
import { initDb, getDb } from './db.js';
import { initAgent, runTurn } from './agent.js';
import { startScheduler } from './scheduler.js';
import {
  DB_PATH,
  WHATSAPP_ENABLED,
  TELEGRAM_ENABLED,
  DISCORD_ENABLED,
} from './config.js';

export interface IncomingMessage {
  channelType: 'whatsapp' | 'telegram' | 'discord';
  channelId: string;
  sender: string;
  senderName?: string;
  text: string;
  reply: (text: string) => Promise<void>;
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

async function onMessage(msg: IncomingMessage): Promise<void> {
  const { channelType, channelId, sender, senderName, text, reply } = msg;

  logger.info(
    { channelType, channelId, sender, senderName, textLength: text.length },
    'Incoming message'
  );

  const sessionKey = `${channelType}_${channelId}`;

  const response = await runTurn({ message: text, sessionKey, sender, senderName });

  await reply(response);

  logger.info({ channelType, channelId, responseLength: response.length }, 'Reply sent');

  try {
    const db = getDb();
    const now = new Date().toISOString();
    const channel = `${channelType}:${channelId}`;

    db.prepare(
      `INSERT INTO messages (id, channel, direction, content, sender, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), channel, 'in', text, sender, now);

    db.prepare(
      `INSERT INTO messages (id, channel, direction, content, sender, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), channel, 'out', response, 'agent', now);
  } catch (err) {
    logger.warn({ err }, 'Failed to save messages to db');
  }
}

async function main(): Promise<void> {
  logger.info('HomeClaw starting up…');

  initDb(DB_PATH);
  logger.info({ dbPath: DB_PATH }, 'Database initialized');

  await initAgent();

  const sendToAllChannels = async (text: string): Promise<void> => {
    // Best-effort broadcast — individual channel errors are caught below
    const sends: Promise<void>[] = [];

    if (WHATSAPP_ENABLED) {
      try {
        const { broadcastWhatsApp } = await import('./channels/whatsapp.js');
        if (typeof broadcastWhatsApp === 'function') {
          sends.push(broadcastWhatsApp(text));
        }
      } catch {
        // channel may not expose a broadcast function
      }
    }

    if (TELEGRAM_ENABLED) {
      try {
        const { broadcastTelegram } = await import('./channels/telegram.js');
        if (typeof broadcastTelegram === 'function') {
          sends.push(broadcastTelegram(text));
        }
      } catch {
        // channel may not expose a broadcast function
      }
    }

    if (DISCORD_ENABLED) {
      try {
        const { broadcastDiscord } = await import('./channels/discord.js');
        if (typeof broadcastDiscord === 'function') {
          sends.push(broadcastDiscord(text));
        }
      } catch {
        // channel may not expose a broadcast function
      }
    }

    await Promise.allSettled(sends);
  };

  startScheduler(sendToAllChannels);

  if (WHATSAPP_ENABLED) {
    try {
      const { startWhatsApp } = await import('./channels/whatsapp.js');
      await startWhatsApp(onMessage);
      logger.info('WhatsApp channel started');
    } catch (err) {
      logger.error({ err }, 'Failed to start WhatsApp channel');
    }
  }

  if (TELEGRAM_ENABLED) {
    try {
      const { startTelegram } = await import('./channels/telegram.js');
      await startTelegram(onMessage);
      logger.info('Telegram channel started');
    } catch (err) {
      logger.error({ err }, 'Failed to start Telegram channel');
    }
  }

  if (DISCORD_ENABLED) {
    try {
      const { startDiscord } = await import('./channels/discord.js');
      await startDiscord(onMessage);
      logger.info('Discord channel started');
    } catch (err) {
      logger.error({ err }, 'Failed to start Discord channel');
    }
  }

  logger.info('HomeClaw startup complete');
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});
