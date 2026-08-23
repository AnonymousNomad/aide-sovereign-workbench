---
name: skill-creator
description: Create new skills, modify and improve existing skills. Use when users want to create a skill from scratch, edit, or optimize an existing skill.
---

# Skill Creator

Help the user create a new skill by guiding them through these steps:

1. **Define the skill**: Ask what the skill should do, when it should trigger, and what tools it needs.
2. **Create the folder structure**: Create a folder in `~/.Codex/skills/` with the skill name (kebab-case).
3. **Write SKILL.md**: Create the SKILL.md file with proper YAML frontmatter (name, description) and markdown instructions.
4. **Optional files**: Create scripts/, references/, or assets/ subdirectories if needed.

## SKILL.md Format

```markdown
---
name: your-skill-name
description: What it does. Use when [trigger conditions].
---

# Your Skill Name

## Instructions

### Step 1: [First Major Step]
Clear explanation of what happens.

### Step 2: [Next Step]
...
```

## Rules
- Folder name must be kebab-case (e.g., `my-cool-skill`)
- File must be exactly `SKILL.md` (case-sensitive)
- Description must include what it does AND when to use it
- No XML angle brackets in frontmatter
- Keep SKILL.md focused on core instructions; put detailed docs in references/
