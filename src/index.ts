import { DirectedGraph } from "graphology";
import { DataInterface } from "./dataInterface.js";
import {
  CirclesNode,
  CirclesEdge,
  Trade,
  EdgeInfo,
  Direction,
  Address,
  BalanceRow,
  TrustRelationRow,
} from "./interfaces/index.js";
import { Swap } from "@balancer/sdk";

// global variables
const LOG_ACTIVITY = false;
const QUERY_REFERENCE_AMOUNT = BigInt(1e17);
const EXPLORATION_RATE = 0.1;
const MIN_BUYING_AMOUNT = QUERY_REFERENCE_AMOUNT;
const SELLOFF_PRECISION = BigInt(1e12);
const PROFIT_THRESHOLD = 0n; // profit threshold, should be denominated in the colalteral curreny
// const GROUPS_CAP_LIQUIDITY = BigInt(500 * 1e18);
const RESYNC_INTERVAL = 1000 * 60 * 15; // Resync every 15 minutes
const DEFAULT_PRICE_REF_ADDRESS =
  "0x86533d1aDA8Ffbe7b6F7244F9A1b707f7f3e239b".toLowerCase() as Address; // METRI TEST SUPERGROUP
const TRADING_TOKEN =
  "0x6c76971f98945ae98dd7d4dfca8711ebea946ea6".toLowerCase() as Address; // wstETH
const TRADING_TOKEN_DECIMALS = 18;
const QUOTE_TOKEN =
  "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d".toLowerCase() as Address; // xDAI
const QUOTE_TOKEN_DEMICALS = 18;
const NODE_LIMIT = 5;

class ArbitrageBot {
  private graph: DirectedGraph;
  private explorationRate: number;
  private dataInterface: DataInterface;

  constructor(explorationRate: number = EXPLORATION_RATE) {
    this.graph = new DirectedGraph();
    this.explorationRate = explorationRate;
    this.dataInterface = new DataInterface({
      quoteReferenceAmount: QUERY_REFERENCE_AMOUNT,
      logActivity: LOG_ACTIVITY,
      quotingToken: QUOTE_TOKEN,
      collateralTokenDecimals: QUOTE_TOKEN_DEMICALS,
      tradingToken: TRADING_TOKEN,
      tradingTokenDecimals: TRADING_TOKEN_DECIMALS,
    });
  }

  // Add an init method to ArbitrageBot
  public async init(): Promise<void> {
    await this.dataInterface.init();
  }

  private async initializeGraph(): Promise<void> {
    console.log("Starting graph initialization...");
    console.time("Graph initialization");

    // 1. Get initial nodes and ensure uniqueness by avatar
    console.log("Loading initial nodes...");
    let nodes = await this.dataInterface.loadNodes(NODE_LIMIT);
    // Deduplicate nodes by avatar
    nodes = Array.from(
      new Map(nodes.map((node) => [node.avatar, node])).values(),
    );
    console.log(`Loaded ${nodes.length} unique initial nodes`);

    // 2. Get all group members first
    console.log("Fetching group members...");
    const groupNodes = nodes.filter((node) => node.isGroup);
    const groupMemberRelations = await this.dataInterface.getTrustRelations({
      trusters: groupNodes.map((node) => node.avatar),
    });
    const groupMemberAddresses = [
      ...new Set(groupMemberRelations.map((rel) => rel.trustee)),
    ];

    // 3. Fetch all relevant addresses for data queries (ensuring uniqueness)
    const allRelevantAddresses = [
      ...new Set([
        ...nodes.map((node) => node.avatar),
        ...groupMemberAddresses,
      ]),
    ];

    // 4. Fetch all data in bulk
    console.log("Fetching bulk data...");
    const [allBalances, allTrustRelations] = await Promise.all([
      this.dataInterface.getBalances(allRelevantAddresses),
      this.dataInterface.getTrustRelations(),
    ]);

    // 5. Create lookup maps
    const balancesByAccount = new Map<string, BalanceRow[]>();
    allBalances.forEach((balance) => {
      if (!balancesByAccount.has(balance.account)) {
        balancesByAccount.set(balance.account, []);
      }
      balancesByAccount.get(balance.account)!.push(balance);
    });

    const trustRelationsByTrustee = new Map<string, TrustRelationRow[]>();
    allTrustRelations.forEach((trust) => {
      if (!trustRelationsByTrustee.has(trust.trustee)) {
        trustRelationsByTrustee.set(trust.trustee, []);
      }
      trustRelationsByTrustee.get(trust.trustee)!.push(trust);
    });

    // 6. Estimate prices
    console.log("Estimating prices...");
    nodes = await this.estimatePrices(nodes);

    // 7. Add all nodes to graph
    console.log("Creating complete graph...");
    for (const node of nodes) {
      this.graph.addNode(node.avatar, node);
    }

    // 8. Create complete graph with initial zero liquidity
    console.log(`Creating edges between ${nodes.length} nodes...`);
    let edgeCount = 0;
    for (const sourceNode of nodes) {
      for (const targetNode of nodes) {
        if (sourceNode === targetNode) continue;

        this.graph.addEdge(sourceNode.avatar, targetNode.avatar, {
          liquidity: BigInt(0),
          lastUpdated: Date.now(),
        });
        edgeCount++;
        if (edgeCount % 1000 === 0) {
          console.log(`Created ${edgeCount} edges so far...`);
        }
      }
    }

    // 9. Calculate and update actual liquidity for edges
    console.log("Calculating edge liquidity...");
    for (const sourceNode of nodes) {
      for (const targetNode of nodes) {
        if (sourceNode === targetNode) continue;

        let relevantBalances: BalanceRow[] = [];
        if (targetNode.isGroup) {
          // For group targets, get balances of all group members
          const groupMembers = groupMemberRelations.filter(
            (rel) => rel.truster === targetNode.avatar,
          );
          groupMembers.forEach((member) => {
            const memberBalances = balancesByAccount.get(member.trustee) || [];
            relevantBalances.push(...memberBalances);
          });
        } else {
          relevantBalances = balancesByAccount.get(targetNode.avatar) || [];
        }

        let relevantTrustRelations: TrustRelationRow[] = [];
        if (sourceNode.isGroup) {
          // For group sources, get trust relations for all group members
          const groupMembers = groupMemberRelations.filter(
            (rel) => rel.truster === sourceNode.avatar,
          );
          groupMembers.forEach((member) => {
            const memberTrusts =
              trustRelationsByTrustee.get(member.trustee) || [];
            relevantTrustRelations.push(...memberTrusts);
          });
        } else {
          relevantTrustRelations =
            trustRelationsByTrustee.get(sourceNode.avatar) || [];
        }

        // Calculate total liquidity
        let totalLiquidity = BigInt(0);
        for (const balance of relevantBalances) {
          for (const trust of relevantTrustRelations) {
            if (balance.account === trust.truster) {
              totalLiquidity += balance.demurragedTotalBalance;
            }
          }
        }

        // Update edge liquidity if there is any
        if (totalLiquidity > 0n) {
          this.graph.updateEdgeAttribute(
            this.graph.edge(sourceNode.avatar, targetNode.avatar),
            "liquidity",
            () => totalLiquidity,
          );
        }
      }
    }

    console.log("Graph initialization complete");
    console.timeEnd("Graph initialization");

    // Log graph statistics
    console.log("\nGraph Statistics:");
    console.log(`Nodes: ${this.graph.order}`);
    console.log(`Edges: ${this.graph.size}`);
    console.log(
      `Density: ${(this.graph.size / (this.graph.order * (this.graph.order - 1))).toFixed(4)}`,
    );
  }

  private scoreEdge(edgeKey: string): bigint {
    // @todo: Bring in the lastUpdated value of nodes (whereby less uptodate nodes should be preferred?)
    if (edgeKey == "") {
      return 0n;
    }
    const edgeInfo = this.getEdgeInfo(edgeKey);

    // the logic is an estimate of the maximal profit:
    // It's the price delta times the liquidity
    const sourcePrice = edgeInfo.source.price;
    const targetPrice = edgeInfo.target.price;
    const liquidity = edgeInfo.edge.liquidity;

    // to deal with situations in which the prices aren't defined,
    // we choose to crop negative scores to 0, as there would not
    // be good deals to begin with
    if (!sourcePrice || !targetPrice) {
      return 0n;
    }
    const delta = targetPrice - sourcePrice;
    return delta <= 0 ? 0n : delta * liquidity;
  }

  private selectNextEdge(): string {
    if (Math.random() < this.explorationRate) {
      // @todo: improve this
      // randomly select an edge uniformly
      const edges = this.graph.edges();
      const randomIndex = Math.floor(Math.random() * edges.length);
      return edges[randomIndex];
    } else {
      // Select highest scoring edge
      return this.graph.reduceEdges(
        (best, current) =>
          this.scoreEdge(current) >= this.scoreEdge(best) ? current : best,
        "",
      );
    }
  }

  // Helper method for destructuring edge information since TypeScript
  // doesn't easily infer types from array destructuring
  private getEdgeInfo(edgeKey: string): EdgeInfo {
    const edge = this.graph.getEdgeAttributes(edgeKey);
    const sourceKey = this.graph.source(edgeKey);
    const targetKey = this.graph.target(edgeKey);
    const source = this.graph.getNodeAttributes(sourceKey);
    const target = this.graph.getNodeAttributes(targetKey);
    return {
      edge: edge as CirclesEdge,
      source: source as CirclesNode,
      target: target as CirclesNode,
      edgeKey: edgeKey,
      sourceKey: sourceKey,
      targetKey: targetKey,
    };
  }

  private async executeArbitrageRound(): Promise<void> {
    console.log("\nStarting new arbitrage round...");
    const edgeKey = this.selectNextEdge();

    console.log("Winnign edge score:", this.scoreEdge(edgeKey));

    console.log("Updating values for selected edge: ", edgeKey);
    const updatedEdgeInfo = await this.updateValues(edgeKey);

    console.log("Calculating optimal trade...");
    const optimalTrade = await this.calculateOptimalTrade(
      updatedEdgeInfo.source,
      updatedEdgeInfo.target,
      updatedEdgeInfo.edge.liquidity,
    );

    if (optimalTrade) {
      console.log(`Found trade with profit: ${optimalTrade.profit.toString()}`);
      if (optimalTrade.profit > PROFIT_THRESHOLD) {
        console.log("Trade exceeds profit threshold, executing...");
        await this.executeTrade(optimalTrade);
      } else {
        console.log("Trade below profit threshold, skipping execution");
      }
    } else {
      console.log("No viable trade found");
    }
  }

  private async updateValues(edgeKey: string): Promise<EdgeInfo> {
    const edgeInfo = this.getEdgeInfo(edgeKey);

    const currentSourcePrice = await this.getCurrentSpotPrice(edgeInfo.source);
    console.log(
      "Updated price for ",
      edgeInfo.source.avatar,
      ": ",
      currentSourcePrice,
    );
    const currentTargetPrice = await this.getCurrentSpotPrice(edgeInfo.target);
    console.log(
      "Updated price for ",
      edgeInfo.target.avatar,
      ": ",
      currentTargetPrice,
    );
    const currentEdgeLiquidity = await this.getCurrentLiquidity(
      edgeInfo.source,
      edgeInfo.target,
    );
    console.log(
      "Updated liquidity between:",
      edgeInfo.source.avatar,
      " and ",
      edgeInfo.target.avatar,
      ": ",
      currentEdgeLiquidity,
    );

    // Update the graph
    this.graph.updateEdgeAttributes(edgeKey, (attr) => {
      return {
        ...attr,
        liquidity: currentEdgeLiquidity,
        lastUpdated: Date.now(),
      };
    });

    this.graph.updateNodeAttributes(edgeInfo.sourceKey, (attr) => {
      return {
        ...attr,
        price: currentSourcePrice,
        lastUpdated: Date.now(),
      };
    });

    this.graph.updateNodeAttributes(edgeInfo.targetKey, (attr) => {
      return {
        ...attr,
        price: currentTargetPrice,
        lastUpdated: Date.now(),
      };
    });

    return this.getEdgeInfo(edgeKey);
  }

  private async estimatePrices(nodes: CirclesNode[]): Promise<CirclesNode[]> {
    // create a reference price for nodes whose price haven't been logged
    const referenceToken = await this.dataInterface.getERC20Token(
      DEFAULT_PRICE_REF_ADDRESS,
    );
    const referencePrice = (await this.dataInterface.getSpotPrice(
      referenceToken! as Address,
    ))!.inputAmount.amount;

    const latestPrices = await this.dataInterface.fetchLatestPrices(
      nodes.map((node) => node.erc20tokenAddress),
    );

    for (const node of nodes) {
      const latestPrice = latestPrices.get(node.erc20tokenAddress);
      if (!latestPrice) {
        // to avoid zero scores, we actually vary the prices around the reference price randomly using a normal distribution
        // random multiplier and divisor are numbers between 1000 and 1100.
        const randomMultiplier =
          1000n + BigInt(Math.floor(Math.random() * 100));
        const randomDivisor = 1000n + BigInt(Math.floor(Math.random() * 100));
        // the resultign price varies plusminus 10% from the reference price
        node.price = (referencePrice * randomMultiplier) / randomDivisor;
        node.lastUpdated = Date.now();
      } else {
        node.price = latestPrice.price;
        node.lastUpdated = latestPrice.timestamp;
      }
    }
    return nodes;
  }

  private async getCurrentSpotPrice(node: CirclesNode): Promise<bigint | null> {
    const swapData = await this.dataInterface.getSpotPrice(
      node.erc20tokenAddress,
    );
    if (!swapData) {
      return null;
    }
    return swapData.inputAmount.amount;
  }

  private async getCurrentLiquidity(
    source: CirclesNode,
    target: CirclesNode,
  ): Promise<bigint | null> {
    return this.dataInterface.getSimulatedLiquidity(source, target);
  }

  private async calculateOptimalTrade(
    source: CirclesNode,
    target: CirclesNode,
    liquidity: bigint,
  ): Promise<Trade | null> {
    let currentAmount = MIN_BUYING_AMOUNT;

    let collateralBalance = await this.dataInterface.getTradingTokenBalance();

    // Get initial quotes
    const initialBuyQuote = await this.dataInterface.getTradingQuote({
      tokenAddress: source.erc20tokenAddress,
      direction: Direction.BUY,
      amount: currentAmount,
    });

    const initialSellQuote = await this.dataInterface.getTradingQuote({
      tokenAddress: target.erc20tokenAddress,
      direction: Direction.SELL,
      amount: currentAmount,
    });

    if (
      !initialBuyQuote ||
      !initialSellQuote ||
      initialBuyQuote.inputAmount.amount > collateralBalance
    ) {
      return null;
    }

    let bestTrade: Trade = {
      buyQuote: initialBuyQuote,
      sellQuote: initialSellQuote,
      buyNode: source,
      sellNode: target,
      amount: currentAmount,
      profit:
        initialSellQuote.outputAmount.amount -
        initialBuyQuote.inputAmount.amount,
    };

    // @todo: This needs to be improved as right now it simply reverts wheneever it doesn't get a good quote (e.g. because of missing liquidity in the pools...)
    while (currentAmount < liquidity / 2n) {
      currentAmount *= 2n;

      // Get quotes for reduced amount
      const buyQuote = await this.dataInterface.getTradingQuote({
        tokenAddress: source.erc20tokenAddress,
        direction: Direction.BUY,
        amount: currentAmount,
      });

      const sellQuote = await this.dataInterface.getTradingQuote({
        tokenAddress: target.erc20tokenAddress,
        direction: Direction.SELL,
        amount: currentAmount,
      });

      if (!buyQuote || !sellQuote) {
        return bestTrade;
      }

      const currentProfit =
        sellQuote.outputAmount.amount - buyQuote.inputAmount.amount;

      // If profit decreased or the new quote exceeds the bot's balance in collateral, return the previous (best) trade
      if (
        currentProfit < bestTrade.profit ||
        buyQuote.inputAmount.amount > collateralBalance
      ) {
        return bestTrade;
      }

      // Update best trade if profit increased
      bestTrade = {
        buyQuote,
        sellQuote,
        buyNode: source,
        sellNode: target,
        amount: currentAmount,
        profit: currentProfit,
      };
    }

    return bestTrade;
  }

  async sellOffLeftoverCRC(tokenAddress: Address): Promise<void> {
    // Check if we have any remaining balance of either intermediate token
    const remainingBalance =
      await this.dataInterface.getBotERC20Balance(tokenAddress);

    // If we have any remaining balances, try to sell them back
    if (remainingBalance > SELLOFF_PRECISION) {
      console.log("Cleaning up remaining bought token ", tokenAddress);
      const cleanupQuote = await this.dataInterface.getTradingQuote({
        tokenAddress: tokenAddress,
        direction: Direction.SELL,
        amount: remainingBalance,
      });
      if (cleanupQuote) {
        await this.dataInterface.execSwap(cleanupQuote, Direction.SELL);
      }
    }
  }

  async executeTrade(trade: Trade): Promise<boolean> {
    console.log("Attempting to executing trade with following parameters:");
    console.log("Amount:", trade.amount.toString());
    console.log("Expected profit:", trade.profit.toString());
    console.log("Trade: ", trade);

    try {
      // Step 1: Execute the initial buy with fixed input
      //
      // get the initial buy token balance
      const initialBuyTokenBalance =
        await this.dataInterface.getBotERC20Balance(
          trade.buyNode.erc20tokenAddress,
        );

      console.log("Step 1: Executing initial buy...");
      const buyResult = await this.dataInterface.execSwap(
        trade.buyQuote,
        Direction.BUY,
      );
      if (!buyResult) {
        console.log("Initial buy failed, aborting trade");
        return false;
      }

      // we're retrying here to allow for the new balance to have settled.
      // The retry function works under the assumption that there is no initial or existing balance.
      const actualBoughtAmount =
        await this.dataInterface.getBotERC20BalanceWithRetry(
          trade.buyNode.erc20tokenAddress,
        );
      console.log("Actually bought amount:", actualBoughtAmount.toString());

      const actualBoughtAmountDemurragedUnits =
        await this.dataInterface.convertInflationaryToDemurrage(
          trade.buyNode.erc20tokenAddress,
          actualBoughtAmount,
        );

      // Step 2: Transfer to target token
      console.log("Step 2: Transferring to target token...");
      // In this step, we'll try and transfer as much as we can using the pathfinder. The transferResult is the amount we managed to transfer (in demurragedUnits)
      const transferResult = await this.dataInterface.changeCRC({
        from: trade.buyNode,
        to: trade.sellNode,
        requestedAmount: actualBoughtAmountDemurragedUnits,
      });

      // wrap the resulting token (we know this does not need to call the lift address because the token is liquid.)
      await this.dataInterface.sdkAvatar?.wrapInflationErc20(
        trade.sellNode.avatar,
        transferResult,
      );

      if (transferResult == 0n) {
        console.log(
          "Transfer failed, attempting to sell back initial tokens...",
        );
      } else {
        // Step 3: Execute final sell
        console.log("Step 3: Executing final sell...");
        // Get new sell quote based on actual amount
        //
        const actualSellAmount = await this.dataInterface.getBotERC20Balance(
          trade.sellNode.erc20tokenAddress,
        );

        const finalSellQuote = await this.dataInterface.getTradingQuote({
          tokenAddress: trade.sellQuote.inputAmount.token.address as Address,
          direction: Direction.SELL,
          amount: actualSellAmount,
        });
        if (!finalSellQuote) {
          console.log(
            "Could not get final sell quote, attempting to sell back initial tokens...",
          );
        } else {
          const sellResult = await this.dataInterface.execSwap(
            finalSellQuote,
            Direction.SELL,
          );
          if (!sellResult) {
            console.log("Final sell failed");
          }
        }
      }

      // Clean Up
      console.log("Cleaning up any leftover amounts of the CRC");
      await this.sellOffLeftoverCRC(trade.buyNode.erc20tokenAddress);
      await this.sellOffLeftoverCRC(trade.sellNode.erc20tokenAddress);
      return true;
    } catch (error) {
      console.error("Error during trade execution:", error);
      return false;
    }
  }

  private async resyncGraph() {
    // @dev: for now we just reinitialise the Graph but down the line
    // should find ways to not throw away all the cached info
    await this.initializeGraph();
  }

  public async run(): Promise<void> {
    let lastResync = Date.now();

    await this.initializeGraph();

    while (true) {
      const currentTime = Date.now();
      if (currentTime - lastResync > RESYNC_INTERVAL) {
        await this.resyncGraph();
        lastResync = currentTime;
      }

      await this.executeArbitrageRound();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Add delay between rounds
    }
  }
}

async function main() {
  const bot = new ArbitrageBot(EXPLORATION_RATE);
  await bot.init();
  await bot.run().catch(console.error);
}

main().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});
