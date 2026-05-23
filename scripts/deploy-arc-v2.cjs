const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

const ARC_CHAIN_ID = 5042002n;
const ARC_USDC = process.env.ARC_USDC_ADDRESS ?? process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000';

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  if (!deployer) {
    throw new Error('Missing deployer. Set PRIVATE_KEY in the environment before deploying.');
  }

  if (network.chainId !== ARC_CHAIN_ID) {
    throw new Error(`Expected Arc Testnet chain ${ARC_CHAIN_ID}, got ${network.chainId}`);
  }

  console.log('========================================');
  console.log('PrestoMultiOutcomeMarketFactory Deployment');
  console.log('========================================');
  console.log('Network:', hre.network.name);
  console.log('Chain ID:', network.chainId.toString());
  console.log('Deployer:', deployer.address);
  console.log('USDC:', ARC_USDC);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance));
  console.log('----------------------------------------');

  const Factory = await ethers.getContractFactory('PrestoMultiOutcomeMarketFactory');
  const factory = await Factory.deploy(ARC_USDC);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  const deployment = {
    chainName: 'arc-testnet',
    chainId: Number(ARC_CHAIN_ID),
    multiOutcomeMarketFactory: factoryAddress,
    collateral: ARC_USDC,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const dataDir = path.join(process.cwd(), 'data');
  const deploymentPath = path.join(dataDir, 'arc-testnet-v2.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

  console.log('PrestoMultiOutcomeMarketFactory:', factoryAddress);
  console.log('Saved:', deploymentPath);
  console.log('----------------------------------------');
  console.log('Set frontend env:');
  console.log(`NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`NEXT_PUBLIC_USDC_ADDRESS=${ARC_USDC}`);
  console.log('========================================');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
