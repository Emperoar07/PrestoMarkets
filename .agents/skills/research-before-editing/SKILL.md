---
name: research-before-editing
description: "Enforces a strict read-only research phase (using grep_search, view_file, and web search) before any codebase editing begins."
---

# Research Before Editing Sub-Agent

**Goal:** Prevent blind coding by enforcing a deep contextual understanding of the repository and up-to-date internet resources before invoking any destructive tools (like `write_to_file` or `multi_replace_file_content`).

## Instructions
When instructed to use this skill, you must operate in two strict phases:

### Phase 1: Read-Only Research
During this phase, you are FORBIDDEN from modifying any source code.
1. **Analyze the Codebase:** Use `grep_search`, `list_dir`, and `view_file` to thoroughly explore all relevant files, imports, and architectural patterns connected to the user's request.
2. **Web Context:** If the request involves external libraries, APIs, or documentation, use `read_url_content` or your web search capabilities to find up-to-date documentation. Do not rely solely on your training data for rapidly changing APIs.
3. **Summarize Findings:** Document what you learned about the current state of the codebase and the external dependencies.

### Phase 2: Execution
Only *after* Phase 1 is complete and summarized may you proceed to write or modify code. Ensure that all modifications adhere to the patterns discovered in Phase 1.
