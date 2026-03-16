**HomeClaw**

Product Requirements Document

*Local-First AI Home Management Agent*

v0.2 • March 2026 • Aaron Sachs

**1. Overview**

HomeClaw is a purpose-built, local-first AI home management agent
delivered over messaging apps (WhatsApp, Telegram, Discord). It helps
households manage groceries, meal planning, recipes, and chores through
natural language conversation --- with no cloud dependency and no data
leaving the household\'s infrastructure.

The initial pilot targets up to five households operated as Docker
containers on a centralized virtualization cluster managed by the
operator. Households that want full self-hosting can do so; that path is
documented but not the primary deployment model for v1.

**2. Problem Statement**

Existing home management tools are fragmented, subscription-heavy, and
cloud-dependent. Families use separate apps for grocery lists, recipe
management, meal planning, and chore assignment --- none of which talk
to each other, and all of which require data to leave the home.

AI-powered assistants like Alexa, Google Assistant, and Siri are tightly
coupled to cloud inference and large-vendor ecosystems. There is no
lightweight, privacy-respecting, self-hostable AI agent purpose-built
for household operations that families can interact with through the
messaging apps they already use.

**3. Goals & Non-Goals**

**3.1 Goals**

-   Deliver a fully local AI agent stack --- no Anthropic API, no cloud
    inference required

-   Support household operations through WhatsApp, Telegram, and Discord
    messaging interfaces

-   Provide v1 feature coverage across grocery lists, meal planning,
    recipes, and chore tracking

-   Run as isolated Docker containers per household on a shared
    virtualization cluster

-   Remain simple enough for non-technical households to interact with
    naturally

-   Support self-hosting path for technical users without requiring it
    for the pilot

**3.2 Non-Goals**

-   No mobile app, web dashboard, or dedicated UI in v1

-   No voice interface in v1 (text only)

-   No integrations with smart home platforms (HomeKit, Home Assistant)
    in v1

-   No payment processing, shopping cart, or grocery delivery
    integrations in v1

-   Not designed for general-purpose assistant use cases outside home
    management

**4. Target Personas**

**Primary: The Household**

A family of 2--5 people who want help coordinating home logistics
without learning new apps. They interact via WhatsApp or Telegram on
their phones. They don\'t know what a container is and don\'t need to.
They just want to message something and get results.

**Secondary: The Operator (Pilot Phase)**

Aaron --- the person deploying and managing the cluster. Responsible for
standing up household containers, updating the stack, monitoring health,
and onboarding new households. Technical. Wants clear deployment
patterns and observable infrastructure.

**Tertiary: The Self-Hosting Household**

A technically inclined household that wants to run their own instance.
Has a home server or NAS. Comfortable with Docker Compose. Wants the
same feature set with full local control and no dependency on the
operator\'s cluster.

**5. Architecture**

**5.1 Stack Overview**

HomeClaw replaces NanoClaw\'s hard dependency on the Anthropic Claude
Agent SDK with the Vercel AI SDK, which is model-agnostic and natively
supports Ollama as an inference provider. This allows the full agent
loop --- routing, tool calling, memory, and response generation --- to
run locally with no external API dependency.

  -----------------------------------------------------------------------
  **Layer**             **Technology**
  --------------------- -------------------------------------------------
  Messaging interface   Baileys (WhatsApp), Telegraf (Telegram),
                        discord.js (Discord)

  Agent orchestration   Vercel AI SDK (generateText / streamText with
                        tools)

  Local inference       Ollama --- shared instance (pilot), embedded
                        per-stack (self-host)

  API translation       LiteLLM proxy (Anthropic-format compatibility
                        layer)

  Recommended model     Qwen2.5-7B-Instruct (tool use) / Qwen2.5-14B (if
                        headroom allows)

  Tool layer            MCP servers (custom) for grocery, meal, recipe,
                        chore domains

  Persistence           SQLite per household container

  Container runtime     Docker (Linux / cluster), Apple Container (macOS
                        self-host)

  Deployment            Docker Compose --- shared services stack +
                        per-household agent stacks

  Virtualization        Proxmox VE --- 3-node cluster, i7-1270P, 32GB RAM
                        per node
  -----------------------------------------------------------------------

**5.2 Cluster Layout**

The pilot runs on a 3-node Proxmox cluster of identical hosts (Intel
i7-1270P, 16 cores, 32GB RAM, \~96GB disk each). Workloads are pinned to
specific nodes --- no live migration in v1. One node is designated the
HomeClaw node and hosts all HomeClaw services. The other two nodes
continue running existing workloads.

Recommended node allocation:

-   virt01 / virt02 --- existing workloads (NanoClaw, Home Assistant,
    other services)

-   virt03 (or whichever node has the most available RAM headroom) ---
    HomeClaw dedicated node

Node selection should be based on a headroom audit across all three
hosts before deployment. The HomeClaw node should have at minimum 12GB
free RAM after existing workloads.

**5.3 Shared Inference Architecture**

Due to the RAM constraints of the pilot hardware (32GB per node, \~19GB
already consumed on virt04), embedded per-household Ollama instances are
not viable for the pilot deployment. Five concurrent Qwen2.5-7B
instances would require \~22-23GB for model weights alone, exceeding
available headroom.

Instead, the pilot uses a shared Ollama instance serving all household
agent containers on the HomeClaw node. Data isolation is maintained at
the agent and SQLite layer --- households cannot access each other\'s
data. Only the inference layer is shared.

Pilot compose topology on the HomeClaw node:

-   ollama-shared --- single Ollama instance, Qwen2.5-7B-Instruct, \~5GB
    RAM

-   litellm --- shared LiteLLM proxy routing all household agents to
    ollama-shared

-   household-1-agent through household-5-agent --- independent agent
    containers, each with own SQLite volume

OLLAMA_NUM_PARALLEL is set to 1 to prevent concurrent inference thrash
under CPU-only conditions. The agent layer handles queuing ---
households receive an acknowledgement immediately and the full response
once inference completes.

**5.4 Self-Hosting Architecture (Non-Pilot)**

For self-hosting households with sufficient hardware (16GB+ RAM), an
embedded per-stack topology is supported. Each household runs a fully
self-contained Docker Compose stack including its own Ollama instance.
No shared services required. This is the preferred architecture for
self-hosters who want complete isolation and portability.

Minimum self-hosting hardware: 8GB RAM (Qwen2.5-7B), 4 CPU cores, 20GB
disk. 16GB RAM recommended for Qwen2.5-14B.

**5.5 Agent Loop**

Incoming messages are received by the messaging adapter, queued
per-household, and passed to the Vercel AI SDK agent loop. The loop uses
a system prompt seeded with household context (family members,
preferences, active lists) stored in the household\'s CONTEXT.md file.
Tool calls are dispatched to MCP servers. Responses are streamed back to
the originating messaging channel.

**5.6 MCP Server Design**

Each domain (grocery, meal planning, recipes, chores) is implemented as
a small MCP server with a focused tool surface. Servers communicate with
the agent over stdio. All data is persisted to the household\'s SQLite
database.

**6. Feature Specifications --- v1**

**6.1 Grocery Lists**

-   Add items to a household grocery list via natural language

```{=html}
<!-- -->
```
-   \"Add milk, eggs, and bread to the list\"

-   \"We need more of that pasta we got last week\"

```{=html}
<!-- -->
```
-   Remove or check off items

-   View current list on demand

-   Categorize items automatically (produce, dairy, pantry, etc.)

-   Support multiple named lists (e.g. Costco run vs. weekly shop)

-   Clear completed items

**6.2 Meal Planning / Menus**

-   Set a meal plan for the week or specific days

```{=html}
<!-- -->
```
-   \"Plan dinners for this week\"

-   \"What are we having Thursday?\"

```{=html}
<!-- -->
```
-   Auto-generate grocery list from a meal plan

-   View current week\'s plan

-   Suggest meals based on what\'s in the pantry (stretch goal for v1)

**6.3 Recipes**

-   Store recipes by name with ingredients and instructions

-   Retrieve a recipe on demand

```{=html}
<!-- -->
```
-   \"How do I make that chicken soup?\"

```{=html}
<!-- -->
```
-   Add recipe ingredients to grocery list in one step

-   Scale recipe for different serving counts

-   Search recipes by ingredient

**6.4 Chore Tracking**

-   Define household chores with optional recurrence (daily, weekly,
    monthly)

-   Assign chores to household members by name

-   Mark chores as done

-   Query status of open chores

```{=html}
<!-- -->
```
-   \"What chores are left this week?\"

-   \"What\'s Alex supposed to do today?\"

```{=html}
<!-- -->
```
-   Send reminders on a schedule (via task scheduler)

**7. MCP Server Specifications**

HomeClaw implements four domain MCP servers. Each is a standalone
Node.js process communicating via stdio. All tools write to the
household\'s shared SQLite database via a thin data access layer.

  --------------------------------------------------------------------------------
  **MCP Server**     **Key Tools**            **Notes**
  ------------------ ------------------------ ------------------------------------
  homeclaw-grocery   add_item, remove_item,   Supports multiple named lists
                     list_items, clear_done,  
                     create_list              

  homeclaw-meal      set_meal, get_plan,      Integrates with grocery server
                     generate_grocery_list,   
                     suggest_meals            

  homeclaw-recipe    save_recipe, get_recipe, Full text stored in SQLite
                     search_by_ingredient,    
                     scale_recipe,            
                     add_to_grocery           

  homeclaw-chores    define_chore,            Recurrence via task scheduler
                     assign_chore,            
                     complete_chore,          
                     list_open,               
                     get_assignments          
  --------------------------------------------------------------------------------

**8. Messaging Interface**

**8.1 Supported Channels --- v1**

-   WhatsApp (primary --- via Baileys, QR code auth)

-   Telegram (secondary --- via Telegraf, bot token)

-   Discord (tertiary --- via discord.js, bot token)

Each household configures one or more channels. The agent responds in
the same channel the message was received on.

**8.2 Group vs. Direct Message**

The agent supports both group chats and direct messages. In a group
context, the agent responds to any message directed at it (by name or
\@mention). Per-household CONTEXT.md defines which group IDs the agent
monitors.

**8.3 Interaction Style**

All interaction is natural language. There are no required command
prefixes. The agent interprets intent and routes to the appropriate MCP
tool(s). Error messages are friendly and suggest corrections. The agent
should feel like a knowledgeable household member, not a chatbot.

**9. Data Model**

All household data is stored in a SQLite database local to the household
container. Schema is managed by the agent on first boot.

  ------------------------------------------------------------------------
  **Table**           **Key Columns**
  ------------------- ----------------------------------------------------
  grocery_lists       id, name, household_id, created_at

  grocery_items       id, list_id, name, category, done, added_at

  meal_plan           id, date, meal_type (breakfast/lunch/dinner),
                      recipe_id, custom_name

  recipes             id, name, servings, ingredients_json, instructions,
                      tags

  chores              id, name, assignee, recurrence, last_done, due_date,
                      done

  household_members   id, name, messaging_handle

  messages            id, channel, direction, content, timestamp
  ------------------------------------------------------------------------

**10. Deployment**

**10.1 Pilot Deployment (Operator-Managed)**

The operator runs HomeClaw on a dedicated Proxmox node within the 3-node
cluster. A shared services stack (Ollama + LiteLLM) is brought up first,
followed by individual household agent stacks. Households interact
exclusively via their messaging app and have no access to the underlying
infrastructure.

Pre-deployment steps:

-   Audit all three Proxmox nodes for available RAM headroom (pvesh or
    free -h per node)

-   Designate the node with the most available RAM as the HomeClaw node

-   Ensure at least 12GB free RAM on the designated node before
    deployment

Shared services stack deployment:

-   Clone HomeClaw repo to the designated node

-   Run docker compose up on the shared stack --- Ollama pulls
    Qwen2.5-7B on first start (\~4.5GB download)

-   Verify LiteLLM proxy is routing correctly to Ollama before
    onboarding any households

Per-household onboarding:

-   Copy household template, configure .env with messaging credentials
    and member names

-   Run docker compose up for the household stack --- agent connects to
    shared LiteLLM endpoint

-   Authenticate messaging channel (QR scan for WhatsApp, bot token for
    Telegram/Discord)

-   Send a test message to verify end-to-end tool calling before handing
    off to the household

**10.2 NanoClaw Migration Sequencing**

NanoClaw is currently running on virt04 alongside Home Assistant.
HomeClaw is the intended long-term replacement. Recommended migration
sequence:

-   Run HomeClaw and NanoClaw in parallel during the pilot period --- do
    not decommission NanoClaw until HomeClaw is stable

-   Migrate households from NanoClaw to HomeClaw one at a time,
    validating each before proceeding

-   Once all households are confirmed stable on HomeClaw, decommission
    NanoClaw on virt04

-   Decommissioning NanoClaw frees meaningful RAM on virt04 and reduces
    the elevated load average currently observed on that node

**10.3 Self-Hosting Path**

Documented but not the primary v1 deployment model. For self-hosters
with sufficient hardware, an embedded per-stack topology is used ---
each household runs a fully self-contained Docker Compose stack
including its own Ollama instance. A single docker compose up command
brings the full stack online. A setup script handles model pull and
initial configuration interactively.

**10.4 Hardware Requirements**

**Pilot (Shared Inference)**

-   Dedicated Proxmox node: 16 cores, 32GB RAM, \~96GB disk (matching
    existing cluster nodes)

-   Minimum 12GB free RAM on the HomeClaw node before deployment

-   No GPU required --- CPU inference with OLLAMA_NUM_PARALLEL=1

-   Estimated HomeClaw footprint: \~10-12GB RAM total for shared
    Ollama + 5 household stacks

**Self-Hosting (Embedded Inference)**

-   Minimum: 4 CPU cores, 8GB RAM, 20GB disk (Qwen2.5-7B)

-   Recommended: 8 CPU cores, 16GB RAM, 30GB disk (Qwen2.5-14B or
    headroom for growth)

-   GPU optional --- significantly improves inference latency if
    available

**11. Model Selection**

Model choice is configurable per deployment via environment variable.
Recommended defaults:

  -------------------------------------------------------------------------
  **Model**              **Hardware       **Notes**
                         Tier**           
  ---------------------- ---------------- ---------------------------------
  qwen2.5:7b-instruct    8 GB RAM / no    Default. Good tool use, fast on
                         GPU              CPU.

  qwen2.5:14b-instruct   16 GB RAM / GPU  Better reasoning, higher latency
                         recommended      on CPU.

  mistral:7b-instruct    8 GB RAM / no    Fallback if Qwen unavailable.
                         GPU              Solid tool use.

  llama3.1:8b-instruct   8 GB RAM / no    Alternative. Widely supported.
                         GPU              Decent tool use.
  -------------------------------------------------------------------------

Tool calling reliability should be validated end-to-end before
onboarding households. A test harness that exercises all four MCP
servers is included in the repo.

**12. Milestones**

  ---------------------------------------------------------------------------
  **Milestone**   **Target**       **Deliverables**
  --------------- ---------------- ------------------------------------------
  M0              Week 1           Proxmox node headroom audit complete.
                                   HomeClaw node designated. Vercel AI SDK +
                                   shared Ollama + LiteLLM stack validated
                                   end-to-end with tool calling. Single MCP
                                   server (grocery) operational.

  M1              Week 2           All four MCP servers implemented. SQLite
                                   schema finalized. WhatsApp adapter
                                   operational. Async ack pattern confirmed
                                   working.

  M2              Week 3           Telegram and Discord adapters added.
                                   Per-household Docker Compose template
                                   complete. First household onboarded and
                                   validated.

  M3              Week 4           All five pilot households onboarded. Task
                                   scheduler for chore reminders live.
                                   Parallel NanoClaw migration underway.

  M4              Week 5           All households confirmed stable on
                                   HomeClaw. NanoClaw decommissioned on
                                   virt04. virt04 load average and RAM usage
                                   re-baselined.

  M5              Week 6           v1.0 cut. Self-hosting documentation
                                   complete. README covers full operator and
                                   self-host setup paths.
  ---------------------------------------------------------------------------

**13. Risks & Mitigations**

  ------------------------------------------------------------------------
  **Risk**                 **Severity**     **Mitigation**
  ------------------------ ---------------- ------------------------------
  Local model tool calling High             Validate at M0 before building
  unreliable                                features. Fallback to
                                            Mistral-7B if Qwen
                                            underperforms.

  Shared Ollama instance   Medium           OLLAMA_NUM_PARALLEL=1 + async
  becomes SPOF for all                      ack pattern prevents thrash.
  households                                SQLite volumes are independent
                                            --- only inference is shared.
                                            Restart policy keeps Ollama
                                            auto-recovering.

  WhatsApp bans bot        Medium           Use dedicated SIM/number per
  numbers                                   deployment. Monitor for rate
                                            limits. Telegram is the
                                            fallback primary.

  CPU-only inference too   Medium           Async acknowledgement pattern
  slow for household use                    --- agent confirms receipt
                                            immediately, sends full
                                            response when inference
                                            completes. Set household
                                            expectations upfront.

  HomeClaw node RAM        Medium           Audit all three Proxmox nodes
  headroom insufficient                     before committing. May need to
                                            migrate existing workloads off
                                            designated node first.

  NanoClaw migration       Low--Medium      Run both systems in parallel
  disrupts existing                         during pilot. Migrate
  households                                households one at a time with
                                            validation. No hard cutover
                                            until HomeClaw is confirmed
                                            stable.

  Households send          Low--Medium      System prompt tuning. Graceful
  ambiguous or complex                      fallback asking for
  requests                                  clarification. Defined scope
                                            limits what the agent
                                            attempts.
  ------------------------------------------------------------------------

**14. Open Questions**

-   Which Proxmox node has the most available RAM headroom? Audit
    required before committing a HomeClaw node. If all three are similar
    to virt04 (\~62% used), the designated node may need existing
    workloads migrated off first.

-   What is driving the elevated load average (7.7-8.0) on virt04?
    Should be diagnosed before adding inference workloads to the
    cluster, even on a different node.

-   What is the upgrade path for model weights? Pulling a new Qwen
    version to the shared Ollama instance should not require household
    agent downtime --- needs a rolling update procedure.

-   Should recipe and grocery data be exportable (e.g. to CSV or JSON)?
    Useful for household data portability if they ever want to self-host
    or migrate.

-   Is there a v2 appetite for a lightweight operator dashboard showing
    household health, last active time, and inference queue depth across
    all containers?

-   Should the agent support image input (e.g. photo of a receipt for
    grocery parsing)? Possible with multimodal Ollama models like LLaVA
    --- worth evaluating post-v1.

*HomeClaw PRD v0.2 • Aaron Sachs • March 2026*
