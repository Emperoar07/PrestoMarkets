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

  it('wadMul and wadDiv round-trip', async () => {
    const probe = await (await ethers.getContractFactory('WadProbe')).deploy();
    const WAD = 10n ** 18n;
    const a = 3n * WAD;
    const b = 7n * WAD;
    const prod = await probe.product(a, b); // 21 WAD
    expect(prod).to.equal(21n * WAD);
    const quot = await probe.quotient(prod, b); // back to 3 WAD
    expect(quot).to.equal(a);
  });
});
