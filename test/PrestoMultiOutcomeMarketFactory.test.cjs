const { expect } = require('chai');
const { ethers } = require('hardhat');

const MarketKind = {
  Prediction: 0,
  Opinion: 1,
  Opportunity: 2,
};

async function latestTime() {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp;
}

async function deployFactoryFixture() {
  const [owner, creator, resolver, feeRecipient, nextOwner, outsider] = await ethers.getSigners();
  const MockUSDC = await ethers.getContractFactory('MockUSDC');
  const collateral = await MockUSDC.deploy();
  const PrestoMultiOutcomeMarketFactory = await ethers.getContractFactory('PrestoMultiOutcomeMarketFactory');
  const factory = await PrestoMultiOutcomeMarketFactory.connect(owner).deploy(await collateral.getAddress());

  return {
    collateral,
    factory,
    owner,
    creator,
    resolver,
    feeRecipient,
    nextOwner,
    outsider,
  };
}

describe('PrestoMultiOutcomeMarketFactory', function () {
  it('creates multi-outcome markets with current fee settings', async function () {
    const { collateral, factory, owner, creator, resolver, feeRecipient } = await deployFactoryFixture();
    const closeTime = (await latestTime()) + 7200;

    await factory.connect(owner).setFees(feeRecipient.address, 250);
    const tx = await factory.connect(creator).createMarket(
      resolver.address,
      closeTime,
      'ipfs://market-metadata',
      MarketKind.Opportunity,
      6,
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === 'MarketCreated');

    const marketAddress = event.args.market;
    const market = await ethers.getContractAt('PrestoMultiOutcomeMarket', marketAddress);

    expect(await factory.marketCount()).to.equal(1);
    expect(await factory.markets(0)).to.equal(marketAddress);
    expect(await market.collateral()).to.equal(await collateral.getAddress());
    expect(await market.creator()).to.equal(creator.address);
    expect(await market.resolver()).to.equal(resolver.address);
    expect(await market.feeRecipient()).to.equal(feeRecipient.address);
    expect(await market.protocolFeeBps()).to.equal(250);
    expect(await market.marketKind()).to.equal(MarketKind.Opportunity);
    expect(await market.closeTime()).to.equal(closeTime);
    expect(await market.metadataURI()).to.equal('ipfs://market-metadata');
    expect(await market.outcomeCount()).to.equal(6);
  });

  it('restricts owner controls', async function () {
    const { factory, owner, feeRecipient, nextOwner, outsider } = await deployFactoryFixture();

    await expect(factory.connect(outsider).setFees(feeRecipient.address, 100)).to.be.revertedWithCustomError(factory, 'NotOwner');
    await expect(factory.setFees(ethers.ZeroAddress, 100)).to.be.revertedWithCustomError(factory, 'ZeroAddress');
    await expect(factory.setFees(feeRecipient.address, 501)).to.be.revertedWithCustomError(factory, 'InvalidFee');

    await expect(factory.setFees(feeRecipient.address, 100))
      .to.emit(factory, 'FeesUpdated')
      .withArgs(feeRecipient.address, 100);

    await expect(factory.connect(outsider).transferOwnership(nextOwner.address)).to.be.revertedWithCustomError(factory, 'NotOwner');
    await expect(factory.connect(owner).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, 'ZeroAddress');
    await expect(factory.connect(owner).transferOwnership(nextOwner.address))
      .to.emit(factory, 'OwnershipTransferred')
      .withArgs(owner.address, nextOwner.address);
  });

  it('rejects a zero collateral constructor', async function () {
    const PrestoMultiOutcomeMarketFactory = await ethers.getContractFactory('PrestoMultiOutcomeMarketFactory');

    await expect(PrestoMultiOutcomeMarketFactory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(PrestoMultiOutcomeMarketFactory, 'ZeroAddress');
  });
});
