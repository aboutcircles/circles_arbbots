import pg from "pg";
const { Client } = pg;
import WebSocket from "ws";

if (!global.WebSocket) {
  (global as any).WebSocket = WebSocket;
}

import {
  BalanceRow,
  BaseGroupRow,
  CirclesNode,
  Direction,
  FetchBalancerQuoteParams,
  LatestPriceRow,
  TrustRelationRow,
  Address,
} from "./interfaces/index.js";

// Import ethers v6
import { ethers, Contract, Wallet } from "ethers";

// ABI
import {
  erc20Abi,
  hubV2Abi,
  erc20LiftAbi,
  inflationaryTokenAbi,
  bouncerOrgAbi,
} from "./abi/index.js";

import {
  BalancerApi,
  ChainId,
  Slippage,
  SwapKind,
  Token,
  TokenAmount,
  Swap,
  SwapBuildOutputExactOut,
  SwapBuildCallInput,
  ExactInQueryOutput,
  ExactOutQueryOutput,
} from "@balancer/sdk";

import { circlesConfig, Sdk, Avatar } from "@circles-sdk/sdk";
import { CirclesData, CirclesRpc } from "@circles-sdk/data";
import { PrivateKeyContractRunner } from "@circles-sdk/adapter-ethers";
import { baseGroupAbi } from "./abi/index.js";

// Global config
const rpcUrl = "https://rpc.gnosischain.com";
const DemurragedVSInflation = 1;
const chainId = ChainId.GNOSIS_CHAIN;
const botPrivateKey = process.env.PRIVATE_KEY!;

// Constant addresses
const erc20LiftAddress = "0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5";
const balancerVaultAddress = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
const crcBouncerOrgAddress = "0x98B1e32Af39C1d3a33A9a2b7fe167b1b4a190872";

/**
 * @notice Initializes core blockchain objects.
 * @dev provider connects to the blockchain via the JSON RPC URL.
 * @dev wallet is created using the provided bot private key.
 */
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new Wallet(botPrivateKey, provider);
const contractRunner = new PrivateKeyContractRunner(provider, botPrivateKey);

/**
 * @notice Balancer API instance used to fetch swap paths and quotes.
 */
const balancerApi = new BalancerApi("https://api-v3.balancer.fi/", chainId);

/**
 * @notice Circles SDK configuration objects.
 * @dev selectedCirclesConfig contains configuration details for the current chain.
 * @dev circlesRPC and circlesData are used to interact with the Circles network.
 * @dev hubV2Contract is the Circles hub contract instance.
 */
const selectedCirclesConfig = circlesConfig[chainId];
const hubV2Contract = new Contract(
  selectedCirclesConfig.v2HubAddress as string,
  hubV2Abi,
  wallet,
);

const bouncerOrgContract = new Contract(
  crcBouncerOrgAddress,
  bouncerOrgAbi,
  provider,
);

export class DataInterface {
  private client: pg.Client;
  public quoteReferenceAmount: bigint;
  public referenceToken: Token;
  public logActivity: boolean;
  public sdk?: Sdk;

  constructor(
    quoteReferenceAmount: bigint,
    logActivity: boolean = false,
    collateralToken: Address,
    collateralTokenDecimals: number,
  ) {
    this.client = new pg.Client({
      host: "144.76.163.174",
      port: 5432,
      database: "circles",
      user: "readonly_user",
      password: process.env.POSTGRESQL_PW,
    });
    this.quoteReferenceAmount = quoteReferenceAmount;
    this.referenceToken = new Token(
      chainId,
      collateralToken,
      Number(collateralTokenDecimals),
      "Reference Token",
    );
    this.logActivity = logActivity;
  }

  async init(): Promise<void> {
    // Initialize contract runner
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    // const wallet = new Wallet(botPrivateKey, this.provider);

    const contractRunner = new PrivateKeyContractRunner(
      provider,
      botPrivateKey,
    );
    await contractRunner.init();

    // Initialize SDK
    this.sdk = new Sdk(contractRunner, selectedCirclesConfig);

    // Connect to database
    await this.client
      .connect()
      .then(() => {
        console.log("Connected to PostgreSQL database");
      })
      .catch((err) => {
        console.error("Error connecting to PostgreSQL database", err);
      });
  }
  async cleanup(): Promise<void> {
    await this.client.end();
  }

  public async getBalances(tokens: string[]): Promise<BalanceRow[]> {
    try {
      const query = `
              SELECT
                  account,
                  "demurragedTotalBalance"::numeric as "demurragedTotalBalance",
                  "tokenAddress"
              FROM "V_CrcV2_BalancesByAccountAndToken"
              WHERE "tokenAddress" = ANY($1)
          `;

      const result = await this.client.query(query, [
        tokens.map((address) => address.toLowerCase()),
      ]);
      return result.rows.map((row) => ({
        account: row.account,
        demurragedTotalBalance: BigInt(row.demurragedTotalBalance), // Convert to BigInt if needed
        tokenAddress: row.tokenAddress,
      }));
    } catch (error) {
      console.error("Error fetching balances:", error);
      return [];
    }
  }

  public async getTrustRelations(
    params: {
      trusters?: string[];
      trustees?: string[];
    } = {},
  ): Promise<TrustRelationRow[]> {
    try {
      let query = `
                SELECT "truster", "trustee"
                FROM "V_CrcV2_TrustRelations"
            `;

      const conditions: string[] = [];
      const queryParams: string[] = [];

      if (params.trusters?.length) {
        let trusters = params.trusters.map((truster) => truster.toLowerCase());
        // Use ARRAY constructor instead of JSON.stringify
        queryParams.push(`{${trusters.join(",")}}`);
        conditions.push(`"truster" = ANY($${queryParams.length})`);
      }

      if (params.trustees?.length) {
        let trustees = params.trustees.map((trustee) => trustee.toLowerCase());
        // Use ARRAY constructor instead of JSON.stringify
        queryParams.push(`{${trustees.join(",")}}`);
        conditions.push(`"trustee" = ANY($${queryParams.length})`);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }

      const result = await this.client.query(query, queryParams);
      return result.rows.map((row) => ({
        truster: row.truster,
        trustee: row.trustee,
      }));
    } catch (error) {
      console.error("Error fetching trust relations:", error);
      return [];
    }
  }

  public async getMaxHolder(avatarAddress: string): Promise<Avatar | null> {
    try {
      const query = `
        SELECT "account", "demurragedTotalBalance"
        FROM "V_CrcV2_BalancesByAccountAndToken"
        WHERE "tokenAddress" = $1
        ORDER BY "demurragedTotalBalance" DESC
        LIMIT 1
      `;

      const result = await this.client.query(query, [
        avatarAddress.toLowerCase(),
      ]);

      if (result.rows.length > 0) {
        return await this.sdk!.getAvatar(result.rows[0].account);
      }

      return null;
    } catch (error) {
      console.error("Error fetching max holder:", error);
      return null;
    }
  }

  public async getSimulatedLiquidity(
    source: CirclesNode,
    target: CirclesNode,
  ): Promise<bigint> {
    try {
      const maxHolder = await this.getMaxHolder(source.avatar);
      if (!maxHolder) {
        console.log("No max holder found, returning 0");
        return 0n;
      }

      const maxTransferableAmount = maxHolder.maxTransferableAmount;

      // Handle the float conversion properly
      const amountWith18Decimals = maxTransferableAmount * Math.pow(10, 18);
      const roundedAmount = Math.round(amountWith18Decimals);

      // Add safety check
      if (!Number.isFinite(roundedAmount)) {
        console.warn(
          `Invalid amount after conversion: ${maxTransferableAmount}`,
        );
        return 0n;
      }

      // Convert to BigInt via string to avoid scientific notation issues
      const demurragedAmount = BigInt(roundedAmount.toString());

      // Convert demurraged to inflationary
      return this.convertDemurrageToInflationary(
        target.erc20tokenAddress,
        demurragedAmount,
      );
    } catch (error) {
      console.error("Error in getSimulatedLiquidity:", error);
      return 0n;
    }
  }

  /**
   * @notice Converts a demurrage token amount to its corresponding inflationary value.
   * @param tokenAddress The address of the inflationary token.
   * @param amount The amount to convert.
   * @return {Promise<bigint>} A promise that resolves to the converted inflationary value.
   */
  private async convertDemurrageToInflationary(
    tokenAddress: string,
    amount: bigint,
  ): Promise<bigint> {
    const inflationaryTokenContract = new Contract(
      tokenAddress,
      inflationaryTokenAbi,
      wallet,
    );
    const days = await inflationaryTokenContract.day(
      (await provider.getBlock("latest"))?.timestamp,
    );
    const inflationaryValue =
      await inflationaryTokenContract.convertDemurrageToInflationaryValue(
        amount,
        days,
      );

    return inflationaryValue;
  }

  /**
   * @notice Updates trust relationships with the bouncer organization for specified addresses
   * @param toTokens address to establish trust with
   * @return {Promise<boolean>} Returns true if rust relationships is successfully established
   */
  private async updateBouncerOrgTrust(tokenAvatar: string): Promise<boolean> {
    try {
      // Check if trust already exists
      const isTrusted = await hubV2Contract.isTrusted(
        crcBouncerOrgAddress,
        tokenAvatar,
      );

      if (!isTrusted) {
        // Force trust using the bouncer org contract
        const tx = await bouncerOrgContract.forceTrust(tokenAvatar);
        await tx.wait();
        console.log(`Bouncer Org forceTrusted: ${tokenAvatar}`);
      }

      return true;
    } catch (error) {
      console.error("Error updating bouncer org trust:", error);
      return false;
    }
  }

  private async getCurrentBackers(): Promise<string[]> {
    try {
      const balanceQuery = `
        SELECT
          "backer"
        FROM "CrcV2_CirclesBackingCompleted"
      `;

      const balanceResult = await this.client.query(balanceQuery);
      // Extract unique backer addresses from the query result
      return balanceResult.rows.map((row) => row.backer);
    } catch (error) {
      console.error("Error fetching backers:", error);
      return [];
    }
  }

  private async getBaseGroups(): Promise<BaseGroupRow[]> {
    try {
      const query = `
            SELECT
              "group",
              "mintHandler"
            FROM "CrcV2_BaseGroupCreated"
          `;

      const result = await this.client.query(query);
      return result.rows.map((row) => ({
        address: row.group,
        mintHandler: row.mintHandler,
      }));
    } catch (error) {
      console.error("Error fetching base groups:", error);
      return [];
    }
  }

  // @todo: We need to add groups to this!
  public async loadNodes(limit?: number): Promise<CirclesNode[]> {
    const nodes: CirclesNode[] = [];

    // we first get individual CRCs that are backers
    const backerAddresses = await this.getCurrentBackers();
    for (const backerAddress of backerAddresses) {
      // const isGroup = await this.checkIsGroup(backerAddress as string);
      const tokenAddress = await this.getERC20Token(backerAddress);
      const node: CirclesNode = {
        avatar: backerAddress as Address,
        isGroup: false,
        erc20tokenAddress: tokenAddress! as Address, // we know the tokenAddress must exist, since backing requires wrapping.
        lastUpdated: Date.now(),
      };
      nodes.push(node);
    }

    // we then simply load all basegroups with an ERC20 token (as I currently don't have a simple way to tell which ones have liquidity)
    const baseGroups = await this.getBaseGroups();
    for (const group of baseGroups) {
      // const isGroup = await this.checkIsGroup(group as string);
      const tokenAddress = await this.getERC20Token(group.address);
      if (!tokenAddress) continue;
      const node: CirclesNode = {
        avatar: group.address,
        isGroup: true,
        erc20tokenAddress: tokenAddress as Address,
        mintHandler: group.mintHandler,
        lastUpdated: Date.now(),
      };
      nodes.push(node);
    }
    if (limit) return nodes.slice(0, limit);
    return nodes;
  }

  public async fetchLatestPrices(
    tokenAddresses: string[],
  ): Promise<Map<string, LatestPriceRow | null>> {
    try {
      // const query = `
      //   SELECT
      //     "tokenAddress",
      //     "timestamp",
      //     "priceInEth"
      //   FROM "V_BPoolPrices"
      //   WHERE "tokenAddress" = ANY($1)
      // `;

      // const result = await this.client.query(query, [tokenAddresses]);

      const priceMap = new Map<string, LatestPriceRow | null>();

      // Initialize all addresses with null
      tokenAddresses.forEach((address) => {
        priceMap.set(address, null);
      });

      // Update prices where found
      // result.rows.forEach((row) => {
      //   priceMap.set(row.tokenAddress, {
      //     price: BigInt(row.priceInEth),
      //     timestamp: Number(row.timestamp),
      //   });
      // });

      return priceMap;
    } catch (error) {
      console.error("Error fetching latest prices:", error);
      return new Map();
    }
  }

  // private async checkIsGroup(address: string): Promise<boolean> {
  //   return await hubV2Contract.isGroup(address);
  // }

  public async getERC20Token(avatarAddress: string): Promise<string | null> {
    const tokenWrapperContract = new Contract(
      erc20LiftAddress,
      erc20LiftAbi,
      provider,
    );
    const tokenAddress = await tokenWrapperContract.erc20Circles(
      DemurragedVSInflation,
      avatarAddress,
    );

    if (tokenAddress === ethers.ZeroAddress) {
      return null;
    }
    return tokenAddress.toLowerCase();
  }

  /**
   * @notice Fetches the latest Balancer swap quote for a token.
   * @param tokenAddress The token address to get a quote for.
   * @param amountOut The output amount for the swap.
   * @return {Promise<Swap | null>} A promise that resolves to a Swap object if a valid path is found, or null otherwise.
   */
  public async fetchBalancerQuote({
    tokenAddress,
    direction = Direction.BUY,
    amount = this.quoteReferenceAmount,
    logQuote = this.logActivity,
  }: FetchBalancerQuoteParams): Promise<Swap | null> {
    const targetToken = new Token(
      chainId,
      tokenAddress as `0x${string}`,
      18,
      "Member Token",
    );

    let tokenIn;
    let tokenOut;
    let swapKind;
    let swapAmount;
    if (direction == Direction.BUY) {
      tokenIn = this.referenceToken;
      tokenOut = targetToken;
      swapKind = SwapKind.GivenOut;
      swapAmount = TokenAmount.fromRawAmount(tokenOut, amount);
    } else if (direction == Direction.SELL) {
      tokenIn = targetToken;
      tokenOut = this.referenceToken;
      swapKind = SwapKind.GivenIn;
      swapAmount = TokenAmount.fromRawAmount(tokenIn, amount);
    } else {
      console.error("ERROR: Unknown trade direction requested");
      return null;
    }

    const pathInput = {
      chainId,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      swapKind: swapKind,
      swapAmount: swapAmount,
    };
    const sorPaths = await balancerApi.sorSwapPaths
      .fetchSorSwapPaths(pathInput)
      .catch(() => {
        console.error("ERROR: Swap path not found");
      });

    // if there is no path, we return null
    if (!sorPaths || sorPaths.length === 0) {
      // if (logQuote) {
      //   const logValues = [
      //     Math.floor(Date.now() / 1000),
      //     this.referenceToken.address,
      //     targetToken.address,
      //     null,
      //     amountOut.toString(),
      //   ];
      //   // await loggerClient.query(logQuery, logValues);
      // }
      console.log("No path found");
      return null;
    }
    // Swap object provides useful helpers for re-querying, building call, etc
    const swap = new Swap({
      chainId,
      paths: sorPaths,
      swapKind,
    });
    // @todo: we're here hardcoding our knowledge of the internals of the fetchBalancerQuote function
    // if (logQuote) {
    //   const logValues = [
    //     Math.floor(Date.now() / 1000),
    //     inToken.address,
    //     outToken.address,
    //     swap.inputAmount.amount.toString(),
    //     swap.outputAmount.amount.toString(),
    //   ];
    //   await loggerClient.query(logQuery, logValues);
    // }

    // @dev We attempt to make this call to validate the swap parameters, ensuring we avoid potential errors such as `BAL#305` or other issues related to swap input parameters.
    const result = await swap
      .query(rpcUrl)
      .then(() => {
        return swap;
      })
      .catch((error: any) => {
        console.error(error?.shortMessage);
        return null;
      });

    return result;
  }

  /**
   * @notice Approves a specified token for spending by a designated operator.
   * @param tokenAddress The ERC20 token address.
   * @param operatorAddress The address to be approved.
   * @param amount The allowance amount (default is MAX_ALLOWANCE_AMOUNT).
   * @return {Promise<void>}
   */
  private async approveTokens(
    tokenAddress: string,
    operatorAddress: string,
    amount: bigint,
  ) {
    const groupTokenContract = new Contract(tokenAddress, erc20Abi, wallet);
    const approveTx = await groupTokenContract.approve(operatorAddress, amount);
    await approveTx.wait();
  }

  /**
   * @notice Executes an arbitrage deal by ensuring proper token allowances and performing the swap.
   * @param deal The Deal object containing the swap data and profitability flag.
   * @param member The group member associated with the deal (used for context/logging).
   * @return {Promise<boolean>} A promise that resolves to true if the swap is executed successfully, or false otherwise.
   */
  public async execSwap(
    swapData: Swap,
    direction: Direction,
  ): Promise<boolean> {
    console.log("Executing deal");
    const tokenAddressToApprove = swapData.inputAmount.token.address;
    const amountToApprove = swapData.inputAmount.amount;
    // If the token has not been approved yet, set the maximum allowance.
    const currentAllowance = await this.checkAllowance(
      tokenAddressToApprove,
      wallet.address,
      balancerVaultAddress,
    );
    if (currentAllowance < amountToApprove)
      await this.approveTokens(
        tokenAddressToApprove,
        balancerVaultAddress,
        amountToApprove - currentAllowance,
      );
    // Execute the swap using the prepared swap data.
    return await this.swapUsingBalancer(swapData, direction);
  }
  /**
   * @notice Checks the ERC20 token allowance for a given owner and spender.
   * @param tokenAddress The ERC20 token contract address.
   * @param ownerAddress The address owning the tokens.
   * @param spenderAddress The address allowed to spend the tokens.
   * @return {Promise<bigint>} A promise that resolves to the allowance as a bigint.
   */
  private async checkAllowance(
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
  ): Promise<bigint> {
    // Create a contract instance for the token
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);

    // Fetch the allowance
    const allowance = await tokenContract.allowance(
      ownerAddress,
      spenderAddress,
    );
    return allowance;
  }

  /**
   * @notice Executes a swap on Balancer using the provided Swap object.
   * @param swap The Swap object containing the swap parameters and paths.
   * @return {Promise<boolean>} A promise that resolves to true if the swap is executed successfully, or false otherwise.
   */
  private async swapUsingBalancer(
    swap: Swap,
    direction: Direction,
  ): Promise<boolean> {
    // Get up to date swap result by querying onchain
    let updated;

    if (direction == Direction.SELL) {
      updated = (await swap.query(rpcUrl)) as ExactInQueryOutput;
    } else if (direction == Direction.BUY) {
      updated = (await swap.query(rpcUrl)) as ExactOutQueryOutput;
    } else {
      return false;
    }

    const wethIsEth = false; // If true, incoming ETH will be wrapped to WETH, otherwise the Vault will pull WETH tokens
    const deadline = 999999999999999999n; // Deadline for the swap, in this case infinite
    const slippage = Slippage.fromPercentage("0.1"); // 0.1%

    let buildInput: SwapBuildCallInput;

    buildInput = {
      slippage,
      deadline,
      queryOutput: updated,
      wethIsEth,
      sender: wallet.address as `0x${string}`,
      recipient: wallet.address as `0x${string}`,
    };

    const callData = swap.buildCall(buildInput) as SwapBuildOutputExactOut;

    return await wallet
      .sendTransaction({ to: callData.to, data: callData.callData })
      .then((txResponse) => {
        console.log("Swap tx:", txResponse?.hash);

        return !!txResponse?.hash;
      })
      .catch(async () => {
        console.error("!!! Transaction failed !!!");

        return false;
      });
  }

  // private async getBalancesEstimator(): Promise<SparseMatrix> {
  //   try {
  //     const balanceQuery = `
  //       SELECT
  //         "account",
  //         "tokenAddress",
  //         "balance"
  //       FROM "V_CrcV2_BalancesByAccountAndToken"
  //       WHERE "balance" > 0
  //     `;

  //     const balanceResult = await this.client.query(balanceQuery);

  //     const accounts = new Set<string>();
  //     const tokens = new Set<string>();
  //     balanceResult.rows.forEach(row => {
  //       accounts.add(row.account);
  //       tokens.add(row.tokenAddress);
  //     });

  //     const accountArray = Array.from(accounts);
  //     const tokenArray = Array.from(tokens);

  //     const accountToIndex = new Map(accountArray.map((acc, i) => [acc, i]));
  //     this.tokenToIndex = new Map(tokenArray.map((token, i) => [token, i]));

  //     const entries = balanceResult.rows.map(row => ({
  //       i: accountToIndex.get(row.account)!,
  //       j: this.tokenToIndex.get(row.tokenAddress)!,
  //       value: parseFloat(row.balance)
  //     }));

  //     return sparse(entries, [accounts.size, tokens.size]);
  //   } catch (error) {
  //     console.error('Error fetching balances:', error);
  //     throw error;
  //   }
  // }

  // async getMatrices(): Promise<{
  //   trustMatrix: SparseMatrix;
  //   balanceMatrix: SparseMatrix;
  //   avatarToIndex: Map<string, number>;
  //   tokenToIndex: Map<string, number>;
  // }> {
  //   const trustMatrix = await this.getTrustGraphEstimator();
  //   const balanceMatrix = await this.getBalancesEstimator();

  //   return {
  //     trustMatrix,
  //     balanceMatrix,
  //     avatarToIndex: this.avatarToIndex!,
  //     tokenToIndex: this.tokenToIndex!
  //   };
  // }
}
