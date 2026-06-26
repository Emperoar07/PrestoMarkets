// Enable the protocol trading fee on the LMSR factories (owner-only). New markets created after
// this charge the fee; existing markets keep their creation-time fee. Run:
//   npx hardhat run scripts/set-fees.cjs --network arc
// Configure via env: FEE_BPS (default 100 = 1%), FEE_RECIPIENT (default the deployer).
const hre = require('hardhat');

const FACTORIES = [
  process.env.NEXT_PUBLIC_LMSR_MARKET_FACTORY_ADDRESS || '0xcc8B40ca4562f4fbCcfA1529a9dcE438280769aE',
  process.env.NEXT_PUBLIC_EURC_LMSR_MARKET_FACTORY_ADDRESS || '0x6E4F87b17B5746fEeA6A4dE0A10Ab9D0f7BF3F27',
];

async function main() {
  const { ethers } = hre;
  const [signer] = await ethers.getSigners();
  const bps = Number(process.env.FEE_BPS || 100);
  const recipient = process.env.FEE_RECIPIENT || signer.address;
  console.log('signer (factory owner):', signer.address);
  console.log('fee:', bps, 'bps | recipient:', recipient);

  const factory = await ethers.getContractFactory('PrestoLmsrMarketFactory');
  for (const addr of FACTORIES) {
    const f = factory.attach(addr);
    try {
      const owner = await f.owner();
      if (owner.toLowerCase() !== signer.address.toLowerCase()) {
        console.log(`  ${addr}: SKIP (owner is ${owner}, not the signer)`);
        continue;
      }
      const tx = await f.setFees(recipient, bps);
      await tx.wait();
      const now = await f.protocolFeeBps();
      console.log(`  ${addr}: setFees ok -> protocolFeeBps=${now} recipient=${await f.feeRecipient()}`);
    } catch (e) {
      console.log(`  ${addr}: FAILED ${e.shortMessage || e.message}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
