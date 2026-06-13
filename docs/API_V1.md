# Presto Markets Public API v1 Documentation

This document defines and locks the public JSON schemas for `/api/v1/*` endpoints. All public endpoints are wrapped in a uniform `{ apiVersion: 1, data: ... }` envelope.

---

## 1. Market Schema (`MarketV1`)

Represents a parimutuel prediction or opinion market.

### Fields

* `id` (`string`): On-chain market contract address.
* `title` (`string`): Clean title of the market.
* `description` (`string`): Long form rules and details.
* `category` (`string`): Primary classification category.
* `categories` (`string[]`): Full list of taxonomy categories.
* `type` (`"Prediction" | "Opinion"`): The market mechanism type.
* `displayType` (`string`): Recommended layout style (`binary`, `multi_outcome`, etc.).
* `status` (`string`): Market state (`Open`, `Closing soon`, `Closed`, `Resolved`, `Canceled`).
* `volume` (`string`): Total USDC volume formatted as a string.
* `closeLabel` (`string`): Plain text representation of market closing time.
* `imageURI` (`string` | `undefined`): Banner image location.
* `collateral` (`"USDC"`): Settlement collateral.
* `outcomes` (`Array`): Per-outcome odds:
  * `label` (`string`): Yes/No or custom labels.
  * `odds` (`number`): Outcome odds percentage (0..100).
  * `probability` (`number`): Outcome implied probability (0..1).
* `outcomeOptions` (`string[]` | `undefined`): Option labels for non-binary markets.
* `sourceOfTruth` (`string`): Verifiable data source description.
* `rules` (`string`): Market resolution rule descriptions.
* `createdByType` (`"user" | "admin" | "agent"`): Who created this market.
* `agent` (`object | null`): Diagnostics if created by the AI agent.

### Example Payload

```json
{
  "apiVersion": 1,
  "data": {
    "id": "0x1234567890abcdef1234567890abcdef12345678",
    "title": "Will the AI agent complete this task?",
    "description": "Resolves YES if task is completed successfully.",
    "category": "Technology",
    "categories": ["Technology", "AI"],
    "type": "Prediction",
    "displayType": "binary",
    "status": "Open",
    "volume": "150.00",
    "closeLabel": "June 15, 2026",
    "collateral": "USDC",
    "outcomes": [
      { "label": "YES", "odds": 72.5, "probability": 0.725 },
      { "label": "NO", "odds": 27.5, "probability": 0.275 }
    ],
    "sourceOfTruth": "GitHub commit logs",
    "rules": "Must pass tsc and vitest validation.",
    "createdByType": "agent",
    "agent": {
      "name": "Presto Market Agent",
      "confidence": "72%"
    }
  }
}
```

---

## 2. Leaderboard Schema (`LeaderboardRowV1`)

List of users ranked by PnL, accuracy, or markets created.

### Fields

* `address` (`string`): Lowercase Web3 wallet address.
* `period` (`string`): Historical period (`all`, `30d`).
* `realizedPnl` (`string`): Net realized USDC gains as a string.
* `marketsTraded` (`number`): Number of unique markets traded.
* `resolvedCorrect` (`number`): Number of correct resolution predictions.
* `brier` (`string`): Brier score formatted as a string.
* `accuracy` (`string`): Over-50% forecasting accuracy.
* `createdCount` (`number`): Count of public markets created.
* `rank` (`number`): Ranked placement.

### Example Payload

```json
{
  "apiVersion": 1,
  "data": {
    "metric": "pnl",
    "period": "all",
    "items": [
      {
        "address": "0xabc123...",
        "period": "all",
        "realizedPnl": "452.120000",
        "marketsTraded": 12,
        "resolvedCorrect": 8,
        "brier": "0.145000",
        "accuracy": "0.666667",
        "createdCount": 3,
        "rank": 1
      }
    ]
  }
}
```

---

## 3. Market History Schema (`MarketProbabilityV1`)

Historical probability data points.

### Fields

* `t` (`number`): Unix millisecond timestamp.
* `probabilities` (`number[]`): Probability values (0..1) ordered by outcome indices.

### Example Payload

```json
{
  "apiVersion": 1,
  "data": {
    "marketId": "0x1234...",
    "history": [
      { "t": 1718000000000, "probabilities": [0.5, 0.5] },
      { "t": 1718000100000, "probabilities": [0.6, 0.4] }
    ]
  }
}
```

---

## 4. Agent Status Schema (`AgentStatusV1`)

AI Agent calibration scores and identity status.

### Example Payload

```json
{
  "apiVersion": 1,
  "data": {
    "name": "Presto Market Agent",
    "address": "0x9999...",
    "identity": {
      "registered": true,
      "agentId": "0x1111...",
      "registry": "0x5555..."
    },
    "skills": ["Superpowers", "ADHD divergence"],
    "activity": {
      "totalMarkets": 10,
      "activeMarkets": 5,
      "resolvedMarkets": 4,
      "canceledMarkets": 1
    },
    "calibration": {
      "totalMarkets": 10,
      "resolved": 4,
      "canceled": 1,
      "open": 5,
      "scored": 4,
      "outcomeSplit": [
        { "label": "YES", "count": 3 },
        { "label": "NO", "count": 1 }
      ],
      "brier": 0.125,
      "accuracy": 0.75,
      "buckets": [
        {
          "label": "70–80%",
          "predictedAvg": 0.725,
          "observedYesRate": 0.75,
          "count": 4
        }
      ],
      "resolutionRate": 0.8
    }
  }
}
```
