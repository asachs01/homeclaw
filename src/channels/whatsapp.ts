import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { TRIGGER_WORD, WHATSAPP_AUTH_DIR } from '../config.js';
import type { MessageHandler } from '../index.js';

// Module-level state for broadcasting
let _sock: ReturnType<typeof makeWASocket> | null = null;
const _activeChatIds = new Set<string>();

export async function broadcastWhatsApp(text: string): Promise<void> {
  if (!_sock) return;
  const sends = [..._activeChatIds].map((id) =>
    _sock!.sendMessage(id, { text }).catch(() => {}),
  );
  await Promise.all(sends);
}

export async function startWhatsApp(onMessage: MessageHandler): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(WHATSAPP_AUTH_DIR);
  const logger = pino({ level: 'silent' });

  function connect(): void {
    const sock = makeWASocket({ auth: state, printQRInTerminal: true, logger });
    _sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        console.log('[whatsapp] Connected');
      } else if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[whatsapp] Connection closed (code=${statusCode}), reconnect=${shouldReconnect}`);
        if (shouldReconnect) {
          connect();
        }
      } else {
        console.log(`[whatsapp] Connection state: ${connection}`);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (msg.key.fromMe) continue;

        const text =
          msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text ??
          '';

        if (!text) continue;

        const chatId = msg.key.remoteJid ?? '';
        const isGroup = chatId.endsWith('@g.us');
        const containsTrigger = text.toLowerCase().includes(TRIGGER_WORD.toLowerCase());

        if (isGroup && !containsTrigger) continue;

        _activeChatIds.add(chatId);
        const channelId = chatId;
        const sender = msg.key.participant ?? chatId;
        const senderName = msg.pushName ?? undefined;

        await onMessage({
          channelType: 'whatsapp',
          channelId,
          sender,
          senderName,
          text,
          reply: async (replyText: string) => {
            await sock.sendMessage(channelId, { text: replyText });
          },
        });
      }
    });
  }

  connect();
}
