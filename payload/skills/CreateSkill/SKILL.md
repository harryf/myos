---
name: CreateSkill
version: 1.1.25
description: "Conventions and workflows for all myos skill work: creating, editing, adding a workflow or tool, renaming, validating, or canonicalizing a skill; owns the full lifecycle: scaffold, validate, canonicalize, test, improve. USE WHEN create skill, new skill, make a skill, build a skill, set up a skill, private skill, make a X skill, add a workflow, add a tool, edit/change/update/rename a skill, skill frontmatter, validate skill, check skill, canonicalize, scaffold skill, test skill, improve skill, optimize description, skill not triggering, overtriggering. NOT FOR TypeScript CLI generation (use CreateCLI)."
effort: medium
---


# CreateSkill

Complete skill development lifecycle: **structure** (create, validate, canonicalize) + **effectiveness** (test, improve, optimize triggers). Structural workflows ensure skills follow myos conventions. Effectiveness workflows (inspired by Anthropic's skill-creator) ensure skills actually work and trigger reliably.

## Authoritative Source

**The conventions in this file are the authority.** The myos repo enforces the frontmatter part in code: `test/gates/SkillFrontmatter.test.ts` parses every `SKILL.md` as strict YAML.

**Canonical examples to follow:** `~/.myos/skills/Scheduler/SKILL.md` (a skill with a tool), `~/.myos/skills/Writing/SKILL.md` (a skill with a gate), `~/.myos/skills/ISA/SKILL.md` (a skill with many workflows).

## Naming Convention: Shipped vs Local

**The skill name says where the skill lives. There are exactly two valid forms.** myos is private to Harry; the split is about the installer, not about who may read it.

| Skill type | Directory format | Example | Where it lives |
|------------|------------------|---------|----------------|
| **Shipped** | `TitleCase` | `Writing`, `Scheduler`, `MyTokens` | the myos repo (`payload/skills/`), copied to `~/.myos/skills/` by `install.sh`, which replaces the directory wholesale on every run |
| **Local** | `_ALLCAPS` (underscore prefix, all uppercase) | `_SCRATCH`, `_IYFADS` | `~/.myos/skills/` only; the installer never touches it |

**Edit shipped skills in the repo, not in `~/.myos`.** An edit made only in `~/.myos/skills/<TitleCase>/` is gone after the next install. Values that differ per machine (paths, account ids) go in `~/.myos/MYOS/USER/CONFIG/MYOS_CONFIG.toml` under a named section the skill reads, never in the body.

**Sub-file naming (both kinds):**

| Component | Format | Example |
|-----------|--------|---------|
| Workflow files | `TitleCase.md` | `Create.md`, `UpdateDaemonInfo.md` |
| Reference docs | `TitleCase.md` | `ProsodyGuide.md`, `ApiReference.md` |
| Tool files | `TitleCase.ts` | `ManageServer.ts` |
| Help files | `TitleCase.help.md` | `ManageServer.help.md` |

**Wrong (never use):** skill dirs `createskill`, `create-skill`, `CREATE_SKILL`; files `create.md`, `update-info.md`, `SYNC_REPO.md`.

### What stays out of every skill body

- API keys, tokens, credentials, cookies, even example-looking ones (reference an env var or a config key by name)
- Other people's private data (names with phone numbers, emails, health details)
- Absolute home paths (`/Users/<name>/...`): write `~/`

Pre-flight grep before a skill ships:

```bash
rg -i "api[_-]?key\s*[:=]|secret\s*[:=]|bearer [a-z0-9]|/Users/[a-z]+/" ~/Code/personal/myos/payload/skills/<SkillName>/
```

Zero matches = ready. The repo's `Tools/ContrabandCheck.ts` and the em dash gate (`skills/Writing/Tools/StyleCheck.ts --profile dashes`) run over the same tree.

---

## Flat Folder Structure (MANDATORY)

**CRITICAL: Keep folder structure FLAT - maximum 2 levels deep.**

### The Rule

**Maximum depth:** `skills/SkillName/Category/`

### ✅ ALLOWED (2 levels max)

```
skills/SkillName/SKILL.md                    # Skill root
skills/SkillName/Workflows/Create.md         # Workflow - one level deep - GOOD
skills/SkillName/Tools/Manage.ts             # Tool - one level deep - GOOD
skills/SkillName/QuickStartGuide.md          # Context file - in root - GOOD
skills/SkillName/Examples.md                 # Context file - in root - GOOD
```

### ❌ FORBIDDEN (Too deep OR wrong location)

```
skills/SkillName/Resources/Guide.md              # Context files go in root, NOT Resources/
skills/SkillName/Docs/Examples.md                # Context files go in root, NOT Docs/
skills/SkillName/Workflows/Category/File.md      # THREE levels - NO
skills/SkillName/Templates/Primitives/File.md    # THREE levels - NO
skills/SkillName/Tools/Utils/Helper.ts           # THREE levels - NO
```

### Allowed Subdirectories

**These subdirectories are allowed:**
- **Workflows/** - Execution workflows ONLY
- **Tools/** - Executable scripts/tools ONLY
- **References/** - Extended reference material for large skills (API docs, detailed guides)

**Context files (documentation, guides, references) go in the skill ROOT or in References/.**

**When to use References/:** When SKILL.md exceeds ~500 lines and has substantial reference content (API signatures, detailed examples, troubleshooting guides). Keep SKILL.md as a routing guide; move encyclopedic content to References/.

### Why

1. **Discoverability** - Easy to find files
2. **Simplicity** - Less navigation overhead
3. **Speed** - Faster file operations
4. **Consistency** - Every skill follows same pattern

**If you need to organize many workflows, use clear filenames instead of subdirectories:**


---

## Dynamic Loading Pattern (Large Skills)

**For skills with SKILL.md > 100 lines:** Use dynamic loading to reduce context on skill invocation.

### How Loading Works

**Session startup:** Only frontmatter loads for routing
**Skill invocation:** Full SKILL.md loads
**Context files:** Load only when workflows reference them

### The Pattern

**SKILL.md** = Minimal (30-50 lines) - loads on skill invocation
- YAML frontmatter with triggers
- Brief description
- Workflow routing table
- Quick reference
- Pointers to context files

**Additional .md files** = Context files - SOPs for specific aspects (loaded on-demand)
- These are Standard Operating Procedures, not just documentation
- They provide specific handling instructions
- Can reference Workflows/, Tools/, etc.

### 🚨 CRITICAL: NO Context/ Subdirectory 🚨

**NEVER create Context/ or Docs/ subdirectories.**

Additional .md files ARE the context files. They live **directly in skill root**.

**WRONG:**
```
skills/Art/
├── SKILL.md
└── Context/              ❌ NEVER CREATE THIS
    └── Aesthetic.md
```

**CORRECT:**
```
skills/Art/
├── SKILL.md
├── Aesthetic.md          ✅ Context file in skill root
├── Examples.md           ✅ Context file in skill root
└── Tools.md              ✅ Context file in skill root
```

**The skill directory IS the context.**

### Example Structure

```
skills/Art/
├── SKILL.md              # 40 lines - minimal routing
├── Aesthetic.md          # Context file - SOP for aesthetic
├── Examples.md           # Context file - SOP for examples
├── Tools.md              # Context file - SOP for tools
├── Workflows/            # Workflows
│   └── Essay.md
└── Tools/                # CLI tools
    └── Generate.ts
```

### Minimal SKILL.md Template

```markdown
---
name: SkillName
description: Create, test, and optimize myos skills: scaffolding, effectiveness testing, description optimization. USE WHEN create skill, new skill, validate skill, test skill, improve skill, optimize description.
---

# SkillName

Brief description.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "trigger" | `Workflows/WorkflowName.md` |

## Quick Reference

**Key points** (3-5 bullet points)

**Full Documentation:**
- Detail 1: `Detail1.md` (read when the workflow needs it)
- Detail 2: `Detail2.md`
```

### When To Use

✅ **Use dynamic loading for:**
- SKILL.md > 100 lines
- Multiple documentation sections
- Extensive API reference
- Detailed examples

❌ **Don't use for:**
- Simple skills (< 50 lines)
- Pure utility wrappers (a tool in `MYOS/TOOLS/` is enough)

### Benefits

- **Token Savings:** 70%+ reduction on skill invocation (when full docs not needed)
- **Organization:** SKILL.md = routing, context files = SOPs for specific aspects
- **Efficiency:** Workflows load only what they actually need
- **Maintainability:** Easier to update individual sections


---


## Workflow Routing

### Structure Workflows (scaffolding and conventions)

| Workflow | Trigger | File |
|----------|---------|------|
| **CreateSkill** | "create a new skill" | `Workflows/CreateSkill.md` |
| **ValidateSkill** | "validate skill", "check skill" | `Workflows/ValidateSkill.md` |
| **UpdateSkill** | "update skill", "add workflow" | `Workflows/UpdateSkill.md` |
| **CanonicalizeSkill** | "canonicalize", "fix skill structure" | `Workflows/CanonicalizeSkill.md` |

### Effectiveness Workflows (testing and optimization)

| Workflow | Trigger | File |
|----------|---------|------|
| **TestSkill** | "test skill", "does this skill work", "skill not working" | `Workflows/TestSkill.md` |
| **ImproveSkill** | "improve skill", "skill quality", "fix skill instructions" | `Workflows/ImproveSkill.md` |
| **OptimizeDescription** | "optimize description", "skill not triggering", "trigger accuracy" | `Workflows/OptimizeDescription.md` |

## Skill Types (Choose Before Building)

Before creating any skill, identify which of the 9 types it is (from Anthropic's internal skill taxonomy, Thariq Shihipar, Mar 2026). The type shapes structure and testing decisions.

| Type | Focus | Key Structure | Example |
|------|-------|---------------|---------|
| 1. Library/API Reference | Gotchas, edge cases Claude gets wrong | Lightweight, gotchas-heavy, reference snippets | HonoReference, D1Reference |
| 2. Product Validation | Test/verify code works | State assertions, browser automation, output recording | Browser |
| 3. Data Fetching | Connect to data systems | Credential refs, query patterns, dashboard pointers | USMetrics, _METRICS |
| 4. Business Process | Automate repetitive workflows | Execution logs, consistency tracking | _CLICKUP, _BROADCAST |
| 5. Code Scaffolding | Generate framework boilerplate | Template files, project-aware scripts | CreateCLI, CreateSkill |
| 6. Code Quality | Enforce standards, review | Deterministic scripts, hook integration | /simplify, /code-review |
| 7. CI/CD & Deployment | Deploy with safety patterns | Pre-deploy checks, smoke tests, rollback | (gap, needs Deploy skill) |
| 8. Operations Runbooks | Map phenomena to diagnostics | Phenomenon → tool → query → report | _HEALTHCHECK |
| 9. Infrastructure Ops | Maintenance with safety guardrails | Safety gates, audit logging, orphan detection | _INBOX, _DOTFILES |

## Skill Writing Guidance

When writing or improving skill instructions, follow these principles from Anthropic's skill-creator methodology and Thariq Shihipar's "Lessons from Building Claude Code" (Mar 2026):

### Core Principles

- **Don't state the obvious.** Claude is competent at programming and knows codebases. Focus on information that **breaks Claude's default patterns**, things it gets wrong without guidance. Test: "Would Claude do this wrong without being told?" If not, remove it.
- **Explain the why, not just the what.** Models with good theory of mind + clear reasoning outperform models with rigid constraints. Instead of "ALWAYS use 3 bullets", explain why bullets matter for the audience.
- **Keep it lean.** The context window is a public good. Remove instructions that don't improve output. If test transcripts show the agent wasting time on unproductive steps, cut them. SKILL.md should be under 500 lines.
- **Cut intensifier-only lines.** Stating a rule once is the instruction. `MANDATORY`, `CRITICAL`, "not optional", and a third restatement add volume, not constraint: the model obeys specificity and code, not emphasis. Delete any line whose only content is shouting a rule stated elsewhere. Watch `## Best Practices` / `## Tips` sections: they collect default-restating filler ("be thorough", "keep it simple", "validate carefully"). Run the delete-test (`~/.myos/MYOS/RULES/Prompting.md`) on every line: cut it, and restore only if you can name the specific non-default behavior it forces.
- **Generalize, don't overfit.** Fix underlying patterns, not specific test failures. The skill will be used on many prompts beyond your test set.
- **Bundle repeated work.** If test agents all independently wrote similar helper scripts, add that script to Tools/ so every future invocation benefits.
- **Set appropriate degrees of freedom.** Match specificity to task fragility. Database migrations need exact commands; code reviews need general direction.
- **Don't over-constrain.** Skills are reused heavily. Avoid overly specific instructions. Provide needed information but leave flexibility for different contexts.

### Description Best Practices

- **Descriptions are for models, not humans.** The description is injected into the system prompt. Claude reads it to decide whether to invoke the skill.
- **Descriptions should be slightly pushy.** Models tend to undertrigger. Name specific scenarios even if the user might not explicitly mention the skill.
- **Include negative triggers for confusable skills.** Add "NOT FOR" clauses when skills share vocabulary: `"NOT FOR web pentesting (use WebAssessment)"`.
- **Undertriggering signals:** Skill doesn't load when it should, users manually invoking it.
- **Overtriggering signals:** Skill loads for irrelevant queries, users disabling it.

### Gotchas

- **Two `## Workflow Routing` headers exist in this file**: the first is inside the embedded template example, the second is the real one. Header-scanning tools must take the LAST match.
- **A description with an unquoted `: ` breaks strict YAML** (GitHub's renderer and `SkillFrontmatter.test.ts` both fail on it). Quote the whole description.
- **Descriptions cap at 1,024 characters.** Re-measure after every edit.
- **The em dash character is banned in every shipped file**, code and comments included. In TypeScript write the `\u2014` escape when the character itself is data.

## Execution Log

After completing any workflow, append a single JSONL entry:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"CreateSkill","workflow":"WORKFLOW_USED","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ~/.myos/MYOS/MEMORY/SKILLS/execution.jsonl
```

Replace `WORKFLOW_USED` with the workflow executed, `8_WORD_SUMMARY` with a brief input description, and `SECONDS` with approximate wall-clock time. Log `status: "error"` if the workflow failed.
