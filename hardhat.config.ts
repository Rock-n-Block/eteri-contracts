import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig, overrideTask } from "hardhat/config";
import hardhatUpgrades from "@openzeppelin/hardhat-upgrades";
import "dotenv/config";
import { getAbi } from "./scripts/getAbi.js";

const {PRIVATE_KEY, GAS_PRICE, ETHERSCAN_API_KEY} = process.env;

const compileAndGetAbi = overrideTask("build").setInlineAction(async(taskArgs, _hre, runSuper) => {
  await runSuper(taskArgs);
  getAbi();
}).build();

const compilationProfile = {
  version: "0.8.35",
  settings: {
    optimizer: {
      enabled: true,
      runs: 999999
    },
    evmVersion: "osaka"
  }
}

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin, hardhatUpgrades],
  tasks: [compileAndGetAbi],
  solidity: {
    profiles: {
      default: compilationProfile,
      production: compilationProfile
    },
    npmFilesToBuild: [
      "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol",
      "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol"
    ]
  },
  networks: {
    hoodi: {
      type: "http",
      url: "https://ethereum-hoodi-rpc.publicnode.com",
      chainId: 560048,
      accounts: [PRIVATE_KEY as string],
      gasPrice: +(GAS_PRICE as string)
    }
  },
  verify: {
    etherscan: {
      apiKey: ETHERSCAN_API_KEY
    }
  }
});
