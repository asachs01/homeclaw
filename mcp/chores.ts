import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";

const db = openDb();

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type ChoreRow = {
  id: string;
  name: string;
  assignee: string | null;
  recurrence: string | null;
  last_done: string | null;
  due_date: string | null;
  done: number;
};

function findChore(name: string): ChoreRow | undefined {
  return (
    db
      .prepare<[string], ChoreRow>(
        "SELECT * FROM chores WHERE LOWER(name) = LOWER(?)"
      )
      .get(name) ?? undefined
  );
}

function nextDueDate(recurrence: string | null): string | null {
  if (!recurrence) return null;
  const now = new Date();
  switch (recurrence) {
    case "daily":
      now.setDate(now.getDate() + 1);
      break;
    case "weekly":
      now.setDate(now.getDate() + 7);
      break;
    case "monthly":
      now.setDate(now.getDate() + 30);
      break;
    default:
      return null;
  }
  return now.toISOString().slice(0, 10);
}

function formatChore(chore: ChoreRow): string {
  const parts: string[] = [
    `**${chore.name}**`,
    `Status: ${chore.done ? "Done" : "Open"}`,
  ];
  if (chore.assignee) parts.push(`Assignee: ${chore.assignee}`);
  if (chore.recurrence) parts.push(`Recurrence: ${chore.recurrence}`);
  if (chore.due_date) parts.push(`Due: ${chore.due_date}`);
  if (chore.last_done) parts.push(`Last done: ${chore.last_done}`);
  return parts.join(" | ");
}

const server = new McpServer({ name: "homeclaw-chores", version: "1.0.0" });

server.tool(
  "define_chore",
  "Create a new chore with optional assignee, recurrence schedule, and due date.",
  {
    name: z.string().describe("Name of the chore"),
    assignee: z
      .string()
      .optional()
      .describe("Household member responsible for this chore"),
    recurrence: z
      .enum(["daily", "weekly", "monthly"])
      .optional()
      .describe("How often the chore repeats"),
    due_date: z
      .string()
      .optional()
      .describe("Initial due date in YYYY-MM-DD format"),
  },
  ({ name, assignee, recurrence, due_date }) => {
    const existing = findChore(name);
    if (existing) {
      return {
        content: [
          { type: "text", text: `A chore named "${name}" already exists.` },
        ],
      };
    }
    db.prepare(
      "INSERT INTO chores (id, name, assignee, recurrence, last_done, due_date, done) VALUES (?, ?, ?, ?, NULL, ?, 0)"
    ).run(newId(), name, assignee ?? null, recurrence ?? null, due_date ?? null);
    return {
      content: [
        {
          type: "text",
          text: `Created chore "${name}"${assignee ? ` assigned to ${assignee}` : ""}${recurrence ? `, repeats ${recurrence}` : ""}${due_date ? `, due ${due_date}` : ""}.`,
        },
      ],
    };
  }
);

server.tool(
  "assign_chore",
  "Assign a chore to a household member.",
  {
    name: z.string().describe("Name of the chore to assign"),
    assignee: z.string().describe("Household member to assign it to"),
  },
  ({ name, assignee }) => {
    const chore = findChore(name);
    if (!chore) {
      return {
        content: [{ type: "text", text: `Chore "${name}" not found.` }],
      };
    }
    db.prepare("UPDATE chores SET assignee = ? WHERE id = ?").run(
      assignee,
      chore.id
    );
    return {
      content: [
        { type: "text", text: `Assigned "${name}" to ${assignee}.` },
      ],
    };
  }
);

server.tool(
  "complete_chore",
  "Mark a chore as done. Sets last_done to today and calculates next due date for recurring chores.",
  {
    name: z.string().describe("Name of the chore to complete"),
  },
  ({ name }) => {
    const chore = findChore(name);
    if (!chore) {
      return {
        content: [{ type: "text", text: `Chore "${name}" not found.` }],
      };
    }
    const now = new Date().toISOString().slice(0, 10);
    const nextDue = nextDueDate(chore.recurrence);

    db.prepare(
      "UPDATE chores SET done = 1, last_done = ?, due_date = ? WHERE id = ?"
    ).run(now, nextDue, chore.id);

    const msg = nextDue
      ? `Completed "${name}". Next due: ${nextDue}.`
      : `Completed "${name}".`;
    return { content: [{ type: "text", text: msg }] };
  }
);

server.tool(
  "list_open",
  "List all open (not done) chores, optionally filtered by assignee.",
  {
    assignee: z
      .string()
      .optional()
      .describe("Filter by assignee name (case-insensitive)"),
  },
  ({ assignee }) => {
    let rows: ChoreRow[];
    if (assignee) {
      rows = db
        .prepare<[string], ChoreRow>(
          "SELECT * FROM chores WHERE done = 0 AND LOWER(assignee) = LOWER(?) ORDER BY due_date NULLS LAST, name"
        )
        .all(assignee);
    } else {
      rows = db
        .prepare<[], ChoreRow>(
          "SELECT * FROM chores WHERE done = 0 ORDER BY due_date NULLS LAST, name"
        )
        .all();
    }

    if (rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: assignee
              ? `No open chores for ${assignee}.`
              : "No open chores.",
          },
        ],
      };
    }

    const lines = rows.map(formatChore);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get_assignments",
  "Get all chores assigned to a specific household member.",
  {
    member: z.string().describe("Household member name"),
  },
  ({ member }) => {
    const rows = db
      .prepare<[string], ChoreRow>(
        "SELECT * FROM chores WHERE LOWER(assignee) = LOWER(?) ORDER BY done, due_date NULLS LAST, name"
      )
      .all(member);

    if (rows.length === 0) {
      return {
        content: [
          { type: "text", text: `No chores assigned to "${member}".` },
        ],
      };
    }

    const lines = rows.map(formatChore);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "list_all",
  "List all chores with their status.",
  {
    show_done: z
      .boolean()
      .optional()
      .describe("Include completed chores (default: false)"),
  },
  ({ show_done }) => {
    const rows = db
      .prepare<[], ChoreRow>(
        `SELECT * FROM chores${show_done ? "" : " WHERE done = 0"} ORDER BY done, due_date NULLS LAST, name`
      )
      .all();

    if (rows.length === 0) {
      return {
        content: [{ type: "text", text: "No chores found." }],
      };
    }

    const lines = rows.map(formatChore);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "reset_chore",
  "Mark a completed chore as open again (useful for recurring chores that need resetting).",
  {
    name: z.string().describe("Name of the chore to reset"),
  },
  ({ name }) => {
    const chore = findChore(name);
    if (!chore) {
      return {
        content: [{ type: "text", text: `Chore "${name}" not found.` }],
      };
    }
    db.prepare("UPDATE chores SET done = 0 WHERE id = ?").run(chore.id);
    return {
      content: [{ type: "text", text: `Reset "${name}" to open.` }],
    };
  }
);

server.tool(
  "delete_chore",
  "Permanently delete a chore.",
  {
    name: z.string().describe("Name of the chore to delete"),
  },
  ({ name }) => {
    const result = db
      .prepare("DELETE FROM chores WHERE LOWER(name) = LOWER(?)")
      .run(name);
    return {
      content: [
        {
          type: "text",
          text:
            result.changes > 0
              ? `Deleted chore "${name}".`
              : `Chore "${name}" not found.`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
