import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";

const db = openDb();

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Returns YYYY-MM-DD for the Monday of the week containing `date`. */
function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function currentWeekRange(): { start: string; end: string } {
  const now = new Date();
  const mon = mondayOf(now);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: toIsoDate(mon), end: toIsoDate(sun) };
}

function getOrCreateDefaultList(): string {
  const existing = db
    .prepare<[], { id: string }>("SELECT id FROM grocery_lists LIMIT 1")
    .get();
  if (existing) return existing.id;

  const id = newId();
  db.prepare(
    "INSERT INTO grocery_lists (id, name, created_at) VALUES (?, ?, ?)"
  ).run(id, "Grocery List", new Date().toISOString());
  return id;
}

const server = new McpServer({ name: "homeclaw-meal", version: "1.0.0" });

server.tool(
  "set_meal",
  "Add or update a meal in the meal plan for a given date and meal type (breakfast, lunch, dinner, snack). Provide either recipe_name or custom_name.",
  {
    date: z.string().describe("Date in YYYY-MM-DD format"),
    meal_type: z
      .enum(["breakfast", "lunch", "dinner", "snack"])
      .describe("Type of meal"),
    recipe_name: z
      .string()
      .optional()
      .describe("Name of an existing recipe to link"),
    custom_name: z
      .string()
      .optional()
      .describe("Free-form meal name when no recipe exists"),
  },
  ({ date, meal_type, recipe_name, custom_name }) => {
    if (!recipe_name && !custom_name) {
      return {
        content: [
          {
            type: "text",
            text: "Provide either recipe_name or custom_name.",
          },
        ],
      };
    }

    let recipeId: string | null = null;
    if (recipe_name) {
      const row = db
        .prepare<[string], { id: string }>(
          "SELECT id FROM recipes WHERE LOWER(name) = LOWER(?)"
        )
        .get(recipe_name);
      if (!row) {
        return {
          content: [
            { type: "text", text: `Recipe "${recipe_name}" not found.` },
          ],
        };
      }
      recipeId = row.id;
    }

    const existing = db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM meal_plan WHERE date = ? AND meal_type = ?"
      )
      .get(date, meal_type);

    if (existing) {
      db.prepare(
        "UPDATE meal_plan SET recipe_id = ?, custom_name = ? WHERE id = ?"
      ).run(recipeId, custom_name ?? null, existing.id);
    } else {
      db.prepare(
        "INSERT INTO meal_plan (id, date, meal_type, recipe_id, custom_name) VALUES (?, ?, ?, ?, ?)"
      ).run(newId(), date, meal_type, recipeId, custom_name ?? null);
    }

    const label = recipe_name ?? custom_name!;
    return {
      content: [
        {
          type: "text",
          text: `Set ${meal_type} on ${date} to "${label}".`,
        },
      ],
    };
  }
);

server.tool(
  "get_plan",
  "Get the meal plan for a date range. Defaults to the current Monday–Sunday week.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Start date YYYY-MM-DD (inclusive)"),
    end_date: z
      .string()
      .optional()
      .describe("End date YYYY-MM-DD (inclusive)"),
  },
  ({ start_date, end_date }) => {
    const { start, end } = start_date && end_date
      ? { start: start_date, end: end_date }
      : currentWeekRange();

    type PlanRow = {
      date: string;
      meal_type: string;
      recipe_name: string | null;
      custom_name: string | null;
    };

    const rows = db
      .prepare<[string, string], PlanRow>(
        `SELECT mp.date, mp.meal_type, r.name AS recipe_name, mp.custom_name
         FROM meal_plan mp
         LEFT JOIN recipes r ON r.id = mp.recipe_id
         WHERE mp.date BETWEEN ? AND ?
         ORDER BY mp.date, CASE mp.meal_type
           WHEN 'breakfast' THEN 1
           WHEN 'lunch'     THEN 2
           WHEN 'dinner'    THEN 3
           ELSE 4 END`
      )
      .all(start, end);

    if (rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No meals planned between ${start} and ${end}.`,
          },
        ],
      };
    }

    const byDate = new Map<string, string[]>();
    for (const row of rows) {
      if (!byDate.has(row.date)) byDate.set(row.date, []);
      const label = row.recipe_name ?? row.custom_name ?? "(unnamed)";
      byDate.get(row.date)!.push(`  ${row.meal_type}: ${label}`);
    }

    const lines: string[] = [`## Meal Plan: ${start} – ${end}`];
    for (const [date, meals] of byDate) {
      lines.push(`\n**${date}**`);
      lines.push(...meals);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "clear_meal",
  "Remove a specific meal from the plan.",
  {
    date: z.string().describe("Date in YYYY-MM-DD format"),
    meal_type: z
      .enum(["breakfast", "lunch", "dinner", "snack"])
      .describe("Meal type to remove"),
  },
  ({ date, meal_type }) => {
    const result = db
      .prepare(
        "DELETE FROM meal_plan WHERE date = ? AND meal_type = ?"
      )
      .run(date, meal_type);
    return {
      content: [
        {
          type: "text",
          text:
            result.changes > 0
              ? `Cleared ${meal_type} on ${date}.`
              : `No ${meal_type} found on ${date}.`,
        },
      ],
    };
  }
);

server.tool(
  "generate_grocery_list",
  "Look up all recipes planned in a date range and add their ingredients to the default grocery list. Returns a summary of what was added.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Start date YYYY-MM-DD (defaults to current week Monday)"),
    end_date: z
      .string()
      .optional()
      .describe("End date YYYY-MM-DD (defaults to current week Sunday)"),
  },
  ({ start_date, end_date }) => {
    const { start, end } = start_date && end_date
      ? { start: start_date, end: end_date }
      : currentWeekRange();

    type RecipeRow = {
      recipe_name: string;
      ingredients_json: string;
      date: string;
      meal_type: string;
    };

    const rows = db
      .prepare<[string, string], RecipeRow>(
        `SELECT r.name AS recipe_name, r.ingredients_json, mp.date, mp.meal_type
         FROM meal_plan mp
         JOIN recipes r ON r.id = mp.recipe_id
         WHERE mp.date BETWEEN ? AND ?`
      )
      .all(start, end);

    if (rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No recipe-linked meals found between ${start} and ${end}.`,
          },
        ],
      };
    }

    const listId = getOrCreateDefaultList();
    const insertItem = db.prepare(
      "INSERT INTO grocery_items (id, list_id, name, category, done, added_at) VALUES (?, ?, ?, NULL, 0, ?)"
    );

    const summary: string[] = [];
    for (const row of rows) {
      const ingredients: string[] = JSON.parse(row.ingredients_json);
      for (const ing of ingredients) {
        insertItem.run(newId(), listId, ing, new Date().toISOString());
      }
      summary.push(
        `${row.date} ${row.meal_type}: ${row.recipe_name} (${ingredients.length} ingredients)`
      );
    }

    return {
      content: [
        {
          type: "text",
          text: `Added ingredients from ${rows.length} meal(s):\n${summary.join("\n")}`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
