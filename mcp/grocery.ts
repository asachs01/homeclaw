import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";

const db = openDb();

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateList(name: string): string {
  const existing = db
    .prepare<[string], { id: string }>(
      "SELECT id FROM grocery_lists WHERE LOWER(name) = LOWER(?)"
    )
    .get(name);
  if (existing) return existing.id;

  const id = newId();
  db.prepare(
    "INSERT INTO grocery_lists (id, name, created_at) VALUES (?, ?, ?)"
  ).run(id, name, new Date().toISOString());
  return id;
}

function resolveListId(listName?: string): string | undefined {
  if (!listName) {
    const first = db
      .prepare<[], { id: string }>("SELECT id FROM grocery_lists LIMIT 1")
      .get();
    return first?.id;
  }
  const row = db
    .prepare<[string], { id: string }>(
      "SELECT id FROM grocery_lists WHERE LOWER(name) = LOWER(?)"
    )
    .get(listName);
  return row?.id;
}

const server = new McpServer({ name: "homeclaw-grocery", version: "1.0.0" });

server.tool(
  "add_item",
  "Add an item to a grocery list. Creates the list if it doesn't exist.",
  {
    list_name: z.string().describe("Name of the grocery list"),
    item: z.string().describe("Item to add"),
    category: z
      .string()
      .optional()
      .describe("Optional category (e.g. produce, dairy, meat)"),
  },
  ({ list_name, item, category }) => {
    const listId = getOrCreateList(list_name);
    const id = newId();
    db.prepare(
      "INSERT INTO grocery_items (id, list_id, name, category, done, added_at) VALUES (?, ?, ?, ?, 0, ?)"
    ).run(id, listId, item, category ?? null, new Date().toISOString());
    return {
      content: [
        {
          type: "text",
          text: `Added "${item}"${category ? ` (${category})` : ""} to list "${list_name}".`,
        },
      ],
    };
  }
);

server.tool(
  "remove_item",
  "Mark an item as done (removed) from a grocery list by name. Case-insensitive match.",
  {
    item: z.string().describe("Name of the item to mark as done"),
    list_name: z
      .string()
      .optional()
      .describe("Optional list name — searches all lists if omitted"),
  },
  ({ item, list_name }) => {
    let query: string;
    let params: unknown[];

    if (list_name) {
      const listId = resolveListId(list_name);
      if (!listId) {
        return {
          content: [{ type: "text", text: `List "${list_name}" not found.` }],
        };
      }
      query =
        "UPDATE grocery_items SET done = 1 WHERE LOWER(name) = LOWER(?) AND list_id = ? AND done = 0";
      params = [item, listId];
    } else {
      query =
        "UPDATE grocery_items SET done = 1 WHERE LOWER(name) = LOWER(?) AND done = 0";
      params = [item];
    }

    const result = db.prepare(query).run(...params);
    const count = result.changes;
    return {
      content: [
        {
          type: "text",
          text:
            count > 0
              ? `Marked ${count} item(s) named "${item}" as done.`
              : `No undone items named "${item}" found.`,
        },
      ],
    };
  }
);

server.tool(
  "list_items",
  "Show items in a grocery list. Groups by category when categories are present.",
  {
    list_name: z
      .string()
      .optional()
      .describe("List name — uses the first list if omitted"),
    show_done: z
      .boolean()
      .optional()
      .describe("Include already-done items (default: false)"),
  },
  ({ list_name, show_done }) => {
    const listId = resolveListId(list_name);
    if (!listId) {
      return {
        content: [
          {
            type: "text",
            text: list_name
              ? `List "${list_name}" not found.`
              : "No grocery lists exist yet.",
          },
        ],
      };
    }

    const listRow = db
      .prepare<[string], { name: string }>(
        "SELECT name FROM grocery_lists WHERE id = ?"
      )
      .get(listId)!;

    type ItemRow = { name: string; category: string | null; done: number };
    const items = db
      .prepare<[string], ItemRow>(
        `SELECT name, category, done FROM grocery_items
         WHERE list_id = ?${show_done ? "" : " AND done = 0"}
         ORDER BY category NULLS LAST, name`
      )
      .all(listId);

    if (items.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `List "${listRow.name}" is empty${show_done ? "" : " (no pending items)"}.`,
          },
        ],
      };
    }

    // Group by category
    const groups = new Map<string, string[]>();
    for (const row of items) {
      const cat = row.category ?? "Uncategorized";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(`${row.done ? "✓" : "•"} ${row.name}`);
    }

    const lines: string[] = [`## ${listRow.name}`];
    const hasCategories =
      items.some((i) => i.category) || groups.size > 1 || !groups.has("Uncategorized");

    if (hasCategories && groups.size > 1) {
      for (const [cat, entries] of groups) {
        lines.push(`\n**${cat}**`);
        lines.push(...entries);
      }
    } else {
      for (const [, entries] of groups) {
        lines.push(...entries);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "clear_done",
  "Delete all done/completed items from a grocery list.",
  {
    list_name: z
      .string()
      .optional()
      .describe("List name — clears the first list if omitted"),
  },
  ({ list_name }) => {
    const listId = resolveListId(list_name);
    if (!listId) {
      return {
        content: [
          {
            type: "text",
            text: list_name
              ? `List "${list_name}" not found.`
              : "No grocery lists exist yet.",
          },
        ],
      };
    }
    const result = db
      .prepare("DELETE FROM grocery_items WHERE list_id = ? AND done = 1")
      .run(listId);
    return {
      content: [
        {
          type: "text",
          text: `Removed ${result.changes} completed item(s) from the list.`,
        },
      ],
    };
  }
);

server.tool(
  "create_list",
  "Create a new named grocery list.",
  {
    name: z.string().describe("Name for the new list"),
  },
  ({ name }) => {
    const existing = db
      .prepare("SELECT id FROM grocery_lists WHERE LOWER(name) = LOWER(?)")
      .get(name);
    if (existing) {
      return {
        content: [
          { type: "text", text: `A list named "${name}" already exists.` },
        ],
      };
    }
    const id = newId();
    db.prepare(
      "INSERT INTO grocery_lists (id, name, created_at) VALUES (?, ?, ?)"
    ).run(id, name, new Date().toISOString());
    return {
      content: [
        { type: "text", text: `Created grocery list "${name}".` },
      ],
    };
  }
);

server.tool(
  "list_all_lists",
  "Return all grocery list names.",
  {},
  () => {
    type ListRow = { name: string; created_at: string };
    const lists = db
      .prepare<[], ListRow>(
        "SELECT name, created_at FROM grocery_lists ORDER BY created_at"
      )
      .all();
    if (lists.length === 0) {
      return {
        content: [{ type: "text", text: "No grocery lists found." }],
      };
    }
    const text = lists.map((l) => `• ${l.name}`).join("\n");
    return { content: [{ type: "text", text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
