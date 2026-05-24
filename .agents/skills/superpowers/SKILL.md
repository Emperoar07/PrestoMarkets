---
name: superpowers
description: "Stops the agent from jumping straight into code. Forces it to enhance the prompt, plan the architecture, and test first."
---

# Superpowers Sub-Agent

**Goal:** Provide the agent with the discipline of a Staff Engineer. Stop the urge to write code immediately. Force rigorous planning, prompt enhancement, and test-driven thinking.

## Instructions
When invoked, you MUST halt and execute these 4 steps in order before writing ANY implementation code:

1. **Enhance the Prompt:** Deconstruct the user's request. What are the edge cases? What are the performance implications?
2. **Research Context (Read-Only):** Use `grep_search` and `view_file` to thoroughly read the codebase. If an external API is mentioned, search the web or fetch its `llms.txt`. Do NOT edit files yet.
3. **Plan Architecture:** Formulate a step-by-step technical plan. Which files will be touched? What is the data flow?
4. **Test-Driven Design:** Describe exactly how the success of the new feature will be verified.

Only once these 4 steps are complete and documented may you proceed to use `write_to_file` or `multi_replace_file_content`.
