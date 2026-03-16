import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";

const db = openDb();

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type RecipeRow = {
  id: string;
  name: string;
  servings: number;
  ingredients_json: string;
  instructions: string;
  tags: string;
};

function findRecipe(name: string): RecipeRow | undefined {
  return db
    .prepare<[string], RecipeRow>(
      "SELECT * FROM recipes WHERE LOWER(name) = LOWER(?)"
    )
    .get(name) ?? undefined;
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

/**
 * Attempts to scale a quantity prefix from an ingredient string.
 * Handles simple integers, decimals, and basic fractions like "1/2".
 * Returns the scaled string or the original if no leading number is found.
 */
function scaleIngredient(ingredient: string, factor: number): string {
  const match = ingredient.match(
    /^(\d+(?:\.\d+)?(?:\/\d+)?)\s*(.*)/
  );
  if (!match) return ingredient;

  const rawNum = match[1];
  const rest = match[2];

  let value: number;
  if (rawNum.includes("/")) {
    const [num, den] = rawNum.split("/").map(Number);
    value = num / den;
  } else {
    value = parseFloat(rawNum);
  }

  const scaled = value * factor;
  // Display as a clean decimal (up to 2 decimal places, strip trailing zeros)
  const scaledStr = parseFloat(scaled.toFixed(2)).toString();
  return `${scaledStr} ${rest}`.trim();
}

function formatRecipe(recipe: RecipeRow, servings?: number): string {
  const ingredients: string[] = JSON.parse(recipe.ingredients_json);
  const targetServings = servings ?? recipe.servings;
  const factor = targetServings / recipe.servings;
  const scaledIngredients =
    factor === 1
      ? ingredients
      : ingredients.map((i) => scaleIngredient(i, factor));

  const lines = [
    `## ${recipe.name}`,
    `**Servings:** ${targetServings}${factor !== 1 ? ` (scaled from ${recipe.servings})` : ""}`,
    recipe.tags ? `**Tags:** ${recipe.tags}` : "",
    `\n**Ingredients:**`,
    ...scaledIngredients.map((i) => `• ${i}`),
    `\n**Instructions:**`,
    recipe.instructions,
  ].filter(Boolean);

  return lines.join("\n");
}

const server = new McpServer({ name: "homeclaw-recipe", version: "1.0.0" });

server.tool(
  "save_recipe",
  "Save or update a recipe. If a recipe with the same name already exists (case-insensitive), it will be updated.",
  {
    name: z.string().describe("Recipe name"),
    servings: z.number().int().positive().describe("Number of servings"),
    ingredients: z
      .array(z.string())
      .describe(
        'List of ingredients, each as a string like "2 cups flour" or "1/2 tsp salt"'
      ),
    instructions: z.string().describe("Step-by-step cooking instructions"),
    tags: z
      .string()
      .optional()
      .describe("Comma-separated tags, e.g. 'vegetarian,quick,dinner'"),
  },
  ({ name, servings, ingredients, instructions, tags }) => {
    const existing = findRecipe(name);
    const ingredientsJson = JSON.stringify(ingredients);

    if (existing) {
      db.prepare(
        "UPDATE recipes SET name = ?, servings = ?, ingredients_json = ?, instructions = ?, tags = ? WHERE id = ?"
      ).run(name, servings, ingredientsJson, instructions, tags ?? "", existing.id);
      return {
        content: [
          { type: "text", text: `Updated recipe "${name}" (${servings} servings, ${ingredients.length} ingredients).` },
        ],
      };
    }

    db.prepare(
      "INSERT INTO recipes (id, name, servings, ingredients_json, instructions, tags) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(newId(), name, servings, ingredientsJson, instructions, tags ?? "");
    return {
      content: [
        { type: "text", text: `Saved recipe "${name}" (${servings} servings, ${ingredients.length} ingredients).` },
      ],
    };
  }
);

server.tool(
  "get_recipe",
  "Get the full details of a recipe by name.",
  {
    name: z.string().describe("Recipe name"),
    servings: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Desired servings for scaling (optional)"),
  },
  ({ name, servings }) => {
    const recipe = findRecipe(name);
    if (!recipe) {
      return {
        content: [{ type: "text", text: `Recipe "${name}" not found.` }],
      };
    }
    return { content: [{ type: "text", text: formatRecipe(recipe, servings) }] };
  }
);

server.tool(
  "search_by_ingredient",
  "Find all recipes that include a given ingredient.",
  {
    ingredient: z
      .string()
      .describe("Ingredient to search for (case-insensitive substring match)"),
  },
  ({ ingredient }) => {
    type Row = { name: string; ingredients_json: string };
    const all = db
      .prepare<[], Row>("SELECT name, ingredients_json FROM recipes")
      .all();

    const matches = all
      .filter((r) => {
        const ings: string[] = JSON.parse(r.ingredients_json);
        return ings.some((i) =>
          i.toLowerCase().includes(ingredient.toLowerCase())
        );
      })
      .map((r) => `• ${r.name}`);

    return {
      content: [
        {
          type: "text",
          text:
            matches.length > 0
              ? `Recipes containing "${ingredient}":\n${matches.join("\n")}`
              : `No recipes found containing "${ingredient}".`,
        },
      ],
    };
  }
);

server.tool(
  "list_recipes",
  "List all recipe names, optionally filtered by tag.",
  {
    tag: z
      .string()
      .optional()
      .describe("Filter by tag (case-insensitive substring match)"),
  },
  ({ tag }) => {
    type Row = { name: string; tags: string };
    let rows: Row[];

    if (tag) {
      rows = db
        .prepare<[string], Row>(
          "SELECT name, tags FROM recipes WHERE LOWER(tags) LIKE LOWER(?)"
        )
        .all(`%${tag}%`);
    } else {
      rows = db
        .prepare<[], Row>("SELECT name, tags FROM recipes ORDER BY name")
        .all();
    }

    if (rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: tag
              ? `No recipes found with tag "${tag}".`
              : "No recipes saved yet.",
          },
        ],
      };
    }

    const lines = rows.map(
      (r) => `• ${r.name}${r.tags ? ` [${r.tags}]` : ""}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "scale_recipe",
  "Return a recipe with ingredient quantities scaled to a different number of servings.",
  {
    name: z.string().describe("Recipe name"),
    servings: z
      .number()
      .int()
      .positive()
      .describe("Desired number of servings"),
  },
  ({ name, servings }) => {
    const recipe = findRecipe(name);
    if (!recipe) {
      return {
        content: [{ type: "text", text: `Recipe "${name}" not found.` }],
      };
    }
    return { content: [{ type: "text", text: formatRecipe(recipe, servings) }] };
  }
);

server.tool(
  "add_to_grocery",
  "Add all ingredients from a recipe to a grocery list (creates default list if needed). Scales quantities if servings differ from the recipe default.",
  {
    recipe_name: z.string().describe("Recipe name"),
    servings: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Servings to scale to (defaults to the recipe's servings)"),
    list_name: z
      .string()
      .optional()
      .describe("Target grocery list name (defaults to the first/default list)"),
  },
  ({ recipe_name, servings, list_name }) => {
    const recipe = findRecipe(recipe_name);
    if (!recipe) {
      return {
        content: [{ type: "text", text: `Recipe "${recipe_name}" not found.` }],
      };
    }

    let listId: string;
    if (list_name) {
      const row = db
        .prepare<[string], { id: string }>(
          "SELECT id FROM grocery_lists WHERE LOWER(name) = LOWER(?)"
        )
        .get(list_name);
      if (!row) {
        // Create it
        listId = newId();
        db.prepare(
          "INSERT INTO grocery_lists (id, name, created_at) VALUES (?, ?, ?)"
        ).run(listId, list_name, new Date().toISOString());
      } else {
        listId = row.id;
      }
    } else {
      listId = getOrCreateDefaultList();
    }

    const ingredients: string[] = JSON.parse(recipe.ingredients_json);
    const targetServings = servings ?? recipe.servings;
    const factor = targetServings / recipe.servings;

    const insert = db.prepare(
      "INSERT INTO grocery_items (id, list_id, name, category, done, added_at) VALUES (?, ?, ?, NULL, 0, ?)"
    );

    for (const ing of ingredients) {
      const scaled = factor === 1 ? ing : scaleIngredient(ing, factor);
      insert.run(newId(), listId, scaled, new Date().toISOString());
    }

    return {
      content: [
        {
          type: "text",
          text: `Added ${ingredients.length} ingredient(s) from "${recipe.name}"${factor !== 1 ? ` (scaled to ${targetServings} servings)` : ""} to grocery list.`,
        },
      ],
    };
  }
);

server.tool(
  "delete_recipe",
  "Permanently delete a recipe by name.",
  {
    name: z.string().describe("Recipe name to delete"),
  },
  ({ name }) => {
    const result = db
      .prepare("DELETE FROM recipes WHERE LOWER(name) = LOWER(?)")
      .run(name);
    return {
      content: [
        {
          type: "text",
          text:
            result.changes > 0
              ? `Deleted recipe "${name}".`
              : `Recipe "${name}" not found.`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
