const { expect } = require('chai');
const { ethers } = require('hardhat');

const WAD = 10n ** 18n;
const USDC = (n) => BigInt(Math.round(n * 1e6)); // 6dp helper

async function deployMarket({ outcomes = 2, seed = 100, feeBps = 150, bond = 10 } = {}) {
  const [deployer, resolver, alice, bob, treasury] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory('MockUSDC');
  const usdc = await Mock.deploy();
  for (const who of [deployer, resolver, alice, bob]) await usdc.mint(who.address, USDC(1_000_000));
  const close = BigInt((await ethers.provider.getBlock('latest')).timestamp + 3600);
  const Market = await ethers.getContractFactory('PrestoLmsrMarket');
  const market = await Market.deploy(
    await usdc.getAddress(), resolver.address, close, 0, 'data:application/json,{}',
    outcomes, USDC(seed), feeBps, treasury.address, deployer.address, USDC(bond), deployer.address,
  );
  await usdc.approve(await market.getAddress(), USDC(seed));
  await market.seed();
  return { usdc, market, deployer, resolver, alice, bob, treasury, close, bond6: USDC(bond) };
}

// Advance the chain past the close time and the 30-minute challenge window.
async function advancePastClose(close, extraSeconds = 0) {
  await ethers.provider.send('evm_setNextBlockTimestamp', [Number(close) + 1 + extraSeconds]);
  await ethers.provider.send('evm_mine', []);
}
async function advanceSeconds(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine', []);
}

module.exports.deployMarket = deployMarket;
module.exports.WAD = WAD;
module.exports.USDC = USDC;

describe('PrestoLmsrMarket pricing', () => {
  it('starts at uniform prices that sum to 1', async () => {
    const { market } = await deployMarket({ outcomes: 2 });
    const p0 = await market.price(0);
    const p1 = await market.price(1);
    expect(p0).to.equal(WAD / 2n);
    expect(p0 + p1).to.equal(WAD);
  });

  it('three-way market starts uniform and sums to ~1', async () => {
    const { market } = await deployMarket({ outcomes: 3 });
    const ps = [await market.price(0), await market.price(1), await market.price(2)];
    const sum = ps.reduce((a, b) => a + b, 0n);
    // each ~1/3 WAD; sum within rounding of 1 WAD
    const diff = sum > WAD ? sum - WAD : WAD - sum;
    expect(diff).to.be.lessThan(10n ** 9n);
    for (const p of ps) {
      const d = p > WAD / 3n ? p - WAD / 3n : WAD / 3n - p;
      expect(d).to.be.lessThan(10n ** 9n);
    }
  });

  it('exposes immutables', async () => {
    const { market, usdc } = await deployMarket({ outcomes: 2 });
    expect(await market.collateral()).to.equal(await usdc.getAddress());
    expect(await market.outcomeCount()).to.equal(2);
    expect(await market.state()).to.equal(0); // Open
  });
});

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
    expect(await market.accruedFees6()).to.equal((cost * 150n) / 10_000n);
  });

  it('reverts on slippage and after close', async () => {
    const { usdc, market, alice } = await deployMarket({ outcomes: 2 });
    const shares = USDC(50);
    const cost = await market.buyCost(0, shares);
    await usdc.connect(alice).approve(await market.getAddress(), cost * 2n);
    await expect(market.connect(alice).buy(0, shares, cost)).to.be.revertedWithCustomError(market, 'SlippageExceeded');
  });
});

describe('PrestoLmsrMarket sell', () => {
  it('buy then sell returns the refund minus fee and restores price', async () => {
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

  it('reverts selling more shares than held', async () => {
    const { market, alice } = await deployMarket({ outcomes: 2 });
    await expect(market.connect(alice).sell(0, USDC(1), 0)).to.be.revertedWithCustomError(market, 'InsufficientShares');
  });
});

async function buyShares(usdc, market, who, outcome, shares6) {
  const cost = await market.buyCost(outcome, shares6);
  await usdc.connect(who).approve(await market.getAddress(), cost * 2n);
  await market.connect(who).buy(outcome, shares6, cost * 2n);
}

describe('PrestoLmsrMarket resolution', () => {
  it('propose then settle after the window pays winners 1:1 and returns the proposer bond', async () => {
    const { usdc, market, resolver, alice, bob, close, bond6 } = await deployMarket({ outcomes: 2 });
    await buyShares(usdc, market, alice, 0, USDC(40)); // winner
    await buyShares(usdc, market, bob, 1, USDC(40));   // loser
    await advancePastClose(close);

    await usdc.connect(resolver).approve(await market.getAddress(), bond6);
    const resolverBefore = await usdc.balanceOf(resolver.address);
    await market.connect(resolver).propose(0, 'ipfs://evidence');
    expect(await market.state()).to.equal(1); // Proposed

    // Cannot settle while the window is open.
    await expect(market.settle()).to.be.revertedWithCustomError(market, 'ChallengeWindowOpen');
    await advanceSeconds(31 * 60);
    await market.settle();
    expect(await market.state()).to.equal(3); // Resolved
    expect(await market.winningOutcome()).to.equal(0);
    // Proposer bond returned in full.
    expect(await usdc.balanceOf(resolver.address)).to.equal(resolverBefore);

    const aliceBefore = await usdc.balanceOf(alice.address);
    await market.connect(alice).claim();
    expect((await usdc.balanceOf(alice.address)) - aliceBefore).to.equal(USDC(40));
    // Losing side cannot claim.
    await expect(market.connect(bob).claim()).to.be.revertedWithCustomError(market, 'NoPosition');
  });

  it('a frivolous dispute is slashed to the proposer', async () => {
    const { usdc, market, deployer, resolver, bob, close, bond6 } = await deployMarket({ outcomes: 2 });
    await buyShares(usdc, market, bob, 1, USDC(20)); // bob holds a position so he can dispute
    await advancePastClose(close);

    await usdc.connect(resolver).approve(await market.getAddress(), bond6);
    const resolverBefore = await usdc.balanceOf(resolver.address);
    await market.connect(resolver).propose(0, 'ipfs://evidence');

    await usdc.connect(bob).approve(await market.getAddress(), bond6);
    await market.connect(bob).dispute('i disagree');
    expect(await market.state()).to.equal(2); // Disputed

    // Resolver upholds the original proposal: dispute was frivolous.
    await market.connect(deployer).resolveDisputed(0, 'ipfs://final');
    expect(await market.state()).to.equal(3);
    expect(await market.winningOutcome()).to.equal(0);
    // Proposer recovers their bond plus the disputer's bond.
    expect((await usdc.balanceOf(resolver.address)) - resolverBefore).to.equal(bond6);
  });

  it('only the guardian (not the proposer/resolver) can adjudicate a dispute — audit #3', async () => {
    const { usdc, market, deployer, resolver, bob, close, bond6 } = await deployMarket({ outcomes: 2 });
    await buyShares(usdc, market, bob, 1, USDC(20));
    await advancePastClose(close);
    await usdc.connect(resolver).approve(await market.getAddress(), bond6);
    await market.connect(resolver).propose(0, 'ipfs://evidence');
    await usdc.connect(bob).approve(await market.getAddress(), bond6);
    await market.connect(bob).dispute('i disagree');

    // The resolver proposed the outcome, so it must NOT be able to judge the dispute against it.
    await expect(market.connect(resolver).resolveDisputed(0, 'ipfs://final'))
      .to.be.revertedWithCustomError(market, 'NotGuardian');
    // The guardian (a distinct key) adjudicates.
    await market.connect(deployer).resolveDisputed(0, 'ipfs://final');
    expect(await market.state()).to.equal(3);
  });

  it('an upheld dispute slashes the proposer to the disputer and flips the outcome', async () => {
    const { usdc, market, deployer, resolver, bob, close, bond6 } = await deployMarket({ outcomes: 2 });
    await buyShares(usdc, market, bob, 1, USDC(20)); // bob disputes and ends up the winner
    await advancePastClose(close);

    await usdc.connect(resolver).approve(await market.getAddress(), bond6);
    await market.connect(resolver).propose(0, 'ipfs://evidence');
    await usdc.connect(bob).approve(await market.getAddress(), bond6);
    const bobAfterBond = await usdc.balanceOf(bob.address);
    await market.connect(bob).dispute('outcome 1 actually won');

    await market.connect(deployer).resolveDisputed(1, 'ipfs://final');
    expect(await market.winningOutcome()).to.equal(1);
    // bobAfterBond is captured before the dispute pulls bond6; the payout returns 2*bond6,
    // so the net gain versus that snapshot is the slashed proposer bond (+bond6).
    expect((await usdc.balanceOf(bob.address)) - bobAfterBond).to.equal(bond6);
  });

  it('rejects disputes from non-holders', async () => {
    const { usdc, market, resolver, alice, close, bond6 } = await deployMarket({ outcomes: 2 });
    await advancePastClose(close);
    await usdc.connect(resolver).approve(await market.getAddress(), bond6);
    await market.connect(resolver).propose(0, 'ipfs://evidence');
    // alice holds no shares.
    await usdc.connect(alice).approve(await market.getAddress(), bond6);
    await expect(market.connect(alice).dispute('x')).to.be.revertedWithCustomError(market, 'NoPosition');
  });

  it('only the resolver can propose, and only after close', async () => {
    const { market, resolver, alice } = await deployMarket({ outcomes: 2 });
    await expect(market.connect(alice).propose(0, 'x')).to.be.revertedWithCustomError(market, 'NotResolver');
    await expect(market.connect(resolver).propose(0, 'x')).to.be.revertedWithCustomError(market, 'MarketNotClosed');
  });

  it('stays solvent across a full lifecycle and pays fees out of surplus', async () => {
    const { usdc, market, resolver, alice, bob, treasury, close, bond6 } = await deployMarket({ outcomes: 3 });
    await buyShares(usdc, market, alice, 0, USDC(70));
    await buyShares(usdc, market, bob, 0, USDC(30)); // both on the winning outcome
    await buyShares(usdc, market, bob, 1, USDC(25));
    await advancePastClose(close);

    await usdc.connect(resolver).approve(await market.getAddress(), bond6);
    await market.connect(resolver).propose(0, 'x');
    await advanceSeconds(31 * 60);
    await market.settle();

    const fees = await market.accruedFees6();
    await market.payWinners([alice.address, bob.address]);
    // Winners on outcome 0 are fully paid 1:1; the contract still holds at least the accrued fees.
    expect(await market.sharesOf(0, alice.address)).to.equal(0n);
    expect(await market.sharesOf(0, bob.address)).to.equal(0n);
    const balAfterPayout = await usdc.balanceOf(await market.getAddress());
    expect(balAfterPayout).to.be.greaterThanOrEqual(fees);

    const treasuryBefore = await usdc.balanceOf(treasury.address);
    await market.withdrawFees();
    expect((await usdc.balanceOf(treasury.address)) - treasuryBefore).to.equal(fees);
  });
});

describe('PrestoLmsrMarket pause and cancel', () => {
  it('guardian can pause, blocking buys but not claims', async () => {
    const { usdc, market, deployer, alice } = await deployMarket({ outcomes: 2 });
    // deployer is the guardian (passed as guardian_ in the helper).
    await market.connect(deployer).pause();
    const shares = USDC(10);
    const cost = await market.buyCost(0, shares);
    await usdc.connect(alice).approve(await market.getAddress(), cost * 2n);
    await expect(market.connect(alice).buy(0, shares, cost * 2n)).to.be.revertedWithCustomError(market, 'EnforcedPause');
    await market.connect(deployer).unpause();
    await market.connect(alice).buy(0, shares, cost * 2n); // works again
    expect(await market.sharesOf(0, alice.address)).to.equal(shares);
  });

  it('non-guardian cannot pause', async () => {
    const { market, alice } = await deployMarket({ outcomes: 2 });
    await expect(market.connect(alice).pause()).to.be.revertedWithCustomError(market, 'NotGuardian');
  });

  it('resolver cancel lets holders refund their LMSR value', async () => {
    const { usdc, market, resolver, alice } = await deployMarket({ outcomes: 2 });
    await buyShares(usdc, market, alice, 0, USDC(30));
    const refundQuote = await market.sellRefund(0, USDC(30));
    await market.connect(resolver).cancel();
    expect(await market.state()).to.equal(4); // Canceled
    const before = await usdc.balanceOf(alice.address);
    await market.connect(alice).refund();
    // Refund is the full (fee-free) LMSR unwind value of the position.
    expect((await usdc.balanceOf(alice.address)) - before).to.equal(refundQuote);
    expect(await market.sharesOf(0, alice.address)).to.equal(0n);
  });

  it('timeoutCancel only fires after the resolution timeout', async () => {
    const { usdc, market, alice, close } = await deployMarket({ outcomes: 2 });
    await buyShares(usdc, market, alice, 0, USDC(15));
    await advancePastClose(close);
    await expect(market.timeoutCancel()).to.be.revertedWithCustomError(market, 'TimeoutNotReached');
    await advanceSeconds(7 * 24 * 60 * 60 + 60);
    await market.timeoutCancel();
    expect(await market.state()).to.equal(4); // Canceled
    await market.connect(alice).refund();
    expect(await market.sharesOf(0, alice.address)).to.equal(0n);
  });

  it('an abandoned DISPUTE can be timeout-canceled; both bonds return to their posters', async () => {
    const { usdc, market, resolver, bob, close, bond6 } = await deployMarket({ outcomes: 2 });
    await buyShares(usdc, market, bob, 1, USDC(20)); // bob holds a position so he can dispute
    await advancePastClose(close);

    await usdc.connect(resolver).approve(await market.getAddress(), bond6);
    await market.connect(resolver).propose(0, 'ipfs://evidence');
    const resolverAfterBond = await usdc.balanceOf(resolver.address);
    await usdc.connect(bob).approve(await market.getAddress(), bond6);
    await market.connect(bob).dispute('i disagree');
    const bobAfterBond = await usdc.balanceOf(bob.address);
    expect(await market.state()).to.equal(2); // Disputed

    // The resolver vanishes: nobody can resolveDisputed. Before the fix this locked every
    // holder's collateral forever (timeoutCancel rejected the Disputed state).
    await expect(market.timeoutCancel()).to.be.revertedWithCustomError(market, 'TimeoutNotReached');
    await advanceSeconds(7 * 24 * 60 * 60 + 60);
    await market.timeoutCancel();
    expect(await market.state()).to.equal(4); // Canceled

    // No adjudication happened, so neither side is slashed: each bond goes back to its poster.
    expect((await usdc.balanceOf(resolver.address)) - resolverAfterBond).to.equal(bond6);
    expect((await usdc.balanceOf(bob.address)) - bobAfterBond).to.equal(bond6);

    // Holders unwind their positions as with any cancellation.
    await market.connect(bob).refund();
    expect(await market.sharesOf(1, bob.address)).to.equal(0n);
  });

  it('an abandoned PROPOSAL that is timeout-canceled returns the proposer bond', async () => {
    const { usdc, market, resolver, alice, close, bond6 } = await deployMarket({ outcomes: 2 });
    await buyShares(usdc, market, alice, 0, USDC(15));
    await advancePastClose(close);

    await usdc.connect(resolver).approve(await market.getAddress(), bond6);
    await market.connect(resolver).propose(0, 'ipfs://evidence');
    const resolverAfterBond = await usdc.balanceOf(resolver.address);
    expect(await market.state()).to.equal(1); // Proposed

    await advanceSeconds(7 * 24 * 60 * 60 + 60);
    await market.timeoutCancel();
    expect(await market.state()).to.equal(4); // Canceled
    expect((await usdc.balanceOf(resolver.address)) - resolverAfterBond).to.equal(bond6);
  });
});
