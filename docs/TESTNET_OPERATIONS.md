# Testnet Operations Runbook

Quick reference for day-to-day operations on Presto Agent testnet.

## Daily Checks (Morning)

**5 minutes to complete:**

```bash
# 1. Check queue status
curl -s https://presto-markets.vercel.app/api/agents/queue/metrics \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.metrics'

# Expected: pending < 10, failed = 0, completed > yesterday

# 2. Check health
curl -s https://presto-markets.vercel.app/api/agents/orchestrate/health \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.health.status'

# Expected: "healthy"

# 3. Check agent wallet balance
curl https://arc-testnet-rpc.example.com -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x<agent-addr>","latest"],"id":1}' \
  | jq '.result | tonumber / 1e18'

# Expected: > 0.5 Arc tokens
```

## Common Tasks

### Task 1: Trigger Manual Market Creation

Use when you want to test a specific trend:

```bash
curl -X POST https://presto-markets.vercel.app/api/agents/orchestrate \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Will Bitcoin exceed $100k by end of year?",
    "source": "manual-test",
    "url": "https://example.com",
    "query": "Bitcoin price predictions for 2026"
  }'
```

**Expected response:**
```json
{
  "success": true,
  "requestId": "2026-05-27:will-bitcoin-exceed-100k-by-end-of-year",
  "result": { ... }
}
```

**Troubleshoot if failed:**
1. Check health: `GET /api/agents/orchestrate/health`
2. If provider error: wait 5-10 minutes for circuit breaker reset
3. If blockchain error: verify wallet balance + gas

### Task 2: Process Pending Queue Items

Manually trigger batch processing:

```bash
curl -X POST "https://presto-markets.vercel.app/api/agents/orchestrate/process-queue?limit=5" \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"
```

**Monitor progress:**
```bash
# Check remaining items
curl -s https://presto-markets.vercel.app/api/agents/queue/metrics \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.metrics.pending'
```

### Task 3: Inspect Failed Request

Check why a market creation failed:

```bash
# List dead letter queue
curl -s https://presto-markets.vercel.app/api/agents/queue/dead-letter \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.items'

# Or get specific request
curl -s https://presto-markets.vercel.app/api/agents/queue/{requestId} \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.item'
```

**Typical failures:**
- `"Safety check failed"` → Market doesn't meet safety requirements
- `"No LLM provider returned usable JSON"` → All providers failed/timed out
- `"Failed to verify market provenance"` → Blockchain issue
- `"Invalid market address"` → Deployment failed

### Task 4: Resubmit Failed Request

Retry a failed market creation:

```bash
curl -X POST "https://presto-markets.vercel.app/api/agents/queue/{requestId}/resubmit" \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxRetries": 3}'
```

**Check status:**
```bash
# Wait 1-2 minutes, then check
curl -s https://presto-markets.vercel.app/api/agents/queue/{requestId} \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.item.state'

# Should be "pending" → "processing" → "completed" or "failed"
```

### Task 5: View Graph Execution State

Inspect what's happening in graph orchestration:

```bash
# Start new graph execution
curl -X POST https://presto-markets.vercel.app/api/agents/graphs/start \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.state'

# Resume paused execution
curl -X POST "https://presto-markets.vercel.app/api/agents/graphs/{graphId}/resume" \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.state'

# View current state
curl -s "https://presto-markets.vercel.app/api/agents/graphs/{graphId}" \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.state.currentNode'
```

### Task 6: Check Cron Job Execution

View automated queue processing:

```bash
# View recent cron executions
vercel logs --follow | grep "cron-queue" | tail -20

# Expected pattern:
# [cron-queue] Starting autonomous queue processing
# [cron-queue] Purged 0 old queue items
# [cron-queue] Processing queue with X pending items
# [cron-queue] Queue processing complete: processed=X successful=Y
```

## Troubleshooting

### Problem: "All providers exhausted"

**Cause:** All LLM providers failed

**Steps:**
1. Check logs: `vercel logs | grep provider-pool`
2. Check provider health: `GET /api/agents/orchestrate/health`
3. Wait 5 minutes for circuit breaker reset
4. If still failing, check API keys in Vercel environment

**Fix:**
```bash
# Manually verify provider works
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-opus-4-1","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

### Problem: "Market creation stuck in processing"

**Cause:** Graph execution hanging or blockchain transaction pending

**Steps:**
1. Check graph state: `GET /api/agents/graphs/{graphId}`
2. Check queue metrics: `GET /api/agents/queue/metrics`
3. If stuck > 5 minutes, mark as failed and retry

**Fix:**
```bash
# Resume graph from current checkpoint
curl -X POST "https://presto-markets.vercel.app/api/agents/graphs/{graphId}/resume" \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"

# If still stuck, resubmit to queue
curl -X POST "https://presto-markets.vercel.app/api/agents/queue/{requestId}/resubmit" \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"
```

### Problem: "Wallet balance low"

**Cause:** Agent wallet running out of Arc tokens

**Steps:**
1. Check balance: `eth_getBalance` RPC call
2. Request more testnet tokens from faucet

**Fix:**
```bash
# Get current balance
BALANCE=$(curl https://arc-testnet-rpc.example.com -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x<addr>","latest"],"id":1}' \
  | jq '.result | tonumber / 1e18')

echo "Current balance: $BALANCE Arc"

# If < 0.5, request from faucet
# Go to: https://faucet.arc-testnet.example.com
```

### Problem: "Cron job not running"

**Cause:** Vercel cron not configured or failing

**Steps:**
1. Check cron logs: `vercel logs | grep cron-queue | tail -5`
2. Verify CRON_SECRET in Vercel env
3. Verify vercel.json has cron config

**Fix:**
```bash
# Manually trigger queue processing
curl -X POST "https://presto-markets.vercel.app/api/agents/orchestrate/process-queue?limit=3" \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"

# Check if function exists
curl https://presto-markets.vercel.app/api/cron/agent-queue \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Performance Expectations

### Market Creation Time

| Stage | Expected Time |
|-------|---|
| Queue → Graph Start | 1-2s |
| Graph Execution | 2-5s |
| Perceive | 2-5s |
| Analyze | 3-8s |
| Plan (LLM) | 5-15s |
| Authorize (LLM) | 3-5s |
| Execute (Blockchain) | 10-30s |
| Verify | 5-10s |
| **TOTAL** | **30-80s** |

**If latency > 120s:**
- Check provider response times (usually the culprit)
- Check blockchain congestion
- Check logs for timeouts

### Queue Processing Rate

**Autonomous (cron):**
- 3 markets per cron execution (every 10 min)
- = ~18 markets/hour capacity

**Manual (on-demand):**
- Limited by: provider rate limits, blockchain confirmation time, LLM provider latency
- Typical: 2-5 markets/minute

## Disaster Recovery

### If Testnet Goes Down

```bash
# 1. Check Vercel status
vercel status

# 2. Check recent logs for errors
vercel logs --tail 100 | grep -E "ERROR|FATAL"

# 3. Check environment variables
vercel env list

# 4. Redeploy if needed
git push origin main  # Triggers automatic deployment

# 5. Verify deployment successful
curl https://presto-markets.vercel.app/api/agents/orchestrate/health \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"
```

### If Arc Testnet Goes Down

```bash
# Check Arc status
# https://status.arc-testnet.example.com

# Check RPC connectivity
curl https://arc-testnet-rpc.example.com \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}'

# If down, queue will accumulate. Once back:
curl -X POST "https://presto-markets.vercel.app/api/agents/orchestrate/process-queue?limit=5" \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"
```

## Weekly Checklist

Every Monday (or your chosen day):

- [ ] Review queue metrics from past week
- [ ] Check provider performance (latency, success rates)
- [ ] Verify wallet still has sufficient balance
- [ ] Review logs for any ERROR/FATAL entries
- [ ] Test manual market creation flow
- [ ] Check dead letter queue - any patterns?
- [ ] Verify cron jobs executed as expected
- [ ] Document any issues found

## Quick Commands Reference

```bash
# Health check (3 commands)
curl -s https://api.presto/agents/queue/metrics -H "Auth: $TOKEN" | jq '.metrics'
curl -s https://api.presto/agents/orchestrate/health -H "Auth: $TOKEN" | jq '.health'
vercel logs | grep -E "ERROR|WARN" | head -5

# Queue operations
curl -s https://api.presto/agents/queue/metrics -H "Auth: $TOKEN"           # metrics
curl -s https://api.presto/agents/queue/dead-letter -H "Auth: $TOKEN"       # failures
curl -X POST https://api.presto/agents/orchestrate/process-queue -H "Auth: $TOKEN"  # process

# Manual triggers
curl -X POST https://api.presto/agents/orchestrate -H "Auth: $TOKEN" \
  -d '{"topic":"...","source":"test"}' # create market
curl -X POST https://api.presto/agents/orchestrate/process-one -H "Auth: $TOKEN"    # process 1

# Logs
vercel logs --follow                    # real-time
vercel logs | grep orchestrator         # filter
vercel logs > backup-$(date +%Y%m%d).txt # export
```

## Getting Help

**For provider failures:**
- Check provider status page
- Check API key validity
- Review provider logs

**For blockchain failures:**
- Check Arc testnet explorer
- Verify wallet has gas
- Check if contract deployed correctly

**For LLM quality issues:**
- Review market that was rejected by safety check
- Adjust market draft parameters
- Check if safety threshold too high

**For queue/cron issues:**
- Check Vercel logs: `vercel logs`
- Verify environment variables set
- Check CRON_SECRET matches
