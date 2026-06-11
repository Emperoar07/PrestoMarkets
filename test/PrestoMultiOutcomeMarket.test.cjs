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

async function deployMarketFixture({ feeBps = 0, outcomeCount = 4 } = {}) {
  const [creator, resolver, feeRecipient, firstTrader, secondTrader, thirdTrader, outsider] = await ethers.getSigners();
  const MockUSDC = await ethers.getContractFactory('MockUSDC');
  const collateral = await MockUSDC.deploy();
  const PrestoMultiOutcomeMarket = await ethers.getContractFactory('PrestoMultiOutcomeMarket');
  const closeTime = (await latestTime()) + 3600;
  const market = await PrestoMultiOutcomeMarket.deploy(
    await collateral.getAddress(),
    creator.address,
    resolver.address,
    feeRecipient.address,
    feeBps,
    MarketKind.Prediction,
    closeTime,
    'ipfs://multi-outcome-market',
    outcomeCount,
  );

  for (const trader of [firstTrader, secondTrader, thirdTrader]) {
    await collateral.mint(trader.address, usdc(1_000));
    await collateral.connect(trader).approve(await market.getAddress(), usdc(1_000));
  }

  return {
    collateral,
    market,
    creator,
    resolver,
    feeRecipient,
    firstTrader,
    secondTrader,
    thirdTrader,
    outsider,
  };
}

describe('PrestoMultiOutcomeMarket', function () {
  it('stores immutable multi-outcome setup', async function () {
    const { collateral, market, creator, resolver, feeRecipient } = await deployMarketFixture({ feeBps: 125, outcomeCount: 5 });

    expect(await market.collateral()).to.equal(await collateral.getAddress());
    expect(await market.creator()).to.equal(creator.address);
    expect(await market.resolver()).to.equal(resolver.address);
    expect(await market.feeRecipient()).to.equal(feeRecipient.address);
    expect(await market.protocolFeeBps()).to.equal(125);
    expect(await market.marketKind()).to.equal(MarketKind.Prediction);
    expect(await market.metadataURI()).to.equal('ipfs://multi-outcome-market');
    expect(await market.outcomeCount()).to.equal(5);
    expect(await market.state()).to.equal(State.Active);
  });

  it('lets users buy any valid outcome', async function () {
    const { collateral, market, firstTrader, secondTrader, thirdTrader } = await deployMarketFixture();

    await expect(market.connect(firstTrader).buy(0, usdc(100)))
      .to.emit(market, 'SharesBought')
      .withArgs(firstTrader.address, firstTrader.address, 0, usdc(100));
    await expect(market.connect(secondTrader).buy(2, usdc(75)))
      .to.emit(market, 'SharesBought')
      .withArgs(secondTrader.address, secondTrader.address, 2, usdc(75));
    await expect(market.connect(thirdTrader).buy(3, usdc(25)))
      .to.emit(market, 'SharesBought')
      .withArgs(thirdTrader.address, thirdTrader.address, 3, usdc(25));

    expect(await market.sharesOf(0, firstTrader.address)).to.equal(usdc(100));
    expect(await market.sharesOf(2, secondTrader.address)).to.equal(usdc(75));
    expect(await market.totalShares(3)).to.equal(usdc(25));
    expect(await market.totalCollateral()).to.equal(usdc(200));
    expect(await collateral.balanceOf(await market.getAddress())).to.equal(usdc(200));
  });

  it('previews multi-outcome fixed-share buy math', async function () {
    const { market, firstTrader, secondTrader } = await deployMarketFixture({ outcomeCount: 4 });

    let [shares, probabilityBps, estimatedPayout] = await market.previewBuy(2, usdc(10));
    expect(shares).to.equal(usdc(10));
    expect(probabilityBps).to.equal(2500);
    expect(estimatedPayout).to.equal(usdc(40));

    await market.connect(firstTrader).buy(0, usdc(80));
    await market.connect(secondTrader).buy(2, usdc(20));

    [shares, probabilityBps, estimatedPayout] = await market.previewBuy(2, usdc(10));
    expect(shares).to.equal(usdc(10));
    expect(probabilityBps).to.equal(2000);
    expect(estimatedPayout).to.equal(usdc(50));
  });

  it('rejects out-of-range outcomes and unsafe constructor parameters', async function () {
    const { market, firstTrader } = await deployMarketFixture({ outcomeCount: 3 });

    await expect(market.connect(firstTrader).buy(3, usdc(1))).to.be.revertedWithCustomError(market, 'InvalidOutcome');
    await expect(market.connect(firstTrader).buy(0, 0)).to.be.revertedWith('amount required');

    const [creator, resolver, feeRecipient] = await ethers.getSigners();
    const MockUSDC = await ethers.getContractFactory('MockUSDC');
    const collateral = await MockUSDC.deploy();
    const PrestoMultiOutcomeMarket = await ethers.getContractFactory('PrestoMultiOutcomeMarket');
    const closeTime = (await latestTime()) + 3600;

    await expect(PrestoMultiOutcomeMarket.deploy(
      await collateral.getAddress(),
      creator.address,
      resolver.address,
      feeRecipient.address,
      0,
      MarketKind.Prediction,
      closeTime,
      'ipfs://market-metadata',
      1,
    )).to.be.revertedWithCustomError(PrestoMultiOutcomeMarket, 'InvalidOutcomeCount');

    await expect(PrestoMultiOutcomeMarket.deploy(
      await collateral.getAddress(),
      creator.address,
      resolver.address,
      feeRecipient.address,
      501,
      MarketKind.Prediction,
      closeTime,
      'ipfs://market-metadata',
      3,
    )).to.be.revertedWithCustomError(PrestoMultiOutcomeMarket, 'InvalidFee');
  });

  it('settles a selected winning outcome and pays claims with fees', async function () {
    const { collateral, market, resolver, feeRecipient, firstTrader, secondTrader, thirdTrader } = await deployMarketFixture({ feeBps: 500 });

    await market.connect(firstTrader).buy(0, usdc(60));
    await market.connect(secondTrader).buy(2, usdc(40));
    await market.connect(thirdTrader).buy(2, usdc(20));
    await increaseToClose(market);

    await expect(market.connect(resolver).resolve(2, 'ipfs://evidence'))
      .to.emit(market, 'MarketResolved')
      .withArgs(2, 'ipfs://evidence', usdc(120));

    const [payout, fee] = await market.previewClaim(secondTrader.address);
    expect(payout).to.equal(usdc(76));
    expect(fee).to.equal(usdc(4));

    await expect(market.connect(secondTrader).claim())
      .to.emit(market, 'Claimed')
      .withArgs(secondTrader.address, usdc(76), usdc(4));

    expect(await collateral.balanceOf(feeRecipient.address)).to.equal(usdc(4));
    await expect(market.connect(firstTrader).claim()).to.be.revertedWith('no winning shares');
  });

  it('supports optimistic proposal, dispute, and delayed settlement for multi-outcome markets', async function () {
    const { market, resolver, secondTrader, outsider } = await deployMarketFixture({ outcomeCount: 4 });

    await market.connect(secondTrader).buy(2, usdc(50));
    await increaseToClose(market);

    await expect(market.connect(resolver).proposeResolution(2, 'ipfs://evidence'))
      .to.emit(market, 'ResolutionProposed')
      .withArgs(resolver.address, 2, 'ipfs://evidence');
    await expect(market.connect(outsider).settleProposedResolution()).to.be.revertedWithCustomError(market, 'ChallengeWindowOpen');
    await expect(market.connect(outsider).disputeResolution('bad source'))
      .to.emit(market, 'ResolutionDisputed')
      .withArgs(outsider.address, 'bad source');
    await expect(market.connect(resolver).settleProposedResolution()).to.be.revertedWithCustomError(market, 'ResolutionDisputedAlready');
  });

  it('refunds shares across all outcomes after cancellation', async function () {
    const { market, resolver, firstTrader } = await deployMarketFixture({ outcomeCount: 5 });

    await market.connect(firstTrader).buy(0, usdc(10));
    await market.connect(firstTrader).buy(3, usdc(15));
    await increaseToClose(market);
    await expect(market.connect(resolver).cancel()).to.emit(market, 'MarketCanceled');

    expect(await market.previewRefund(firstTrader.address)).to.equal(usdc(25));
    await expect(market.connect(firstTrader).refund())
      .to.emit(market, 'Refunded')
      .withArgs(firstTrader.address, usdc(25));
    await expect(market.connect(firstTrader).refund()).to.be.revertedWithCustomError(market, 'AlreadyClaimed');
  });
});
