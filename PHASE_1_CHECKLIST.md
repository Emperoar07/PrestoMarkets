# Phase 1: Secret Rotation & Git Cleanup — Implementation Checklist

## Phase 1.1: Rotate All Exposed Secrets in Vercel ✋ MANUAL STEP REQUIRED

**Timeline:** ~20-30 minutes  
**Risk Level:** LOW — creating new secrets, not breaking anything  
**Status:** Waiting for user action

### Step-by-Step Instructions

1. **Navigate to Vercel Dashboard**
   - Go to: https://vercel.com/dashboard
   - Select project: **presto-markets**
   - Go to: Settings → Environment Variables

2. **For EACH secret below: Create NEW value, then delete OLD**

   **Critical Agent Secrets (Must rotate first):**
   - [ ] `AGENT_PRIVATE_KEY`
     - Old value: starts with `0x3b9c7145...`
     - Action: Delete old, add new (generate fresh private key)
     - Validation: New key is different from old value
   
   - [ ] `PRESTO_AGENT_API_KEY`
     - Old value: starts with `3423c96e...`
     - Action: Delete old, generate new random API key
     - Validation: Update local `.env.local` with new value before testing

   **LLM Provider Keys (High priority):**
   - [ ] `ANTHROPIC_API_KEY` (Claude API)
   - [ ] `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` (Google)
   - [ ] `GROQ_API_KEY` (Groq)
   - [ ] `OPENROUTER_API_KEY` (OpenRouter)
   - [ ] `CEREBRAS_API_KEY` (Cerebras)
   - [ ] `TOGETHER_API_KEY` (Together AI)

   **Circle Secrets (Medium priority):**
   - [ ] `CIRCLE_API_KEY`
   - [ ] `CIRCLE_ENTITY_SECRET`

   **Infrastructure Secrets (Medium priority):**
   - [ ] `CRON_SECRET` (Generate new random Bearer token)
   - [ ] `VERCEL_TOKEN` (Regenerate in Vercel account settings)

   **Data/Service Keys (Medium priority):**
   - [ ] `SERPER_API_KEY` (Google Serper)
   - [ ] `XAI_API_KEY` (Grok/X AI)
   - [ ] `COINGECKO_API_KEY` (CoinGecko)
   - [ ] `COINMARKETCAP_API_KEY` (CoinMarketCap)

3. **After Creating New Values:**
   ```bash
   # Copy each new secret value and update local .env.local
   # This file will be deleted in Phase 1.2
   AGENT_PRIVATE_KEY=<new-value>
   PRESTO_AGENT_API_KEY=<new-value>
   # ... etc
   ```

4. **Validation Checklist:**
   - [ ] All 15+ secrets have been rotated in Vercel
   - [ ] Local `.env.local` updated with new values
   - [ ] Old secrets have been DELETED (not just overwritten)
   - [ ] No old secret values visible in Vercel dashboard

### Quick Health Check (After Rotation)

Run these commands to verify rotation worked:

```bash
# Test agent market creation with new API key
curl -X POST http://localhost:3000/api/agents/markets/create \
  -H "x-api-key: $PRESTO_AGENT_API_KEY" \
  -H "content-type: application/json" \
  -d '{"title":"Test Market",...}'
# Should return 200 OK (not 401 Unauthorized)

# Test cron auth with new CRON_SECRET
curl -X POST http://localhost:3000/api/cron/market-factory \
  -H "Authorization: Bearer $CRON_SECRET"
# Should return 200 OK (not 401)
```

### Risk Assessment
- **Breaking risk:** LOW
  - New environment variables are created before old ones deleted
  - Services only use new values after Vercel redeploys
  - No downtime required

- **Rollback:** If something breaks
  - Restore old secret values in Vercel
  - Vercel redeploys (automatic)
  - Services resume working with old credentials
  - Then investigate what failed before retrying rotation

---

## Phase 1.2: Remove Secrets from Git History 🚨 DESTRUCTIVE — REQUIRES CONFIRMATION

**Timeline:** ~10-15 minutes  
**Risk Level:** MEDIUM — rewrites git history (not reversible)  
**Status:** Waiting for user confirmation

### What This Does

Permanently removes `.env.local` and `.env.smoke.local` from ALL commits in the git history.

**After this step:**
- No one can ever see old secrets by checking out old commits
- GitHub will show git history was modified
- Team members will need to rebase their branches

### Prerequisites (Before Running)

- [x] All secrets rotated in Vercel (Phase 1.1 complete)
- [x] Local `.env.local` backed up or no longer needed
- [x] Team notified that git history will be rewritten
- [ ] Ready to force-push to origin/main

### Detailed Steps

**Step 1: Backup current branch**
```bash
git branch backup-before-filter
echo "Backup created at: backup-before-filter"
```

**Step 2: Remove .env files from entire history**
```bash
git filter-branch --tree-filter 'rm -f .env.local .env.smoke.local' -f HEAD
```

What this does:
- Rewrites every commit in the history
- Removes both files from every commit they appear in
- Creates new commit hashes (history changes)

**Step 3: Verify they're gone**
```bash
# Should return empty output
git log --name-only --oneline | grep ".env"

# Should return empty output
git log --all -- .env.local
git log --all -- .env.smoke.local
```

**Step 4: Update .gitignore to prevent re-accident**
```bash
# Add to .gitignore
echo ".env.local" >> .gitignore
echo ".env.smoke.local" >> .gitignore
echo ".env" >> .gitignore

# Commit the change
git add .gitignore
git commit -m "Add .env files to gitignore to prevent future secret leaks"
```

**Step 5: Force-push to origin (⚠️ This is destructive)**
```bash
# This OVERWRITES the remote history
# All team members will need to rebase
git push origin main --force-with-lease

# Verify push succeeded
git log origin/main -n 1 --oneline
```

### After Force-Push: Team Communication

**Notify your team:**

> ⚠️ **Git history was rewritten on main**
> 
> Secrets were exposed in .env.local. History has been cleaned with `git filter-branch`.
> 
> **If you have local branches:**
> ```bash
> git fetch origin
> git rebase origin/main  # Or git pull --rebase
> ```
> 
> **If you have unpushed commits:**
> Do NOT force-push. Rebase on top of the new origin/main instead.

---

## ✅ Success Criteria

After completing Phase 1:

- [ ] All secrets rotated in Vercel
- [ ] New secrets tested and working (agent creates markets, cron runs, etc.)
- [ ] `.env.local` and `.env.smoke.local` REMOVED from git history
- [ ] No `.env*` files appear in `git log --all --name-only`
- [ ] `.gitignore` includes `.env.local`, `.env.smoke.local`, `.env`
- [ ] Team has been notified about git history rewrite

---

## What's Next (After Phase 1)

Once Phase 1 is complete:

1. **Phase 2** (4-6 hours): Factory allowlist + Resolver validation
   - Add security checks to Circle contract execution
   - Prevent agent resolver redirection

2. **Phase 3** (4-6 hours): Request timeouts
   - Add timeout protection to LLM providers
   - Add timeout protection to Serper API

3. **Phase 4+**: Logging, type safety, identity verification

---

## Questions?

If anything fails during Phase 1:

1. Check that new secrets are correct in Vercel
2. Verify local `.env.local` matches Vercel values
3. Check that old secret values are actually DELETED (not just overwritten)
4. If needed, rollback by restoring old secrets in Vercel
