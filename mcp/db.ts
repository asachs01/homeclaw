import Database from 'better-sqlite3';

/**
 * Opens a better-sqlite3 database at the path specified by the DB_PATH
 * environment variable, with WAL mode and foreign keys enabled.
 *
 * Throws if DB_PATH is not set.
 */
export function openDb(): Database.Database {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    throw new Error('DB_PATH environment variable is not set.');
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return db;
}
