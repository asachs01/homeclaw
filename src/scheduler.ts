import { SCHEDULER_INTERVAL_MS } from './config.js';
import { getDb } from './db.js';
import { logger } from './logger.js';

interface ChoreRow {
  id: string;
  name: string;
  assignee: string | null;
  due_date: string;
}

function formatReminder(chore: ChoreRow): string {
  const assigneePart = chore.assignee ? ` — assigned to ${chore.assignee}` : '';
  return `⏰ Reminder: ${chore.name} is due!${assigneePart}`;
}

export function startScheduler(sendFn: (message: string) => Promise<void>): void {
  logger.info({ intervalMs: SCHEDULER_INTERVAL_MS }, 'Chore scheduler started');

  setInterval(() => {
    const sentThisScan = new Set<string>();

    try {
      const db = getDb();
      const now = new Date().toISOString();

      const dueChores = db
        .prepare<[string], ChoreRow>(
          `SELECT id, name, assignee, due_date
           FROM chores
           WHERE done = 0
             AND due_date IS NOT NULL
             AND due_date <= ?`
        )
        .all(now);

      if (dueChores.length === 0) return;

      logger.debug({ count: dueChores.length }, 'Found due chores');

      for (const chore of dueChores) {
        if (sentThisScan.has(chore.id)) continue;

        sentThisScan.add(chore.id);

        const message = formatReminder(chore);

        sendFn(message).catch((err) => {
          logger.warn({ choreId: chore.id, err }, 'Failed to send chore reminder');
        });

        logger.info({ choreId: chore.id, choreName: chore.name }, 'Sent chore reminder');
      }
    } catch (err) {
      logger.error({ err }, 'Scheduler error during chore scan');
    }
  }, SCHEDULER_INTERVAL_MS);
}
