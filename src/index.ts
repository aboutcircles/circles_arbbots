import { OrderBookApi, SupportedChainId, OrderSigningUtils, UnsignedOrder, OrderKind, SigningScheme } from "@cowprotocol/cow-sdk";
import { ethers, Contract } from "ethers";
import type { Web3Provider } from '@ethersproject/providers'
import "dotenv/config";

// Load environment variables
const chainId = SupportedChainId.GNOSIS_CHAIN
const rpcUrl = process.env.RPC_URL!;
const privateKey = process.env.PRIVATE_KEY!;
const signerAddress = process.env.ARBBOT_ADDRESS!;
const relayerAddress = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110";

// Initialize provider and wallet
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

// Initialize CoW Protocol OrderBook API
const orderBookApi = new OrderBookApi({ chainId });
// const orderSigningUtils = new OrderSigningUtils();

// Token addresses
const tokenInAddress = "0xeed6d927047e29d762bfbaaba0816c5fd27911c5"; 
const tokenOutAddress = "0xc0d871bd13ebdf5c4ff059d8243fb38210608bd6";

// Helper function to get token balance
async function getTokenBalance(tokenAddress: string, walletAddress: string): Promise<bigint> {
    const erc20Abi = ["function balanceOf(address owner) view returns (uint256)"];
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
    const balance = await tokenContract.balanceOf(walletAddress);
    return BigInt(balance.toString());
}

// Create and sign limit order
async function createLimitOrder() {
    console.log(`Creating limit order for signer: ${signerAddress}`);

    // Get the total balance of the InToken

    // const sellAmount = await getTokenBalance(tokenInAddress, signerAddress);
    // if (sellAmount === 0n) {
    //     console.error("No balance available for the InToken. Exiting.");
    //     return;
    // }

  const sellAmount = BigInt(1) * BigInt(10 ** 18); // 1 InToken

    console.log(`InToken balance: ${sellAmount.toString()}`);

    // Approve the relayer to spend the sellAmount
    console.log("Approving relayer to spend InToken...");
    await approveRelayer(tokenInAddress, sellAmount);


    // Define the minimum amount of OutToken you want to receive
    const minBuyAmount = sellAmount * BigInt(1); // 1:1 ratio

    // Define the order
    const order: UnsignedOrder = {
        sellToken: tokenInAddress,
        buyToken: tokenOutAddress,
        sellAmount: sellAmount.toString(),
        buyAmount: minBuyAmount.toString(),
        validTo: Math.floor(Date.now() / 1000) + 3600, // Order valid for 1 hour
        appData: "0xb48d38f93eaa084033fc5970bf96e559c33c4cdc07d889ab00b4d63f9590739d", // Optional metadata
        feeAmount: "0", // Adjust if necessary
        partiallyFillable: true,
        kind: OrderKind.SELL, // "sell" means you're selling tokenIn for tokenOut
        receiver: signerAddress, // Tokens will be sent back to the same address
        // from: signerAddress,
    };

    console.log("Signing the order...");
    const { signature, signingScheme } = await OrderSigningUtils.signOrder(order, chainId, wallet);

    console.log("Submitting the order to CoW Protocol...");
    try {
        const orderId = await orderBookApi.sendOrder({
            ...order,
            signature,
            from: signerAddress,
            appData: "{}",
            signingScheme: signingScheme as unknown as SigningScheme
        });
        console.log(`Order successfully submitted! Order ID: ${orderId}`);
    } catch (error) {
        console.error("Failed to submit the order:", error);
    }
}

// Approve relayer to spend tokens
async function approveRelayer(tokenAddress: string, amount: bigint): Promise<void> {
  const approveAbi = [
      {
          inputs: [
              { name: '_spender', type: 'address' },
              { name: '_value', type: 'uint256' },
          ],
          name: 'approve',
          outputs: [{ type: 'bool' }],
          stateMutability: 'nonpayable',
          type: 'function',
      },
  ];

  const signer = provider.getSigner();
  const tokenContract = new Contract(tokenAddress, approveAbi, wallet);

  const tx = await tokenContract.approve(relayerAddress, amount);
  console.log('Approval transaction:', tx);
  await tx.wait();
  console.log('Approval transaction confirmed');
}

// Main function
(async () => {
    console.log("Starting limit order creation...");
    await createLimitOrder();
})();