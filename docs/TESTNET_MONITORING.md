# Testnet Monitoring & Observability Guide

## Overview

Comprehensive monitoring setup for Presto Agent testnet deployment. Tracks agent health, queue processing, provider status, and market creation success rates.

## Metrics to Monitor

### 1. Queue Depth (Critical)

**Endpoint:** `GET /api/agents/queue/metrics`

```bash
# Check every 5 minutes
curl -s https://presto-markets.vercel.app/api/agents/queue/metrics \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.'
```

**Expected Response:**
```json
{
  "total": 5,
  "pending": 2,
  "processing": 0,
  "completed": 3,
  "failed": 0,
  "retrying": 0,
  "avgRetries": 0.2
}
```

**Healthy Thresholds:**
- ✅ pending < 10 (not accumulating)
- ✅ failed = 0 (no permanent failures)
- ✅ completed > 0 (making progress)
- ⚠️ processing < 2 (not stuck)

### 2. Orchestrator Health (Critical)

**Endpoint:** `GET /api/agents/orchestrate/health`

```bash
# Check every 5 minutes
curl -s https://presto-markets.vercel.app/api/agents/orchestrate/health \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" | jq '.health'
```

**Expected Response:**
```json
{
  "status": "healthy",
  "providerHealth": [
    {
      "provider": "anthropic",
      "status": "healthy"
    }
  ],
  "queueDepth": 2,
  "timestamp": "2026-05-27T..."
}
```

**Alert Thresholds:**
- 🔴 `status: "error"` → Immediate investigation
- 🟡 `status: "degraded"` → Provider issues detected
- 🔴 `queueDepth > 50` → Queue backing up

### 3. Market Creation Rate

**Endpoint:** `GET /api/agents/queue/metrics`

Track `completed` over time:

```bash
# Every hour, log metrics
{
  "timestamp": "2026-05-27T14:00:00Z",
  "completed": 5,
  "failed": 0,
  "totalCreated": 25
}
```

**Expected Rate:**
- Testnet: 1-3 markets/hour (low volume for testing)
- Should increase as we add more trends

### 4. Cron Job Execution

**Endpoint:** Check Vercel logs

```bash
# View cron job results in Vercel logs
vercel logs --follow | grep -i "cron-queue\|agent-queue"
```

**Expected:**
```
2026-05-27T14:00:00.000Z [cron-queue] Starting autonomous queue processing
2026-05-27T14:00:15.000Z [cron-queue] Queue processing complete: processed=2 successful=2
2026-05-27T14:10:00.000Z [cron-queue] Starting autonomous queue processing
```

**Alert if:**
- ❌ No cron executions in 15 minutes
- ❌ Cron job takes > 45 seconds (timeout limit is 60s)
- ❌ Multiple consecutive failures

## Logging Strategy

### Log Levels

```
ERROR   - Unrecoverable failures (permanent market creation failure)
WARN    - Recoverable issues (provider timeout, retry scheduled)
INFO    - Normal operations (market created, queue processed)
DEBUG   - Detailed tracing (individual stage execution)
```

### Key Log Patterns

**Watch for success patterns:**
```
[orchestrator] Starting market creation orchestration: {requestId}
[orchestrator] Request enqueued
[agent-graph] Starting graph execution
[agent-stages] Stage 1: Perceive - fetching trends
... (stages 2-6)
[orchestrator] Market creation completed successfully
```

**Watch for failure patterns:**
```
[orchestrator] Market creation failed: {error}
[agent-stages] Stage 3 failed: Plan
[provider-pool] All providers exhausted
[agent-queue] Request failed permanently: {error}
```

### Log Aggregation Setup

**Option 1: Vercel Built-in Logs**
```bash
# Stream logs in real-time
vercel logs --follow

# Filter by component
vercel logs --follow | grep orchestrator

# Export to file
vercel logs > vercel-logs-$(date +%Y-%m-%d).txt
```

**Option 2: Cloudflare Logpush (if using Cloudflare)**
```bash
# Setup Logpush to external storage
# See: https://developers.cloudflare.com/logs/
```

**Option 3: Custom Logging Endpoint**

Could add endpoint to export logs:
```
GET /api/logs?component=orchestrator&since=1h&limit=1000
```

## Monitoring Dashboard

### Manual Monitoring Script

```bash
#!/bin/bash
# monitor-testnet.sh

TOKEN=$MCP_AGENT_TOKEN
API=https://presto-markets.vercel.app

echo "=== Presto Agent Testnet Monitoring ==="
echo "Timestamp: $(date)"

echo -e "\n--- Queue Status ---"
curl -s "$API/api/agents/queue/metrics" \
  -H "Authorization: Bearer $TOKEN" | jq '.metrics'

echo -e "\n--- Orchestrator Health ---"
curl -s "$API/api/agents/orchestrate/health" \
  -H "Authorization: Bearer $TOKEN" | jq '.health'

echo -e "\n--- Dead Letter Queue ---"
curl -s "$API/api/agents/queue/dead-letter" \
  -H "Authorization: Bearer $TOKEN" | jq '.count'

echo -e "\nNext check in 5 minutes..."
```

**Run continuously:**
```bash
chmod +x monitor-testnet.sh
watch -n 300 ./monitor-testnet.sh  # Every 5 minutes
```

## Alert Rules for Testnet

### Critical Alerts (Page Immediately)

```
IF status == "error" 
THEN page oncall with: "Agent health check FAILED: {status_details}"

IF queueDepth > 100 AND processing < 1 
THEN page oncall with: "Queue stuck: {queueDepth} pending items, nothing processing"

IF failed_count > 5 
THEN page oncall with: "Multiple market creations failed: {latest_error}"
```

### Warning Alerts (Create Ticket)

```
IF status == "degraded" 
THEN ticket: "Agent degraded: {provider_status}"

IF avgRetries > 2 
THEN ticket: "High retry rate: {avgRetries} retries per request"

IF queueDepth > 20 AND queueDepth < 100 
THEN ticket: "Queue backing up: monitor closely"
```

### Informational Logging

```
WHEN market_created 
LOG: "Market created: {marketId} from trend: {topic} (provider: {provider}, latency: {latency}ms)"

WHEN provider_fails 
LOG: "Provider failed: {provider} retrying with fallback"

WHEN cron_completes 
LOG: "Cron completed: {processed} items, {successful} succeeded"
```

## Performance Metrics

### Market Creation Latency

**Target: < 60 seconds end-to-end**

Break down by stage:
```
Perceive    → 2-5s   (fetch trends)
Analyze     → 3-8s   (classify)
Plan        → 5-15s  (LLM draft)
Authorize   → 3-5s   (LLM safety check)
Execute     → 10-30s (blockchain tx)
Verify      → 5-10s  (confirmation)
─────────────────────
TOTAL       → 30-80s
```

**If latency > 90s:**
- Check provider response times
- Check blockchain gas situation
- Check for timeouts in logs

### Provider Response Times

Track per-provider latency:

```json
{
  "anthropic": {
    "avgLatency": 4200,
    "p95Latency": 8500,
    "p99Latency": 12000,
    "successRate": 0.98
  }
}
```

**Healthy thresholds:**
- ✅ avgLatency < 5000ms
- ✅ p99Latency < 15000ms
- ✅ successRate > 0.95

## Failure Recovery

### Common Issues & Recovery

**Issue: Queue depth increasing**
```
Diagnosis:
1. Check health: GET /api/agents/orchestrate/health
2. Check failed items: GET /api/agents/queue/dead-letter
3. Check logs: vercel logs | grep error

Recovery:
1. If provider error: wait for provider to recover (circuit breaker opens for 5min)
2. If blockchain error: check Arc testnet status
3. If LLM error: fallback should have triggered - verify in logs
```

**Issue: Cron job not running**
```
Diagnosis:
1. Check Vercel cron logs: vercel logs | grep cron-queue
2. Verify CRON_SECRET is set
3. Check Vercel deployment status

Recovery:
1. Trigger manually: POST /api/agents/orchestrate/process-queue?limit=5
2. Check if cron is configured in vercel.json
3. Redeploy if needed
```

**Issue: Market creation failing**
```
Diagnosis:
1. Check orchestrator health
2. Check queue metrics
3. Inspect failed item: GET /api/agents/queue/{requestId}

Recovery:
1. If safety gate rejected: examine market and adjust parameters
2. If blockchain failed: verify wallet has sufficient funds
3. If provider failed: check provider metrics for circuit breaker
```

## Testnet-Specific Considerations

### Low-Volume Testing

Testnet expects low volume (1-3 markets/hour). Don't be alarmed by:
- ✅ Long gaps between market creations (normal for testing)
- ✅ Single provider serving all requests (no fallback needed yet)
- ✅ High retry rates during testing (expected)

### Cost Monitoring

Track Arc token spending:

```bash
# Check agent wallet balance
curl https://arc-testnet-rpc.example.com \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_getBalance",
    "params":["0x<agent-address>","latest"],
    "id":1
  }' | jq '.result | tonumber / 1e18'
```

**Expected gas per market: 0.01-0.1 Arc**

### Testing Failure Scenarios

Before moving to mainnet, test:
- [ ] Provider circuit breaker (disable provider, verify fallback)
- [ ] Blockchain failure (send transaction to non-existent contract)
- [ ] Queue retry logic (simulate transient failure, verify retry)
- [ ] Timeout handling (slow LLM response, verify timeout)
- [ ] Dead letter recovery (resubmit failed request)

## Metrics Export (for future)

Ready for integration with external monitoring:

```bash
# Export metrics as Prometheus format
GET /api/metrics?format=prometheus

# Would return:
agent_queue_depth{status="pending"} 2
agent_queue_depth{status="completed"} 25
agent_provider_latency{provider="anthropic"} 4200
agent_market_creation_success_rate 0.98
```

## Summary

**Quick Health Check (3 endpoints):**

```bash
# 1. Queue depth
curl -s https://api.presto/agents/queue/metrics -H "Auth: $TOKEN" | jq '.metrics | {total, pending, failed}'

# 2. Orchestrator health
curl -s https://api.presto/agents/orchestrate/health -H "Auth: $TOKEN" | jq '.health.status'

# 3. Check logs
vercel logs --follow | grep -E "ERROR|WARN" | head -5
```

**If all three look good, testnet is healthy.** ✅
