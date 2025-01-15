import { OrderBookApi, SupportedChainId, OrderSigningUtils, UnsignedOrder, OrderKind, SigningScheme, OrderQuoteRequest, OrderQuoteSideKindSell } from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import "dotenv/config";
import { sign } from "crypto";

// Load environment variables
const chainId = SupportedChainId.GNOSIS_CHAIN
const rpcUrl = process.env.RPC_URL!;
const privateKey = process.env.PRIVATE_KEY!;
const signerAddress = process.env.ARBBOT_ADDRESS!;

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

    // Define the minimum amount of OutToken you want to receive
    const minBuyAmount = sellAmount * BigInt(1); // 1:1 ratio

    //get a quote
    const quoteRequest: OrderQuoteRequest = {
      sellToken: tokenInAddress,
      buyToken: tokenOutAddress,
      from: signerAddress,
      receiver: signerAddress,
      sellAmountBeforeFee: sellAmount.toString(),
      kind: OrderQuoteSideKindSell.SELL,
  };

    const { quote } = await orderBookApi.getQuote(quoteRequest);

      // And feeAmount must be set to 0
      const feeAmount = '0'

      const order: UnsignedOrder = {
        ...quote,
        sellAmount: sellAmount.toString(),
        feeAmount,
        receiver: signerAddress,
      }


    // // Define the order
    // const order: UnsignedOrder = {
    //     sellToken: tokenInAddress,
    //     buyToken: tokenOutAddress,
    //     sellAmount: sellAmount.toString(),
    //     buyAmount: minBuyAmount.toString(),
    //     validTo: Math.floor(Date.now() / 1000) + 3600, // Order valid for 1 hour
    //     appData: "", // Optional metadata
    //     feeAmount: "0", // Adjust if necessary
    //     partiallyFillable: true,
    //     kind: OrderKind.SELL, // "sell" means you're selling tokenIn for tokenOut
    //     receiver: signerAddress, // Tokens will be sent back to the same address
    //     // from: signerAddress,
    // };

    console.log("Signing the order...");
    const { signature, signingScheme } = await OrderSigningUtils.signOrder(order, chainId, wallet);

    console.log("Submitting the order to CoW Protocol...");
    try {
        const orderId = await orderBookApi.sendOrder({
            ...order,
            signature,
            signingScheme: signingScheme as unknown as SigningScheme
        });
        console.log(`Order successfully submitted! Order ID: ${orderId}`);
    } catch (error) {
        console.error("Failed to submit the order:", error);
    }
}

// Main function
(async () => {
    console.log("Starting limit order creation...");
    await createLimitOrder();
})();