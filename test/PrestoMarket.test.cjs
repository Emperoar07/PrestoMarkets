const { expect } = require('chai');
const { ethers } = require('hardhat');

const MarketKind = {
  Prediction: 0,
  Opinion: 1,
  Opportunity: 2,
};

const State = {
  Active: 0,
  Resolved: 1,
  Canceled: 2,
};

const usdc = (value) => ethers.parseUnits(String(value), 6);

async function latestTime() {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp;
}

async function increaseToClose(market) {
  const closeTime = await market.closeTime();
  await ethers.provider.send('evm_setNextBlockTimestamp', [Number(closeTime) + 1]);
  await ethers.provider.send('evm_mine');
}

async function deployMarketFixture({ feeBps = 0 } = {}) {
  const [creator, resolver, feeRecipient, yesTrader, noTrader, outsider] = await ethers.getSigners();
  const MockUSDC = await ethers.getContractFactory('MockUSDC');
  const collateral = await MockUSDC.deploy();
  const PrestoMarket = await ethers.getContractFactory('PrestoMarket');
  const closeTime = (await latestTime()) + 3600;
  const market = await PrestoMarket.deploy(
    await collateral.getAddress(),
    creator.address,
    resolver.address,
    feeRecipient.address,
    feeBps,
    MarketKind.Prediction,
    closeTime,
    'ipfs://market-metadata',
  );

  for (const trader of [yesTrader, noTrader]) {
    await collateral.mint(trader.address, usdc(1_000));
    await collateral.connect(trader).approve(await market.getAddress(), usdc(1_000));
  }

  return {
    collateral,
    market,
    creator,
    resolver,
    feeRecipient,
    yesTrader,
    noTrader,
    outsider,
  };
}

describe('PrestoMarket', function () {
  it('stores immutable market setup', async function () {
    const { collateral, market, creator, resolver, feeRecipient } = await deployMarketFixture({ feeBps: 125 });

    expect(await market.collateral()).to.equal(await collateral.getAddress());
    expect(await market.creator()).to.equal(creator.address);
    expect(await market.resolver()).to.equal(resolver.address);
    expect(await market.feeRecipient()).to.equal(feeRecipient.address);
    expect(await market.protocolFeeBps()).to.equal(125);
    expect(await market.marketKind()).to.equal(MarketKind.Prediction);
    expect(await market.metadataURI()).to.equal('ipfs://market-metadata');
    expect(await market.state()).to.equal(State.Active);
  });

  it('lets users buy YES and NO fixed shares', async function () {
    const { collateral, market, yesTrader, noTrader } = await deployMarketFixture();

    await expect(market.connect(yesTrader).buy(0, usdc(100)))
      .to.emit(market, 'SharesBought')
      .withArgs(yesTrader.address, yesTrader.address, 0, usdc(100));
    await expect(market.connect(noTrader).buy(1, usdc(75)))
      .to.emit(market, 'SharesBought')
      .withArgs(noTrader.address, noTrader.address, 1, usdc(75));

    expect(await market.sharesOf(0, yesTrader.address)).to.equal(usdc(100));
    expect(await market.sharesOf(1, noTrader.address)).to.equal(usdc(75));
    expect(await market.totalShares(0)).to.equal(usdc(100));
    expect(await market.totalShares(1)).to.equal(usdc(75));
    expect(await market.totalCollateral()).to.equal(usdc(175));
    expect(await collateral.balanceOf(await market.getAddress())).to.equal(usdc(175));
  });

  it('previews fixed-share buy math without mutating balances', async function () {
    const { market, yesTrader, noTrader } = await deployMarketFixture();

    let [shares, probabilityBps, estimatedPayout] = await market.previewBuy(0, usdc(10));
    expect(shares).to.equal(usdc(10));
    expect(probabilityBps).to.equal(5000);
    expect(estimatedPayout).to.equal(usdc(20));

    await market.connect(yesTrader).buy(0, usdc(25));
    await market.connect(noTrader).buy(1, usdc(75));

    [shares, probabilityBps, estimatedPayout] = await market.previewBuy(0, usdc(10));
    expect(shares).to.equal(usdc(10));
    expect(probabilityBps).to.equal(2500);
    expect(estimatedPayout).to.equal(usdc(40));
  });

  it('supports buying shares for another recipient', async function () {
    const { market, yesTrader, outsider } = await deployMarketFixture();

    await market.connect(yesTrader).buyFor(outsider.address, 0, usdc(42));

    expect(await market.sharesOf(0, outsider.address)).to.equal(usdc(42));
    expect(await market.sharesOf(0, yesTrader.address)).to.equal(0);
  });

  it('rejects invalid buys', async function () {
    const { market, yesTrader, outsider } = await deployMarketFixture();

    await expect(market.connect(yesTrader).buy(2, usdc(1))).to.be.revertedWithCustomError(market, 'InvalidOutcome');
    await expect(market.connect(yesTrader).buy(0, 0)).to.be.revertedWith('amount required');
    await expect(market.connect(yesTrader).buyFor(ethers.ZeroAddress, 0, usdc(1))).to.be.revertedWithCustomError(market, 'ZeroAddress');

    await increaseToClose(market);
    await expect(market.connect(outsider).buy(0, usdc(1))).to.be.revertedWithCustomError(market, 'MarketClosed');
  });

  it('allows only the resolver to resolve after close', async function () {
    const { market, resolver, yesTrader, outsider } = await deployMarketFixture();

    await market.connect(yesTrader).buy(0, usdc(100));
    await expect(market.connect(resolver).resolve(0, 'ipfs://evidence')).to.be.revertedWithCustomError(market, 'MarketNotClosed');

    await increaseToClose(market);
    await expect(market.connect(outsider).resolve(0, 'ipfs://evidence')).to.be.revertedWithCustomError(market, 'NotResolver');
    await expect(market.connect(resolver).resolve(2, 'ipfs://evidence')).to.be.revertedWithCustomError(market, 'InvalidOutcome');
    await expect(market.connect(resolver).resolve(1, 'ipfs://evidence')).to.be.revertedWithCustomError(market, 'NoWinningShares');

    await expect(market.connect(resolver).resolve(0, 'ipfs://evidence'))
      .to.emit(market, 'MarketResolved')
      .withArgs(0, 'ipfs://evidence', usdc(100));

    expect(await market.state()).to.equal(State.Resolved);
    expect(await market.winningOutcome()).to.equal(0);
    expect(await market.resolutionURI()).to.equal('ipfs://evidence');
    expect(await market.resolvedCollateral()).to.equal(usdc(100));
  });

  it('supports an optimistic proposal and public dispute before settlement', async function () {
    const { market, resolver, yesTrader, outsider } = await deployMarketFixture();

    await market.connect(yesTrader).buy(0, usdc(100));
    await increaseToClose(market);

    await expect(market.connect(outsider).settleProposedResolution()).to.be.revertedWithCustomError(market, 'NoResolutionProposal');
    await expect(market.connect(resolver).proposeResolution(0, 'ipfs://evidence'))
      .to.emit(market, 'ResolutionProposed')
      .withArgs(resolver.address, 0, 'ipfs://evidence');

    expect(await market.proposedOutcome()).to.equal(0);
    expect(await market.proposalProposer()).to.equal(resolver.address);

    await expect(market.connect(outsider).settleProposedResolution()).to.be.revertedWithCustomError(market, 'ChallengeWindowOpen');
    await expect(market.connect(outsider).disputeResolution('wrong evidence'))
      .to.emit(market, 'ResolutionDisputed')
      .withArgs(outsider.address, 'wrong evidence');
    await expect(market.connect(resolver).settleProposedResolution()).to.be.revertedWithCustomError(market, 'ResolutionDisputedAlready');
  });

  it('settles an undisputed optimistic proposal after the challenge window', async function () {
    const { market, resolver, yesTrader } = await deployMarketFixture();

    await market.connect(yesTrader).buy(0, usdc(100));
    await increaseToClose(market);
    await market.connect(resolver).proposeResolution(0, 'ipfs://evidence');

    const challengeEndsAt = await market.proposalChallengeEndsAt();
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(challengeEndsAt) + 1]);
    await ethers.provider.send('evm_mine');

    await expect(market.connect(resolver).settleProposedResolution())
      .to.emit(market, 'MarketResolved')
      .withArgs(0, 'ipfs://evidence', usdc(100));

    expect(await market.state()).to.equal(State.Resolved);
  });

  it('pays winning claims and sends protocol fees', async function () {
    const { collateral, market, resolver, feeRecipient, yesTrader, noTrader } = await deployMarketFixture({ feeBps: 500 });

    await market.connect(yesTrader).buy(0, usdc(60));
    await market.connect(noTrader).buy(1, usdc(40));
    await increaseToClose(market);
    await market.connect(resolver).resolve(0, 'ipfs://evidence');

    const [payout, fee] = await market.previewClaim(yesTrader.address);
    expect(payout).to.equal(usdc(95));
    expect(fee).to.equal(usdc(5));

    await expect(market.connect(yesTrader).claim())
      .to.emit(market, 'Claimed')
      .withArgs(yesTrader.address, usdc(95), usdc(5));

    expect(await collateral.balanceOf(feeRecipient.address)).to.equal(usdc(5));
    expect(await market.claimed(yesTrader.address)).to.equal(true);
    await expect(market.connect(yesTrader).claim()).to.be.revertedWithCustomError(market, 'AlreadyClaimed');
    await expect(market.connect(noTrader).claim()).to.be.revertedWith('no winning shares');
  });

  it('supports resolver cancellation and participant refunds', async function () {
    const { collateral, market, resolver, yesTrader, noTrader } = await deployMarketFixture();

    await market.connect(yesTrader).buy(0, usdc(25));
    await market.connect(noTrader).buy(1, usdc(35));

    await expect(market.connect(resolver).cancel()).to.be.revertedWithCustomError(market, 'MarketNotClosed');
    await increaseToClose(market);
    await expect(market.connect(resolver).cancel()).to.emit(market, 'MarketCanceled');

    expect(await market.state()).to.equal(State.Canceled);
    expect(await market.previewRefund(yesTrader.address)).to.equal(usdc(25));
    expect(await market.previewRefund(noTrader.address)).to.equal(usdc(35));

    const yesBalanceBefore = await collateral.balanceOf(yesTrader.address);
    await expect(market.connect(yesTrader).refund())
      .to.emit(market, 'Refunded')
      .withArgs(yesTrader.address, usdc(25));
    expect(await collateral.balanceOf(yesTrader.address)).to.equal(yesBalanceBefore + usdc(25));

    await expect(market.connect(yesTrader).refund()).to.be.revertedWithCustomError(market, 'AlreadyClaimed');
  });

  it('rejects constructor parameters that would make the market unsafe', async function () {
    const [creator, resolver, feeRecipient] = await ethers.getSigners();
    const MockUSDC = await ethers.getContractFactory('MockUSDC');
    const collateral = await MockUSDC.deploy();
    const PrestoMarket = await ethers.getContractFactory('PrestoMarket');
    const closeTime = (await latestTime()) + 3600;

    await expect(PrestoMarket.deploy(
      ethers.ZeroAddress,
      creator.address,
      resolver.address,
      feeRecipient.address,
      0,
      MarketKind.Prediction,
      closeTime,
      'ipfs://market-metadata',
    )).to.be.revertedWithCustomError(PrestoMarket, 'ZeroAddress');

    await expect(PrestoMarket.deploy(
      await collateral.getAddress(),
      creator.address,
      resolver.address,
      feeRecipient.address,
      501,
      MarketKind.Prediction,
      closeTime,
      'ipfs://market-metadata',
    )).to.be.revertedWithCustomError(PrestoMarket, 'InvalidFee');

    await expect(PrestoMarket.deploy(
      await collateral.getAddress(),
      creator.address,
      resolver.address,
      feeRecipient.address,
      0,
      MarketKind.Prediction,
      (await latestTime()) - 1,
      'ipfs://market-metadata',
    )).to.be.revertedWith('close must be future');
  });
});
