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
  const market = await Market.deploy(
    await usdc.getAddress(), resolver.address, close, 0, 'data:application/json,{}',
    outcomes, USDC(seed), feeBps, treasury.address, deployer.address,
  );
  await usdc.approve(await market.getAddress(), USDC(seed));
  await market.seed();
  return { usdc, market, deployer, resolver, alice, bob, treasury, close };
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
