import {
  BalancerApi,
  ChainId,
  Slippage,
  SwapKind,
  Token,
  TokenAmount,
  Swap,
  SwapBuildOutputExactIn,
  SwapBuildCallInput,
  ExactInQueryOutput,
} from "@balancer/sdk";

import { OrderBookApi, SupportedChainId } from '@cowprotocol/cow-sdk';

import { ethers } from "ethers";
import "dotenv/config";



// Addresses

// const GROUP_AVATAR_ADDRESS = "0x9B8654Fb0E83BbB8C3bf768e24AEA32E751f9A00";
// const GROUP_POOL_COL_ADDRESS = "0x51350d88c1bd32cc6a79368c9fb70373fb71f375"; // waGnoUSDCe
const GROUP_CRC_ADDRESS = "0xeed6d927047e29d762bfbaaba0816c5fd27911c5"; // s-HDGDL
const MEMBER_CRC_ADDRESS = "0x159e6881e6ec370b46f2fe9fe75cbdfd8f7877b4"; // s-CRC

// const GROUP_POOL_ADDRESS = "0x3ffea21b2f44fafd6938e3946005c8f4a12988b7" // RIght now this is a balancer v3 pool
// const MEMBER_POOL_ADDRESS = "0x02DDFBD01B55FA23297F13DFD7B0022FABF81E910002000000000000000000E8" // Balancer v2 LBP (not sure the address is required in bytes or not)

// Configuration
const chainId = SupportedChainId.GNOSIS_CHAIN
const orderBookApi = new OrderBookApi({ chainId });
const chainId_blcr = ChainId.GNOSIS_CHAIN; // for chiado testing it should be 10200
const rpcUrl_blcr = process.env.RPC_URL!; // for env.testing TESTNET_RPC_URL
const provider = new ethers.providers.JsonRpcProvider(rpcUrl_blcr);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

// Define pools and tokens
// const poolAddresses = [GROUP_POOL_ADDRESS, MEMBER_POOL_ADDRESS]; // Replace with actual Balancer pool addresses

// Define tokens
const tokenIn = new Token(chainId_blcr, MEMBER_CRC_ADDRESS, 18, "TOKEN_IN"); //For now we are hardcoding the direction of the sale
const tokenOut = new Token(chainId_blcr, GROUP_CRC_ADDRESS, 18, "TOKEN_OUT");
const swapAmount = TokenAmount.fromHumanAmount(tokenIn, "1.0"); // Amount to trade
const slippage = Slippage.fromPercentage("0.1"); // 0.1% slippage tolerance
const deadline = 999999999999999999n; // Deadline for the transaction

// Initialize Balancer API
// const balancerApi = new BalancerApi("https://api-v3.balancer.fi/", chainId_blcr);

// async function getBestPrice(poolAddress: string): Promise<ExactInQueryOutput> {
//   const sorPaths = await balancerApi.sorSwapPaths.fetchSorSwapPaths({
//     chainId: chainId_blcr,
//     tokenIn: tokenIn.address,
//     tokenOut: tokenOut.address,
//     swapKind: SwapKind.GivenIn,
//     swapAmount,
//   });

  console.log(sorPaths)

  const swap = new Swap({
    chainId: chainId_blcr,
    paths: sorPaths,
    swapKind: SwapKind.GivenIn,
  });

  const result = await swap.query(rpcUrl_blcr);
  console.log(
    `Pool ${poolAddress}: Input ${swap.inputAmount.amount} -> Output ${swap.outputAmount.amount}`
  );
  return result as ExactInQueryOutput;
}

async function executeArbitrage() {
  console.log("Checking arbitrage opportunities...");

  // Get prices from both pools
  const prices = await Promise.all(
    poolAddresses.map((poolAddress) => getBestPrice(poolAddress))
  );

  const [price1, price2] = prices;

  if (BigInt(price1.expectedAmountOut.amount) > BigInt(price2.expectedAmountOut.amount)) {
    console.log("Arbitrage opportunity found!");
    // await executeSwap(poolAddresses[0], poolAddresses[1], price1, price2);
  } else {
    console.log("No arbitrage opportunity detected.");
  }
}

// async function executeSwap(
//   buyPoolAddress: string,
//   sellPoolAddress: string,
//   buyPrice: ExactInQueryOutput,
//   sellPrice: ExactInQueryOutput
// ) {
//   try {
//     // Approve the Balancer vault to spend the tokens
//     const tokenContract = new ethers.Contract(
//       tokenIn.address,
//       ["function approve(address spender, uint256 amount)"],
//       wallet
//     );
//     const approveTx = await tokenContract.approve(balancerApi.vaultAddress, swapAmount.amount);
//     await approveTx.wait();

//     // Build the transaction data
//     const swap = new Swap({
//       chainId,
//       paths: buyPrice.paths,
//       swapKind: SwapKind.GivenIn,
//     });

//     const buildInput: SwapBuildCallInput = {
//       slippage,
//       deadline,
//       queryOutput: buyPrice,
//       wethIsEth: false,
//       sender: wallet.address,
//       recipient: wallet.address,
//     };

//     const callData = swap.buildCall(buildInput) as SwapBuildOutputExactIn;

//     console.log(`Executing transaction: Min Amount Out: ${callData.minAmountOut.amount}`);

//     // Execute the swap
//     const tx = await wallet.sendTransaction({
//       to: callData.to,
//       data: callData.callData,
//       value: callData.value,
//     });
//     console.log("Transaction sent:", tx.hash);
//     await tx.wait();
//     console.log("Transaction confirmed.");
//   } catch (error) {
//     console.error("Error executing arbitrage:", error);
//   }
// }

// Main function
(async () => {
  console.log("Starting arbitrage bot...");
  await executeArbitrage();
})();