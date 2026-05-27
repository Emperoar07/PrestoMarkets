# Testnet Deployment Guide - Presto Agent on Arc

## Prerequisites

- Agent private key with Arc testnet funds (for gas + initial markets)
- Arc testnet RPC endpoint configured
- Circle testnet credentials (for wallet integration)
- MCP_AGENT_TOKEN generated (strong, random)

## Environment Configuration

### Step 1: Generate Agent Private Key

```bash
# Generate new private key for testnet agent
openssl rand -hex 32
# Output: abc123def456... (save this securely)

# Add to environment (Vercel or local .env.local):
AGENT_PRIVATE_KEY=0xabc123def456...
```

**⚠️ Safety Note:** Never reuse mainnet keys on testnet. Generate a fresh key for testing.

### Step 2: Configure Arc Testnet

Update `.env.local` or Vercel environment:

```env
# Arc Testnet Configuration
NEXT_PUBLIC_ARC_CHAIN_ID=42
NEXT_PUBLIC_ARC_RPC_URL=https://arc-testnet-rpc.example.com
NEXT_PUBLIC_ARC_EXPLORER=https://arc-testnet.example.com

# Presto Contracts (deploy or use existing on testnet)
NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_MARKET_REGISTRY_ADDRESS=0x...

# Agent Configuration
AGENT_PRIVATE_KEY=0x... (testnet key)
PRESTO_AGENT_RESOLVER_ADDRESS=0x... (agent wallet address)
PRESTO_AGENT_API_KEY=presto-agent-testnet-key
PRESTO_AGENT_PER_RUN_CAP=1
PRESTO_AGENT_ACTIVE_MARKET_CAP=5

# Circle Testnet
CIRCLE_API_KEY=your-circle-testnet-key
CIRCLE_ENTITY_SECRET=your-entity-secret

# MCP Security
MCP_AGENT_TOKEN=<strong-random-token> # e.g., openssl rand -hex 32

# LLM Providers
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 3: Fund Agent Wallet

The agent wallet needs Arc tokens for gas. Get testnet tokens from:
- Arc testnet faucet: https://faucet.arc-testnet.example.com
- Request minimum 1 Arc (or adjusted gas estimate)

```bash
# Verify funding
curl https://arc-testnet-rpc.example.com \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x<agent-address>","latest"],"id":1}'
```

## Deployment Steps

### Step 1: Deploy to Vercel (Staging)

```bash
# Configure environment in Vercel dashboard
# Project Settings → Environment Variables

# Deploy
git push origin main  # Triggers automatic deployment
```

Verify deployment:
```bash
curl https://presto-markets-staging.vercel.app/api/agents/orchestrate/health \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"
```

Expected response:
```json
{
  "success": true,
  "health": {
    "status": "healthy",
    "queueDepth": 0,
    "timestamp": "2026-05-27T..."
  }
}
```

### Step 2: Manual Test - Trigger Market Creation

```bash
# Test trend submission
curl -X POST https://presto-markets-staging.vercel.app/api/agents/orchestrate \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Will Arc mainnet launch by Q3 2026?",
    "source": "testnet-manual",
    "url": "https://example.com/arc-launch",
    "query": "Arc blockchain mainnet launch timeline"
  }'
```

Expected response:
```json
{
  "success": true,
  "requestId": "2026-05-27:will-arc-mainnet-launch-by-q3-2026",
  "result": {
    "graphState": { ... },
    "pipelineResults": [ ... ]
  }
}
```

### Step 3: Monitor Queue Processing

```bash
# Check queue metrics
curl https://presto-markets-staging.vercel.app/api/agents/queue/metrics \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"

# Process pending items
curl -X POST https://presto-markets-staging.vercel.app/api/agents/orchestrate/process-queue \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" \
  -d '{"limit": 5}'

# Check dead letter queue
curl https://presto-markets-staging.vercel.app/api/agents/queue/dead-letter \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN"
```

### Step 4: Verify Onchain Execution

```bash
# Query markets created by agent
curl https://presto-markets-staging.vercel.app/api/v1/markets?creator=agent

# Verify market details
curl https://presto-markets-staging.vercel.app/api/v1/markets/<marketId>
```

## Testing Checklist

- [ ] Agent wallet funded (verify balance > 0)
- [ ] Environment variables set (all critical ones)
- [ ] Deployment successful (build passes)
- [ ] Health check returns healthy status
- [ ] Manual trend submission queues successfully
- [ ] Queue processing triggers orchestrator
- [ ] Graph execution completes
- [ ] Market created onchain with correct metadata
- [ ] Safety checks reject bad markets (test with intentional failures)
- [ ] Provider fallback works (test with disabled provider)
- [ ] Retry logic works (test with transient failures)
- [ ] Dead letter queue handles permanent failures

## Failure Recovery

### If Market Creation Fails:

1. Check queue metrics:
   ```bash
   curl https://.../api/agents/queue/metrics \
     -H "Authorization: Bearer $TOKEN"
   ```

2. Inspect failed request:
   ```bash
   curl https://.../api/agents/queue/dead-letter \
     -H "Authorization: Bearer $TOKEN"
   ```

3. Resubmit failed request:
   ```bash
   curl -X POST https://.../api/agents/queue/{requestId}/resubmit \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"maxRetries": 3}'
   ```

### If Graph Execution Hangs:

- Check checkpoint: `GET /api/agents/graphs/{graphId}`
- Resume from checkpoint: `POST /api/agents/graphs/{graphId}/resume`
- Increase timeout in agentPipeline.ts if needed

### If Provider Calls Fail:

- Check provider metrics: `GET /api/agents/orchestrate/health`
- Provider circuit breaker opens after 3 failures (5min window)
- Fallback to next provider automatically
- Monitor provider latency in metrics

## Monitoring During Testnet

### Key Metrics to Watch

```bash
# Every 5 minutes, check:
1. Queue depth (pending + retrying items)
2. Provider health (success rate per provider)
3. Graph execution latency (p50, p95, p99)
4. Market creation success rate

# Run monitoring script:
while true; do
  curl https://.../api/agents/orchestrate/health \
    -H "Authorization: Bearer $TOKEN" | jq '.health'
  sleep 300
done
```

### Logs to Monitor

```bash
# Real-time log tailing (if using Vercel logs):
vercel logs --follow --since 1h

# Filter by agent:
vercel logs --follow | grep -E "agent|orchestrat|queue"
```

## Next Steps After Successful Testnet

1. **Load Testing:** Simulate 10+ concurrent market creations
2. **Failure Scenarios:** Test all error paths (network, LLM, blockchain)
3. **Performance Optimization:** Profile critical paths, optimize if needed
4. **Security Audit:** Code review of agent wallet operations
5. **Mainnet Readiness:** Prepare mainnet contracts, keys, funding

## Rollback Plan

If critical issues found on testnet:

```bash
# Revert to previous commit
git revert <commit-hash>
git push origin main

# Or deploy from specific tag
git checkout tags/v1.0.0
npm run build
# Deploy to Vercel
```

## Support & Debugging

For issues during testnet:

1. Check logs: `vercel logs`
2. Inspect queue: `GET /api/agents/queue`
3. Review graph state: `GET /api/agents/graphs/{graphId}`
4. Check provider health: `GET /api/agents/orchestrate/health`
5. Verify onchain: View market contract on Arc testnet explorer
