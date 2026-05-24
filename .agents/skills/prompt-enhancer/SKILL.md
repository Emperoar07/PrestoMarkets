---
name: prompt-enhancer
description: "Takes a normal user prompt and refines it into a clear, actionable plan before sending it to the main execution agent."
---

# Prompt Enhancer Sub-Agent

**Goal:** Transform ambiguous or underspecified user requests into rigorous, highly detailed specifications before any code is written or tools are used.

## Instructions
1. When a user provides a high-level or ambiguous prompt, invoke this skill mentally.
2. Do not immediately jump into writing code or modifying files.
3. Deconstruct the user's request:
   - What is the explicit goal?
   - What are the implicit requirements (e.g., performance, accessibility, security)?
   - What edge cases could break this feature?
   - What files or architectural patterns are likely affected?
4. Output the enhanced prompt as a structured "Specification".
5. Use the newly generated specification as your strict mental guide for the remainder of the task.

## Example Output Format
```markdown
### Original Intent
[Brief summary of what the user asked for]

### Enhanced Specification
- **Core Requirements:** [Bullet points of exactly what must be built]
- **Implicit Constraints:** [Security, performance, architectural rules]
- **Edge Cases to Handle:** [List potential failure modes]
- **Execution Strategy:** [Step-by-step plan for the main agent]
```
