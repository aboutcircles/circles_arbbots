import { DirectedGraph } from "graphology";
import { DataInterface } from "./dataInterface.js";
import {
  CirclesNode,
  CirclesEdge,
  Trade,
  EdgeInfo,
  Direction,
  Address,
} from "./interfaces/index.js";

// global variables
const LOG_ACTIVITY = false;
const QUERY_REFERENCE_AMOUNT = BigInt(1e17);
const EXPLORATION_RATE = 0.1;
const MIN_BUYING_AMOUNT = QUERY_REFERENCE_AMOUNT;
const PROFIT_THRESHOLD = 0n; // profit threshold, should be denominated in the colalteral curreny
// const GROUPS_CAP_LIQUIDITY = BigInt(500 * 1e18);
const RESYNC_INTERVAL = 1000 * 60 * 15; // Resync every 15 minutes
const DEFAULT_PRICE_REF_ADDRESS =
  "0x86533d1aDA8Ffbe7b6F7244F9A1b707f7f3e239b".toLowerCase() as Address; // METRI TEST SUPERGROUP
const TRADING_TOKEN =
  "0x6c76971f98945ae98dd7d4dfca8711ebea946ea6".toLowerCase() as Address; // wstETH
const TRADING_TOKEN_DECIMALS = 18;
const QUOTE_TOKEN =
  "0xe91d153e0b41518a2ce8dd3d7944fa863463a97d".toLowerCase() as Address; // wstETH
const QUOTE_TOKEN_DEMICALS = 18;
const DEBUG = true; // Toggle detailed logging
const NODE_LIMIT = 5;

class ArbitrageBot {
  private graph: DirectedGraph;
  private explorationRate: number;
  private dataInterface: DataInterface;

  constructor(explorationRate: number = EXPLORATION_RATE) {
    this.graph = new DirectedGraph();
    this.explorationRate = explorationRate;
    this.dataInterface = new DataInterface(
      QUERY_REFERENCE_AMOUNT,
      LOG_ACTIVITY,
      TRADING_TOKEN,
      TRADING_TOKEN_DECIMALS,
      QUOTE_TOKEN,
      QUOTE_TOKEN_DEMICALS,
    );
  }

  // Add an init method to ArbitrageBot
  public async init(): Promise<void> {
    await this.dataInterface.init();
  }

  private async initializeGraph(): Promise<void> {
    console.log("Starting graph initialization...");
    console.time("Graph initialization");

    // Get accounts with presumable liquidity
    console.log("Loading nodes...");
    let nodes = await this.dataInterface.loadNodes(NODE_LIMIT);
    console.log(`Loaded ${nodes.length} nodes`);

    console.log("Estimating prices...");
    nodes = await this.estimatePrices(nodes);
    console.log("Price estimation complete");

    // Add all nodes first
    console.log("Adding nodes to graph...");
    for (let node of nodes) {
      this.graph.addNode(node.avatar, node);
    }
    console.log(`Added ${nodes.length} nodes to graph`);

    // Add edges
    console.log("Starting edge creation...");
    let edgeCount = 0;

    for (const targetNode of nodes) {
      if (DEBUG)
        console.log(
          `Processing target node: ${targetNode.avatar.slice(0, 8)}...`,
        );

      let balances;
      if (targetNode.isGroup) {
        if (DEBUG)
          console.log(
            `Fetching group members for ${targetNode.avatar.slice(0, 8)}...`,
          );
        const groupMembers = await this.dataInterface.getTrustRelations({
          trusters: [targetNode.avatar],
        });
        balances = await this.dataInterface.getBalances(
          groupMembers.map((member) => member.trustee),
        );
      } else {
        balances = await this.dataInterface.getBalances([targetNode.avatar]);
      }

      for (const sourceNode of nodes) {
        if (sourceNode == targetNode) continue;

        if (DEBUG)
          console.log(
            `Processing source node: ${sourceNode.avatar.slice(0, 8)}...`,
          );

        let trustRelations;
        if (sourceNode.isGroup) {
          const groupMembers = await this.dataInterface.getTrustRelations({
            trusters: [sourceNode.avatar],
          });
          trustRelations = await this.dataInterface.getTrustRelations({
            trustees: groupMembers.map((member) => member.trustee),
          });
        } else {
          trustRelations = await this.dataInterface.getTrustRelations({
            trustees: [sourceNode.avatar],
          });
        }

        // Edge creation
        for (const balance of balances) {
          for (const trustRelation of trustRelations) {
            if (balance.account == trustRelation.truster) {
              const sourceKey = sourceNode.avatar;
              const targetKey = targetNode.avatar;

              let edge = this.graph.edge(sourceKey, targetKey);
              if (!edge) {
                edge = this.graph.addEdge(sourceKey, targetKey, {
                  liquidity: BigInt(0),
                  lastUpdated: Date.now(),
                });
                edgeCount++;

                if (edgeCount % 100 === 0) {
                  console.log(`Created ${edgeCount} edges so far...`);
                }
              }

              this.graph.updateEdgeAttribute(
                edge,
                "liquidity",
                (l) => l + balance.demurragedTotalBalance,
              );
            }
          }
        }
      }
    }

    console.log(
      `Graph initialization complete. Created ${edgeCount} edges total`,
    );
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

    let collateralBalance = await this.dataInterface.getCollateralBalance();

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
        amount: currentAmount,
        profit: currentProfit,
      };
    }

    return bestTrade;
  }

  private async executeTrade(trade: Trade): Promise<boolean> {
    // @todo: We need to consider the actual amounts that are being achieved here...
    console.log("Executing chosen trade:");
    console.log("Buy quote:", trade.buyQuote);
    console.log("Sell quote:", trade.sellQuote);
    console.log("Amount:", trade.amount.toString());
    console.log("Expected profit:", trade.profit.toString());

    return true;
  }

  //   // First we buy,
  //   await this.dataInterface.execSwap(trade.buyQuote, Direction.BUY);

  //   // then we transfer,
  //   await this.sdk.transfer();

  //   // and then we sell
  //   await this.dataInterface.execSwap(trade.sellQuote, Direction.SELL);
  // }

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
  const bot = new ArbitrageBot(0.1);
  await bot.init();
  await bot.run().catch(console.error);
}

main().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});
