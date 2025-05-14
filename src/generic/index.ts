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
  SwapExecutionOptions,
} from "./interfaces/index.js";

// global variables
const LOG_ACTIVITY = true;
const QUERY_REFERENCE_AMOUNT = BigInt(1e17);
const EXPLORATION_RATE = 0.1;
const MIN_BUYING_AMOUNT = QUERY_REFERENCE_AMOUNT;
const PROFIT_THRESHOLD = 100000000000n; // profit threshold, should be denominated in the colalteral curreny
const RESYNC_INTERVAL = 1000 * 60 * 60; // Resync every 60 minutes
const DEFAULT_PRICE_REF_ADDRESS =
  "0x86533d1aDA8Ffbe7b6F7244F9A1b707f7f3e239b".toLowerCase() as Address; // METRI TEST SUPERGROUP
const TRADING_TOKEN =
  "0x6c76971f98945ae98dd7d4dfca8711ebea946ea6".toLowerCase() as Address; // wstETH
const TRADING_TOKEN_DECIMALS = 18;
const QUOTE_TOKEN =
  "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d".toLowerCase() as Address; // xDAI
const QUOTE_TOKEN_DEMICALS = 18;
const NODE_LIMIT = undefined;

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

  private calculateNorm(scores: bigint[]): bigint {
    // Add small constant to each score and compute sum of squares
    const EPSILON = 1000000n; // Small constant to avoid zero vector
    return scores.reduce((sum, score) => {
      const adjustedScore = score + EPSILON;
      return sum + adjustedScore * adjustedScore;
    }, 0n);
  }

  private sampleFromDistribution(probabilities: number[]): number {
    const r = Math.random();
    let sum = 0;
    for (let i = 0; i < probabilities.length; i++) {
      sum += probabilities[i];
      if (r <= sum) return i;
    }
    return probabilities.length - 1; // Fallback
  }

  private selectNextEdge(): string {
    const edges = this.graph.edges();
    const scores = edges.map((edge) => this.scoreEdge(edge));

    const norm = this.calculateNorm(scores);
    if (norm === 0n) {
      // Fallback to uniform sampling if all scores are 0
      return edges[Math.floor(Math.random() * edges.length)];
    }

    // Calculate probabilities proportional to squared scores
    const EPSILON = 1000000n;
    const probabilities = scores.map((score) => {
      const adjustedScore = score + EPSILON;
      return (
        Number((adjustedScore * adjustedScore * 1000000n) / norm) / 1000000
      );
    });

    const selectedIndex = this.sampleFromDistribution(probabilities);
    return edges[selectedIndex];
  }

  // private selectNextEdge(): string {
  //   if (Math.random() < this.explorationRate) {
  //     // @todo: improve this
  //     // randomly select an edge uniformly
  //     const edges = this.graph.edges();
  //     const randomIndex = Math.floor(Math.random() * edges.length);
  //     return edges[randomIndex];
  //   } else {
  //     // Select highest scoring edge
  //     return this.graph.reduceEdges(
  //       (best, current) =>
  //         this.scoreEdge(current) >= this.scoreEdge(best) ? current : best,
  //       "",
  //     );
  //   }
  // }

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

  async executeTrade(trade: Trade): Promise<boolean> {
    const options: SwapExecutionOptions = {
      slippage: 0.1,
      maxRetries: 5,
      retryDelay: 2000,
    };

    try {
      // Execute main trade
      const result = await this.dataInterface.executeCompleteTrade({
        buyNode: trade.buyNode,
        sellNode: trade.sellNode,
        buyQuote: trade.buyQuote,
        initialAmount: trade.amount,
        options,
      });

      // Always attempt cleanup regardless of main trade result
      try {
        // await Promise.all([
        //   this.dataInterface.cleanupToken(trade.buyNode.erc20tokenAddress, {
        //     ...options,
        //     slippage: 1.0, // Higher slippage for cleanup
        //   }),
        //   this.dataInterface.cleanupToken(trade.sellNode.erc20tokenAddress, {
        //     ...options,
        //     slippage: 1.0,
        //   }),
        // ]);
        console.log("Skipping cleanup");
      } catch (cleanupError) {
        console.error("Cleanup failed:", cleanupError);
      }

      return result.success;
    } catch (error) {
      console.error("Trade execution failed:", error);
      return false;
    }
  }

  private async resyncGraph() {
    // @dev: for now we just reinitialise the Graph but down the line
    // should find ways to not throw away all the cached info
    this.graph = new DirectedGraph();
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
  try {
    const bot = new ArbitrageBot(EXPLORATION_RATE);
    await bot.init();
    await bot.run();
  } catch (error) {
    console.error("Critical error in bot execution:", error);
    process.exit(1); // This will trigger PM2 restart
  }
}

main();
