import Database from 'better-sqlite3';

let _db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS grocery_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grocery_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES grocery_lists(id),
  name TEXT NOT NULL,
  category TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meal_plan (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
  recipe_id TEXT REFERENCES recipes(id),
  custom_name TEXT
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  servings INTEGER NOT NULL DEFAULT 4,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  instructions TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  assignee TEXT,
  recurrence TEXT CHECK(recurrence IN ('daily','weekly','monthly') OR recurrence IS NULL),
  last_done TEXT,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS household_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  messaging_handle TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  content TEXT NOT NULL,
  sender TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Initializes the SQLite database at the given path, applies the schema,
 * enables WAL mode, and returns the instance.
 */
export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(SCHEMA);

  _db = db;
  return db;
}

/**
 * Returns the singleton database instance.
 * Throws if initDb() has not been called yet.
 */
export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database has not been initialized. Call initDb() first.');
  }
  return _db;
}
