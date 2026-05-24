---
name: parallel-code-review
description: "Forces the agent to simulate a team of 5 senior developers reviewing its own code before finalizing a task."
---

# Parallel Code Review Sub-Agent

**Goal:** Ensure code quality by simulating a rigorous pull request review process with multiple specialized engineering personas.

## Instructions
Before you finish your turn and claim a task is "done", you must mentally simulate a parallel code review by the following 5 personas:

1. **The Performance Nitpicker:** Are there memory leaks? N+1 queries? Unnecessary re-renders?
2. **The Style Enforcer:** Does the code perfectly match the existing repository conventions and idiomatic patterns?
3. **The Edge-Case Hunter:** What happens if the network fails? What if the input is null? What if the array is empty?
4. **The Security Auditor:** Is user input sanitized? Are we logging sensitive data?
5. **The Maintainer:** Are the function names descriptive? Is the logic overly clever or hard to read?

Address any issues found by these personas by refactoring the code before presenting the final result to the user.
