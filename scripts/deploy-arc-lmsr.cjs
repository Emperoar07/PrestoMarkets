const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

// One LMSR factory handles both binary and multi-outcome markets (via the outcomeCount arg), so V3
// needs a single factory per collateral: USDC and EURC. Each is its own pause guardian + fee owner
// (the deployer). Run after funding the deployer with Arc gas:
//   npx hardhat run scripts/deploy-arc-lmsr.cjs --network arc
const ARC_CHAIN_ID = 5042002n;
const ARC_USDC = process.env.ARC_USDC_ADDRESS ?? process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000';
const ARC_EURC = process.env.ARC_EURC_ADDRESS ?? process.env.NEXT_PUBLIC_EURC_ADDRESS ?? '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  if (!deployer) throw new Error('Missing deployer. Set PRIVATE_KEY in the environment before deploying.');
  if (network.chainId !== ARC_CHAIN_ID) {
    throw new Error(`Expected Arc Testnet chain ${ARC_CHAIN_ID}, got ${network.chainId}`);
  }

  console.log('========================================');
  console.log('PrestoLmsrMarketFactory (V3) Deployment');
  console.log('========================================');
  console.log('Network:', hre.network.name);
  console.log('Chain ID:', network.chainId.toString());
  console.log('Deployer:', deployer.address);
  console.log('USDC:', ARC_USDC);
  console.log('EURC:', ARC_EURC);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
  console.log('----------------------------------------');

  const Factory = await ethers.getContractFactory('PrestoLmsrMarketFactory');

  const usdcFactory = await Factory.deploy(ARC_USDC);
  await usdcFactory.waitForDeployment();
  const usdcFactoryAddress = await usdcFactory.getAddress();
  console.log('LMSR factory (USDC):', usdcFactoryAddress);

  const eurcFactory = await Factory.deploy(ARC_EURC);
  await eurcFactory.waitForDeployment();
  const eurcFactoryAddress = await eurcFactory.getAddress();
  console.log('LMSR factory (EURC):', eurcFactoryAddress);

  const deployment = {
    chainName: 'arc-testnet',
    chainId: Number(ARC_CHAIN_ID),
    lmsrMarketFactory: usdcFactoryAddress,
    lmsrEurcMarketFactory: eurcFactoryAddress,
    usdc: ARC_USDC,
    eurc: ARC_EURC,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const deploymentPath = path.join(dataDir, 'arc-testnet-lmsr.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log('Saved:', deploymentPath);

  console.log('----------------------------------------');
  console.log('Set frontend env (Production):');
  console.log(`NEXT_PUBLIC_LMSR_MARKET_FACTORY_ADDRESS=${usdcFactoryAddress}`);
  console.log(`NEXT_PUBLIC_EURC_LMSR_MARKET_FACTORY_ADDRESS=${eurcFactoryAddress}`);
  console.log('========================================');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
