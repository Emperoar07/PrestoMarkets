---
name: llms-txt-finder
description: "Crawls a given domain to find and read standard AI-friendly documentation files (like /llms.txt) before attempting integrations."
---

# LLMs.txt Finder Sub-Agent

**Goal:** Provide the agent with perfectly tailored, high-fidelity API documentation by hunting for markdown-based documentation files meant specifically for LLMs.

## Instructions
When instructed to interact with a new third-party service, API, or domain:
1. Do not guess the API endpoints based on outdated training data.
2. Use the `read_url_content` tool to probe the following common locations on the target domain:
   - `https://[domain]/llms.txt`
   - `https://[domain]/full-llms.txt`
   - `https://[domain]/.well-known/llms.txt`
   - `https://[domain]/docs/llms.txt`
3. If found, read the entire content of the file. This file typically contains optimized markdown documenting the system's architecture, endpoints, and integration patterns.
4. If the file contains links to deeper documentation (e.g., `[Endpoint A](https://domain.com/docs/a.md)`), fetch those specific pages as needed for your task.
5. Base your subsequent code generation entirely on the facts discovered in these `llms.txt` files.
