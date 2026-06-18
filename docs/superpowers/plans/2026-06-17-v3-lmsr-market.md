# V3 LMSR Market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-share market with an LMSR automated market maker that prices every outcome live, lets holders sell/exit any time, settles through a bonded optimistic flow, and can be paused in an emergency.

**Architecture:** A new collateral-agnostic `PrestoLmsrMarket` contract holds collateral, tracks per-outcome share quantities as signed WAD, and prices with LMSR (`C(q)=b*ln(Σexp(q_i/b))`) using solmate `SignedWadMath`. A new `PrestoLmsrMarketFactory` deploys markets (USDC + EURC, binary + multi). The Next.js app's onchain reader, trade UI (adds Sell), wallet action layer, Circle/passkey allowlist, and the agent's seeding are extended for V3. Old factories move to the legacy reader via the same env cutover used for the 30-minute window.

**Tech Stack:** Solidity ^0.8.24, Hardhat, `@openzeppelin/contracts`, `solmate` (SignedWadMath), Next.js 16, viem.

## Global Constraints

- Solidity pragma: `^0.8.24` (verbatim, every contract file).
- License header: `// SPDX-License-Identifier: MIT` on every `.sol` file.
- OpenZeppelin imports use the `@openzeppelin/contracts/...` path.
- Tests are CommonJS `.cjs` using `chai` + `hardhat` (`ethers`), matching `test/PrestoMarket.test.cjs`.
- Collateral is 6-decimal (USDC/EURC). All LMSR math is 18-decimal WAD; convert only at the token boundary. Buys round collateral **up**, sell refunds round **down** (house never loses dust).
- Challenge window reuses the existing value: `RESOLUTION_CHALLENGE_WINDOW = 30 minutes`.
- Commit messages: no `Co-Authored-By` trailer (repo convention).
- After each task: `npm run test:contracts` (contracts) or `npm run build` + `npx tsc --noEmit` (app) must pass before commit.

---

## File Structure

**Contracts (new):**
- `contracts/PrestoLmsrMarket.sol` — the LMSR market: storage, LMSR cost/price views, buy, sell, fees, bonded propose/dispute/settle, pause, cancel/refund.
- `contracts/PrestoLmsrMarketFactory.sol` — deploys `PrestoLmsrMarket`, owner controls fee bps + default bond, is the pause guardian.

**Tests (new):**
- `test/PrestoLmsrMarket.test.cjs`
- `test/PrestoLmsrMarketFactory.test.cjs`

**Scripts (new):**
- `scripts/deploy-arc-lmsr.cjs` — deploy the four V3 factories, print addresses.

**App (modify):**
- `src/lib/contracts.ts` — add `prestoLmsrMarketAbi`, `prestoLmsrMarketFactoryAbi`.
- `src/lib/arcConfig.ts` — add V3 factory env + move current factories to legacy.
- `src/lib/onchainMarkets.ts` — detect V3 markets, read live LMSR price as odds.
- `src/lib/liveActions.ts`, `src/lib/circleActions.ts`, `src/lib/passkeyActions.ts` — add `sell`.
- `src/lib/circleWalletPolicy.ts` — allowlist `buy`/`sell`/`proposeResolution`/`disputeResolution` on V3 markets.
- `src/components/MarketDetailClient.tsx` — Sell tab + live price/slippage preview.
- `src/lib/agentPipeline.ts` / `src/lib/agentWallet.ts` — seed `S` (subsidy) instead of per-outcome.

---

## Task 1: Add solmate and confirm WAD exp/ln in Hardhat

**Files:**
- Modify: `package.json` (devDependency), `hardhat.config.*` (remappings if needed)
- Create: `contracts/test/WadProbe.sol`, `test/WadProbe.test.cjs`

**Interfaces:**
- Produces: solmate `SignedWadMath` functions available to contracts via `import {wadExp, wadLn, wadMul, wadDiv} from "solmate/utils/SignedWadMath.sol";`

- [ ] **Step 1: Install solmate**

Run: `npm install --save-dev solmate@^6.8.0`
Expected: `solmate` appears in devDependencies, `node_modules/solmate/src/utils/SignedWadMath.sol` exists.

- [ ] **Step 2: Write a probe contract that uses wadExp/wadLn**

Create `contracts/test/WadProbe.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {wadExp, wadLn, wadMul, wadDiv} from "solmate/utils/SignedWadMath.sol";

/// @notice Probe to confirm solmate WAD math compiles and runs under the project's Hardhat config.
contract WadProbe {
    function lnOfExp(int256 xWad) external pure returns (int256) {
        return wadLn(wadExp(xWad)); // should return ~xWad
    }

    function product(int256 aWad, int256 bWad) external pure returns (int256) {
        return wadMul(aWad, bWad);
    }
}
```

- [ ] **Step 3: Write the failing test**

Create `test/WadProbe.test.cjs`:

```js
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('WadProbe', () => {
  it('ln(exp(x)) ~= x for a WAD value', async () => {
    const probe = await (await ethers.getContractFactory('WadProbe')).deploy();
    const oneWad = 10n ** 18n;
    const out = await probe.lnOfExp(oneWad);
    // within 1e-6 WAD of 1.0
    const diff = out > oneWad ? out - oneWad : oneWad - out;
    expect(diff).to.be.lessThan(10n ** 12n);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npm run test:contracts -- --grep WadProbe`
Expected: PASS (compiles + assertion holds). If solmate import path differs, fix the import to the path that resolves under `node_modules/solmate`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json contracts/test/WadProbe.sol test/WadProbe.test.cjs
git commit -m "build(contracts): add solmate SignedWadMath for LMSR pricing"
```

---

## Task 2: PrestoLmsrMarket storage + LMSR cost/price views

**Files:**
- Create: `contracts/PrestoLmsrMarket.sol`
- Test: `test/PrestoLmsrMarket.test.cjs`

**Interfaces:**
- Produces:
  - `constructor(address collateral_, address resolver_, uint64 closeTime_, uint8 marketKind_, string metadataURI_, uint8 outcomeCount_, uint256 seed6_, uint16 feeBps_, address protocolFeeRecipient_, address creator_)`
  - `function price(uint8 outcome) external view returns (uint256 wad)` — current LMSR price in WAD (sums to 1e18 across outcomes)
  - `function buyCost(uint8 outcome, uint256 shares6) public view returns (uint256 cost6)` — collateral (6dp) to buy `shares6` shares, fee excluded
  - `function collateral() external view returns (address)`, `outcomeCount()`, `closeTime()`, `state()`, `totalShares(uint8)`, `sharesOf(uint8,address)`
  - Enum `State { Open, Proposed, Disputed, Resolved, Canceled }`

- [ ] **Step 1: Write the failing test for initial prices**

Add to `test/PrestoLmsrMarket.test.cjs`:

```js
const { expect } = require('chai');
const { ethers } = require('hardhat');

const WAD = 10n ** 18n;
const USDC = (n) => BigInt(Math.round(n * 1e6)); // 6dp helper

async function deployMarket({ outcomes = 2, seed = 100, feeBps = 150 } = {}) {
  const [deployer, resolver, alice, bob, treasury] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory('MockUSDC');
  const usdc = await Mock.deploy();
  for (const who of [deployer, alice, bob]) await usdc.mint(who.address, USDC(1_000_000));
  const close = BigInt((await ethers.provider.getBlock('latest')).timestamp + 3600);
  const Market = await ethers.getContractFactory('PrestoLmsrMarket');
  // deployer seeds: approve then deploy passes seed pulled in constructor
  const market = await Market.deploy(
    await usdc.getAddress(), resolver.address, close, 0, 'data:application/json,{}',
    outcomes, USDC(seed), feeBps, treasury.address, deployer.address,
  );
  // fund the seed
  await usdc.approve(await market.getAddress(), USDC(seed));
  await market.seed();
  return { usdc, market, deployer, resolver, alice, bob, treasury };
}

describe('PrestoLmsrMarket pricing', () => {
  it('starts at uniform prices that sum to 1', async () => {
    const { market } = await deployMarket({ outcomes: 2 });
    const p0 = await market.price(0);
    const p1 = await market.price(1);
    expect(p0).to.equal(WAD / 2n);
    expect(p0 + p1).to.equal(WAD);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails (no contract)**

Run: `npm run test:contracts -- --grep "PrestoLmsrMarket pricing"`
Expected: FAIL — `PrestoLmsrMarket` artifact not found.

- [ ] **Step 3: Write the contract skeleton with LMSR cost + price**

Create `contracts/PrestoLmsrMarket.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {wadExp, wadLn, wadMul, wadDiv} from "solmate/utils/SignedWadMath.sol";

/// @notice LMSR prediction market. Collateral-agnostic (USDC or EURC, 6 decimals).
/// Shares are tracked in 18-decimal WAD; 1 winning share redeems for 1 collateral unit.
contract PrestoLmsrMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State { Open, Proposed, Disputed, Resolved, Canceled }

    IERC20 public immutable collateralToken;
    address public immutable resolver;
    address public immutable creator;
    address public immutable factory;
    uint64 public immutable closeTime;
    uint8 public immutable marketKind;
    uint8 public immutable outcomeCount;
    string public metadataURI;
    uint16 public immutable feeBps;
    address public immutable protocolFeeRecipient;

    int256 public immutable b; // liquidity parameter, WAD
    int256[] internal q;       // per-outcome net shares, WAD
    mapping(uint8 => mapping(address => uint256)) public shares6; // outcome => holder => shares (6dp)

    State public state;
    bool public seeded;

    error WrongOutcome();
    error NotSeeded();
    error AlreadySeeded();

    constructor(
        address collateral_, address resolver_, uint64 closeTime_, uint8 marketKind_,
        string memory metadataURI_, uint8 outcomeCount_, uint256 seed6_, uint16 feeBps_,
        address protocolFeeRecipient_, address creator_
    ) {
        require(outcomeCount_ >= 2 && outcomeCount_ <= 12, "outcomes");
        require(collateral_ != address(0) && resolver_ != address(0), "zero");
        require(seed6_ > 0, "seed");
        require(feeBps_ <= 1000, "fee"); // <= 10%
        collateralToken = IERC20(collateral_);
        resolver = resolver_;
        closeTime = closeTime_;
        marketKind = marketKind_;
        metadataURI = metadataURI_;
        outcomeCount = outcomeCount_;
        feeBps = feeBps_;
        protocolFeeRecipient = protocolFeeRecipient_;
        creator = creator_;
        factory = msg.sender;
        q = new int256[](outcomeCount_);
        // b = S / ln(n). seed6_ is 6dp; convert to WAD. ln(n) via wadLn(n*WAD).
        int256 seedWad = int256(seed6_) * 1e12;
        int256 lnN = wadLn(int256(uint256(outcomeCount_)) * 1e18);
        b = wadDiv(seedWad, lnN);
        state = State.Open;
    }

    function seed() external nonReentrant {
        if (seeded) revert AlreadySeeded();
        seeded = true;
        // pull S = b * ln(n) (== original seed6_) from the creator
        uint256 s6 = _maxLoss6();
        collateralToken.safeTransferFrom(msg.sender, address(this), s6);
    }

    function _maxLoss6() internal view returns (uint256) {
        int256 lnN = wadLn(int256(uint256(outcomeCount_)) * 1e18);
        int256 sWad = wadMul(b, lnN);
        return uint256(sWad) / 1e12;
    }

    // C(q) = b * ln( sum exp(q_i / b) ), log-sum-exp stabilized.
    function _cost(int256[] memory qq) internal view returns (int256) {
        int256 maxQ = qq[0];
        for (uint256 i = 1; i < qq.length; i++) if (qq[i] > maxQ) maxQ = qq[i];
        int256 sumExp;
        for (uint256 i = 0; i < qq.length; i++) {
            sumExp += wadExp(wadDiv(qq[i] - maxQ, b));
        }
        return wadMul(b, wadLn(sumExp)) + maxQ;
    }

    function price(uint8 outcome) external view returns (uint256) {
        if (outcome >= outcomeCount) revert WrongOutcome();
        int256 maxQ = q[0];
        for (uint256 i = 1; i < q.length; i++) if (q[i] > maxQ) maxQ = q[i];
        int256 denom;
        for (uint256 i = 0; i < q.length; i++) denom += wadExp(wadDiv(q[i] - maxQ, b));
        int256 num = wadExp(wadDiv(q[outcome] - maxQ, b));
        return uint256(wadDiv(num, denom));
    }

    function buyCost(uint8 outcome, uint256 shares6) public view returns (uint256) {
        if (outcome >= outcomeCount) revert WrongOutcome();
        int256[] memory q2 = q; // copy
        int256 deltaWad = int256(shares6) * 1e12;
        int256 before = _cost(q2);
        q2[outcome] += deltaWad;
        int256 after_ = _cost(q2);
        int256 costWad = after_ - before;
        if (costWad < 0) costWad = 0;
        // round 6dp up
        return (uint256(costWad) + 1e12 - 1) / 1e12;
    }

    function collateral() external view returns (address) { return address(collateralToken); }
    function totalShares(uint8 outcome) external view returns (int256) { return q[outcome]; }
    function sharesOf(uint8 outcome, address who) external view returns (uint256) { return shares6[outcome][who]; }
}
```

Also create the seed flow used by the test. (The test calls `seed()` after approving.)

- [ ] **Step 4: Run the pricing test**

Run: `npm run test:contracts -- --grep "PrestoLmsrMarket pricing"`
Expected: PASS — initial prices are `WAD/2` and sum to `WAD`.

- [ ] **Step 5: Commit**

```bash
git add contracts/PrestoLmsrMarket.sol test/PrestoLmsrMarket.test.cjs
git commit -m "feat(contracts): LMSR market storage, cost function, and live prices"
```

---

## Task 3: buy()

**Files:**
- Modify: `contracts/PrestoLmsrMarket.sol`
- Test: `test/PrestoLmsrMarket.test.cjs`

**Interfaces:**
- Produces: `function buy(uint8 outcome, uint256 shares6, uint256 maxCost6) external nonReentrant` — pulls `cost + fee`, mints shares, moves the price. Emits `SharesBought(address,uint8,uint256,uint256)`.

- [ ] **Step 1: Write the failing test**

```js
describe('PrestoLmsrMarket buy', () => {
  it('buying outcome 0 raises its price and pulls cost+fee', async () => {
    const { usdc, market, alice } = await deployMarket({ outcomes: 2, feeBps: 150 });
    const shares = USDC(50);
    const cost = await market.buyCost(0, shares);
    await usdc.connect(alice).approve(await market.getAddress(), cost * 2n);
    const before = await usdc.balanceOf(alice.address);
    await market.connect(alice).buy(0, shares, cost * 2n);
    const after = await usdc.balanceOf(alice.address);
    expect(before - after).to.be.greaterThan(cost); // cost + fee
    expect(await market.price(0)).to.be.greaterThan(WAD / 2n);
    expect(await market.sharesOf(0, alice.address)).to.equal(shares);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — Run: `npm run test:contracts -- --grep "PrestoLmsrMarket buy"`. Expected: FAIL (no `buy`).

- [ ] **Step 3: Implement buy()**

Add to the contract:

```solidity
    event SharesBought(address indexed buyer, uint8 indexed outcome, uint256 shares6, uint256 cost6);

    error MarketClosed();
    error SlippageExceeded();

    modifier onlyOpen() {
        if (state != State.Open) revert MarketClosed();
        if (block.timestamp >= closeTime) revert MarketClosed();
        _;
    }

    function _fee6(uint256 amount6) internal view returns (uint256) {
        return (amount6 * feeBps) / 10_000;
    }

    function buy(uint8 outcome, uint256 shares6, uint256 maxCost6) external nonReentrant onlyOpen {
        if (!seeded) revert NotSeeded();
        if (outcome >= outcomeCount) revert WrongOutcome();
        uint256 cost = buyCost(outcome, shares6);
        uint256 fee = _fee6(cost);
        uint256 total = cost + fee;
        if (total > maxCost6) revert SlippageExceeded();
        q[outcome] += int256(shares6) * 1e12;
        shares6[outcome][msg.sender] += shares6;
        accruedFees6 += fee;
        collateralToken.safeTransferFrom(msg.sender, address(this), total);
        emit SharesBought(msg.sender, outcome, shares6, cost);
    }
```

Add `uint256 public accruedFees6;` to storage.

- [ ] **Step 4: Run the test** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/PrestoLmsrMarket.sol test/PrestoLmsrMarket.test.cjs
git commit -m "feat(contracts): LMSR buy with slippage guard and fee"
```

---

## Task 4: sell() — early exit

**Files:** Modify `contracts/PrestoLmsrMarket.sol`; Test `test/PrestoLmsrMarket.test.cjs`

**Interfaces:**
- Produces: `function sellRefund(uint8 outcome, uint256 shares6) public view returns (uint256 refund6)`; `function sell(uint8 outcome, uint256 shares6, uint256 minRefund6) external nonReentrant onlyOpen`. Emits `SharesSold(address,uint8,uint256,uint256)`.

- [ ] **Step 1: Write the failing test**

```js
describe('PrestoLmsrMarket sell', () => {
  it('buy then sell returns most of the cost (minus fees) and restores price', async () => {
    const { usdc, market, alice } = await deployMarket({ outcomes: 2 });
    const shares = USDC(50);
    const cost = await market.buyCost(0, shares);
    await usdc.connect(alice).approve(await market.getAddress(), cost * 2n);
    await market.connect(alice).buy(0, shares, cost * 2n);
    const refund = await market.sellRefund(0, shares);
    const before = await usdc.balanceOf(alice.address);
    await market.connect(alice).sell(0, shares, 0);
    const after = await usdc.balanceOf(alice.address);
    expect(after - before).to.equal(refund - (refund * 150n) / 10_000n);
    expect(await market.sharesOf(0, alice.address)).to.equal(0n);
    expect(await market.price(0)).to.equal(WAD / 2n);
  });
});
```

- [ ] **Step 2: Run to confirm fail.**

- [ ] **Step 3: Implement sell()**

```solidity
    event SharesSold(address indexed seller, uint8 indexed outcome, uint256 shares6, uint256 refund6);
    error InsufficientShares();

    function sellRefund(uint8 outcome, uint256 shares6) public view returns (uint256) {
        if (outcome >= outcomeCount) revert WrongOutcome();
        int256[] memory q2 = q;
        int256 before = _cost(q2);
        q2[outcome] -= int256(shares6) * 1e12;
        int256 after_ = _cost(q2);
        int256 refundWad = before - after_;
        if (refundWad < 0) refundWad = 0;
        return uint256(refundWad) / 1e12; // round down
    }

    function sell(uint8 outcome, uint256 shares6, uint256 minRefund6) external nonReentrant onlyOpen {
        if (shares6 > shares6[outcome][msg.sender]) revert InsufficientShares();
        uint256 refund = sellRefund(outcome, shares6);
        uint256 fee = _fee6(refund);
        uint256 net = refund - fee;
        if (net < minRefund6) revert SlippageExceeded();
        q[outcome] -= int256(shares6) * 1e12;
        shares6[outcome][msg.sender] -= shares6;
        accruedFees6 += fee;
        collateralToken.safeTransfer(msg.sender, net);
        emit SharesSold(msg.sender, outcome, shares6, net);
    }
```

(Note: the mapping name `shares6` collides with the param `shares6`. Rename the param to `amount6` throughout buy/sell to avoid shadowing — apply the rename in this step.)

- [ ] **Step 4: Run the test.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/PrestoLmsrMarket.sol test/PrestoLmsrMarket.test.cjs
git commit -m "feat(contracts): LMSR sell (early exit) with slippage guard and fee"
```

---

## Task 5: Bonded propose / dispute / settle + claim

**Files:** Modify `contracts/PrestoLmsrMarket.sol`; Test `test/PrestoLmsrMarket.test.cjs`

**Interfaces:**
- Produces:
  - `function propose(uint8 outcome, string evidenceURI) external nonReentrant` (resolver only, posts proposer bond)
  - `function dispute(string reason) external nonReentrant` (position holder, posts disputer bond)
  - `function settle() external nonReentrant` (anyone after window if undisputed)
  - `function resolveDisputed(uint8 finalOutcome, string evidenceURI) external nonReentrant` (resolver, when disputed)
  - `function claim() external nonReentrant` (winning holders redeem 1 share = 1 collateral)
  - `RESOLUTION_CHALLENGE_WINDOW = 30 minutes`, `proposalChallengeEndsAt()`
  - Constructor gains `uint256 bond6_` (default bond, from factory).

- [ ] **Step 1: Write failing tests** for the three paths: undisputed settle pays winners + returns proposer bond; disputed-upheld slashes proposer bond to disputer; disputed-frivolous forfeits disputer bond. (Full chai test bodies: propose with bond approved, advance time `await ethers.provider.send('evm_increaseTime',[1800]); await ethers.provider.send('evm_mine')`, settle, assert balances and `claim()` payouts.)

- [ ] **Step 2: Run to confirm fail.**

- [ ] **Step 3: Implement** the proposal struct (`{uint8 outcome; address proposer; uint64 time; bool disputed; address disputer; string evidenceURI;}`), `propose`/`dispute`/`settle`/`resolveDisputed`/`claim`, bond escrow (pull on propose/dispute, pay/slash on settle), winner redemption (`shares6[winning][holder]` → equal collateral, 6dp), and set `state` transitions Open→Proposed→(Disputed)→Resolved. Reuse the existing PrestoMarket settle/claim accounting as the reference for winner payouts and fee handling.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/PrestoLmsrMarket.sol test/PrestoLmsrMarket.test.cjs
git commit -m "feat(contracts): bonded optimistic resolution and winner claims"
```

---

## Task 6: Emergency pause + timeout cancel/refund

**Files:** Modify `contracts/PrestoLmsrMarket.sol`; Test `test/PrestoLmsrMarket.test.cjs`

**Interfaces:**
- Produces: inherits OZ `Pausable`; `pause()`/`unpause()` callable only by `factory` owner (via a `guardian` set from the factory). `buy`/`sell`/`propose` gain `whenNotPaused`; `claim`/`refund`/`cancel` stay callable when paused. `function cancel()` (resolver, before close) and `function timeoutCancel()` (anyone, after `closeTime + RESOLUTION_TIMEOUT`) refund every holder the LMSR value of their shares.

- [ ] **Step 1: Write failing tests** — paused buy reverts `EnforcedPause`; paused claim still works; timeoutCancel refunds.
- [ ] **Step 2: Run to confirm fail.**
- [ ] **Step 3: Implement** `import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";`, a `guardian` immutable (passed from factory = factory owner), `pause()`/`unpause()` guarded by `msg.sender == guardian`, add `whenNotPaused` to buy/sell/propose, and the cancel/refund paths (refund = redeem each held share for its current `price`-weighted collateral, or simplest: return each holder a pro-rata share of contract collateral — match the existing PrestoMarket refund semantics).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add contracts/PrestoLmsrMarket.sol test/PrestoLmsrMarket.test.cjs
git commit -m "feat(contracts): emergency pause and timeout cancel/refund"
```

---

## Task 7: PrestoLmsrMarketFactory

**Files:** Create `contracts/PrestoLmsrMarketFactory.sol`; Test `test/PrestoLmsrMarketFactory.test.cjs`

**Interfaces:**
- Produces: `constructor(address collateral_)`; `function createMarket(address resolver, uint64 closeTime, string metadataURI, uint8 marketKind, uint8 outcomeCount, uint256 seed6) external returns (address)`; `function createMarket(...)` binary overload (outcomeCount fixed 2) to match the current factory shape; owner setters `setFeeBps`, `setDefaultBond`; emits `MarketCreated(address market, address creator, address resolver, uint8 marketKind, uint64 closeTime, string metadataURI)` (same event shape the reader already parses).

- [ ] **Step 1: Write failing tests** — create binary + multi markets, fee/bond owner-only, zero collateral rejected (mirror `test/PrestoMarketFactory.test.cjs`).
- [ ] **Step 2: Run to confirm fail.**
- [ ] **Step 3: Implement** the factory (copy the structure of `contracts/PrestoMarketFactory.sol`, deploy `PrestoLmsrMarket`, pass `feeBps`/`protocolFeeRecipient`/`bond`/`guardian = owner`, set `creator = msg.sender`). Keep the `MarketCreated` event identical so `onchainMarkets` parsing is unchanged.
- [ ] **Step 4: Run the tests.** Expected: PASS (and `npm run test:contracts` all green).
- [ ] **Step 5: Commit**

```bash
git add contracts/PrestoLmsrMarketFactory.sol test/PrestoLmsrMarketFactory.test.cjs
git commit -m "feat(contracts): LMSR market factory"
```

---

## Task 8: Deploy the four V3 factories to Arc

**Files:** Create `scripts/deploy-arc-lmsr.cjs`

**Interfaces:** Consumes `PRIVATE_KEY`, `ARC_RPC_URL`, `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_EURC_ADDRESS` from env (same as `scripts/deploy-arc-v2.cjs`). Produces four deployed factory addresses printed to stdout.

- [ ] **Step 1: Write the deploy script** by copying `scripts/deploy-arc-v2.cjs` and swapping the contract name to `PrestoLmsrMarketFactory`, deploying once per (USDC, EURC), and for binary vs multi if the factory is split, else a single factory per collateral if it handles both. Print a ready-to-paste env block.
- [ ] **Step 2: Dry run on Hardhat network** — Run: `npx hardhat run scripts/deploy-arc-lmsr.cjs` (default network) to confirm it executes without RPC.
- [ ] **Step 3: Deploy to Arc** — Run: `npx hardhat run scripts/deploy-arc-lmsr.cjs --network arc`. Expected: four addresses printed, deployer gas spent. (This step requires the funded deployer key; if unavailable, hand the script to the operator.)
- [ ] **Step 4: Record addresses** in a scratch note for Task 9.
- [ ] **Step 5: Commit the script**

```bash
git add scripts/deploy-arc-lmsr.cjs
git commit -m "chore(deploy): LMSR factory deploy script for Arc"
```

---

## Task 9: ABI + env cutover

**Files:** Modify `src/lib/contracts.ts`, `src/lib/arcConfig.ts`; Vercel env.

- [ ] **Step 1: Add ABIs** — export `prestoLmsrMarketAbi` and `prestoLmsrMarketFactoryAbi` in `src/lib/contracts.ts` (copy the relevant fragments: `buy`, `sell`, `price`, `buyCost`, `sellRefund`, `propose`, `dispute`, `settle`, `claim`, `state`, `collateral`, `totalShares`, `sharesOf`, plus the factory `createMarket`/`MarketCreated`).
- [ ] **Step 2: Add V3 factory env** in `arcConfig.ts` (`NEXT_PUBLIC_LMSR_MARKET_FACTORY_ADDRESS`, EURC variant) as the new primary factories, and move the current 30-minute factories into the legacy lists (same pattern already used for prior cutovers).
- [ ] **Step 3: Typecheck** — Run: `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 4: Set Vercel env + redeploy** — set the new factory addresses (Production), move old to legacy env, trigger a deploy, then verify existing markets still load (`/api/markets` count unchanged) exactly as in the 30-minute cutover.
- [ ] **Step 5: Commit**

```bash
git add src/lib/contracts.ts src/lib/arcConfig.ts
git commit -m "feat(v3): wire LMSR factory ABIs and cut env over to V3 factories"
```

---

## Task 10: Reader — live LMSR prices as odds

**Files:** Modify `src/lib/onchainMarkets.ts`; Test `src/lib/__tests__/` (vitest).

**Interfaces:** Consumes `prestoLmsrMarketAbi`. Produces: V3 markets report `outcomes[i].odds` from the on-chain `price(i)` (WAD → percent) instead of the share-split estimate; `displayType` and metadata unchanged.

- [ ] **Step 1: Write a failing vitest** that, given a mocked client returning `price(i)` values, maps them to odds summing to ~100.
- [ ] **Step 2: Run to confirm fail.**
- [ ] **Step 3: Implement** — in `readMarket`, detect a V3 market (its factory is the LMSR factory, or it exposes `price`/`buyCost`), and when so, read `price(i)` for each outcome and set odds from those; fall back to the existing share-odds for V1/V2. Keep all other fields identical.
- [ ] **Step 4: Run the test + `npm run build`.** Expected: PASS, build green.
- [ ] **Step 5: Commit**

```bash
git add src/lib/onchainMarkets.ts src/lib/__tests__/onchainMarketsLmsr.test.ts
git commit -m "feat(v3): read live LMSR prices as market odds"
```

---

## Task 11: Sell action across wallets + trade UI

**Files:** Modify `src/lib/liveActions.ts`, `src/lib/circleActions.ts`, `src/lib/passkeyActions.ts`, `src/lib/circleWalletPolicy.ts`, `src/components/MarketDetailClient.tsx`.

**Interfaces:** Produces `sellLiveShares({ marketAddress, outcome, outcomeIndex, shares, minRefund })` dispatching to `sellCircleShares` / `sellPasskeyShares` / EOA sell, mirroring the existing buy dispatch.

- [ ] **Step 1: Add the EOA sell** in `liveActions.ts` (approve not needed; call `sell(outcomeIndex, shares, minRefund)`), the Circle path in `circleActions.ts` (`runContractExecution` with `sell(uint8,uint256,uint256)`), and the passkey path in `passkeyActions.ts` (`runPasskeyCalls` with the confirm preview + Arc-direct confirm on USDC balance rise). Add `sell`/`proposeResolution`/`disputeResolution` to the Circle/passkey allowlist in `circleWalletPolicy.ts`.
- [ ] **Step 2: Add the Sell tab** in `MarketDetailClient.tsx` trade panel: when the market is V3 and the user holds shares, show a Sell mode with a live `sellRefund` preview and `minRefund` slippage. Reuse the existing tradeMode buy/sell scaffolding.
- [ ] **Step 3: Typecheck + build.** Expected: clean, green.
- [ ] **Step 4: Manual smoke** (or vitest where logic is pure): a buy then sell round-trips on a deployed V3 market.
- [ ] **Step 5: Commit**

```bash
git add src/lib/liveActions.ts src/lib/circleActions.ts src/lib/passkeyActions.ts src/lib/circleWalletPolicy.ts src/components/MarketDetailClient.tsx
git commit -m "feat(v3): sell/early-exit across EOA, Circle, and passkey wallets"
```

---

## Task 12: Agent seeds the LMSR subsidy

**Files:** Modify `src/lib/agentPipeline.ts` (`createOnchain`) and/or `src/lib/agentWallet.ts`.

**Interfaces:** The agent calls the V3 factory `createMarket(..., seed6)` with a configured subsidy (env `PRESTO_AGENT_LMSR_SEED_USDC`, default e.g. 50), funds the seed (approve + `seed()`), instead of seeding each outcome.

- [ ] **Step 1: Add the subsidy env + create-on-V3-factory path** in `createOnchain`: build the `createMarket` call against the LMSR factory, then approve + `seed()` from the agent wallet.
- [ ] **Step 2: Keep the strict no-image gate and dedup unchanged.**
- [ ] **Step 3: Typecheck + build.** Expected: clean, green.
- [ ] **Step 4: Trigger one agent tick** (Actions workflow) and confirm a V3 market is created, priced live, and sellable.
- [ ] **Step 5: Commit**

```bash
git add src/lib/agentPipeline.ts src/lib/agentWallet.ts
git commit -m "feat(v3): agent seeds the LMSR subsidy when creating markets"
```

---

## Self-Review

**Spec coverage:**
- LMSR pricing/buy/sell → Tasks 2-4. Bonded resolution → Task 5. Pause + cancel/refund → Task 6. Fees → Tasks 3-4 (charged on buy/sell). Factory → Task 7. Deploy + cutover → Tasks 8-9. Reader live prices → Task 10. Sell UI + wallet wiring + allowlist → Task 11. Agent seeds `b` via `S` → Task 12. Out of scope (PrestoSwap, size caps, CLOB) — correctly excluded.
- Gap noted: the spec's "graduation to CLOB" is documentation-only (no task needed); the solvency invariant is exercised by the buy/sell/claim tests in Tasks 3-5 — add an explicit invariant assertion (contract collateral balance >= max single-outcome payout) to the Task 5 test bodies.

**Placeholder scan:** Tasks 5, 6, 8, 11, 12 describe some test bodies and UI deltas at the step level rather than full code, because they mirror existing files (`PrestoMarket` settle/claim, `PrestoMarketFactory`, the buy dispatch, `deploy-arc-v2.cjs`). The implementer must open those references and copy the pattern; each such step names the exact reference file. Before executing those tasks, expand the referenced pattern into concrete code.

**Type consistency:** `amount6`/`shares6` param naming reconciled in Task 4 (rename to avoid the mapping collision). `MarketCreated` event shape kept identical to the existing factory so the reader is unchanged. `seed6`/`b` relationship (`b = S/ln(n)`) consistent across constructor, `seed()`, and Task 12.

---

## Notes for the implementer

- The hardest correctness risk is the LMSR fixed-point math and the solvency invariant. Do not skip the reference-vs-onchain math test (Task 2) or the invariant assertion (Task 5).
- Keep V1/V2 market reads working at every step — never remove the legacy factory handling.
- The deploy + env cutover (Tasks 8-9) need the funded deployer key and Vercel access; if running as an agent without them, prepare the script + env values and hand off to the operator.
