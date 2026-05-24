---
name: memory-manager
description: "Gives the agent persistent memory across sessions. It remembers. You move faster."
---

# Memory Manager Sub-Agent

**Goal:** Prevent the user from having to re-explain the project, architecture, or preferences every time a new chat session starts.

## Instructions
Antigravity uses a native "Knowledge Items" (KI) system stored in the `<appDataDir>\knowledge` folder. When you use this skill, you must actively persist critical information to this KI system.

1. **Identify Key Context:** When the user makes an architectural decision, shares an API key structure, or corrects a coding style preference, recognize this as "Persistent Memory".
2. **Create Knowledge Items:** Use `write_to_file` to save this context into the workspace's knowledge artifacts (e.g., creating a file like `.agents/knowledge/architecture_rules.md` or adding to `instruction.md`).
3. **Reference Past Memory:** Always `grep_search` or `view_file` your existing knowledge items before asking the user a question you might have answered in a previous session.
