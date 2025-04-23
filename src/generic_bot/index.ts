import { DirectedGraph } from "graphology";
import { DataInterface } from "./dataInterface.js";
import {
  CirclesNode,
  CirclesEdge,
  Trade,
  EdgeInfo,
  Direction,
} from "./interfaces/index.js";

// global variables
const LOG_ACTIVITY = false;
const QUERY_REFERENCE_AMOUNT = BigInt(1e17);
const EXPLORATION_RATE = 0.1;
const MIN_BUYING_AMOUNT = QUERY_REFERENCE_AMOUNT;
const PROFIT_THRESHOLD = QUERY_REFERENCE_AMOUNT;
const GROUPS_CAP_LIQUIDITY = BigInt(500 * 1e18);
const RESYNC_INTERVAL = 1000 * 60 * 15; // Resync every 15 minutes

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
    );
  }

  private async initializeGraph(): Promise<void> {
    // Get accounts with liquidity
    const liquidAccounts = await this.dataInterface.getCRCWithLiquidity();

    // Add all nodes first
    for (const account of liquidAccounts) {
      this.graph.addNode(account.avatar, account);
    }

    // Get all erc1155 token addresses
    const avatars = liquidAccounts.map((account) => account.avatar);

    // Get all balances for these tokens
    const balances = await this.dataInterface.getBalances(avatars);

    // get all the relevant trustRelations
    const trustRelations = await this.dataInterface.getTrustRelations(avatars);

    // for groups, also need to balances by people of membertokens. WE should probably iterate over the vertices...

    for (const balance of balances) {
      for (const trustRelation of trustRelations) {
        // liqiduity between tokens is created from users holding the target token and trusting the source token
        if (balance.account == trustRelation.truster) {
          const sourceKey = trustRelation.trustee;
          const targetKey = balance.tokenAddress;

          // add edge if necessary
          let edge = this.graph.edge(sourceKey, targetKey);
          if (!edge) {
            edge = this.graph.addEdge(sourceKey, targetKey, {
              liquidity: BigInt(0),
              lastUpdated: Date.now(),
            });
          }

          // Add the balance to the edges (we don't update the lastUpdated,
          // since initialistion is considered a single moment in time
          this.graph.updateEdgeAttribute(
            edge,
            "liquidity",
            (l) => l + balance.demurragedTotalBalance,
          );
        }
      }
    }

    console.log(
      `Graph initialized with ${this.graph.order} nodes and ${this.graph.size} edges`,
    );
  }

  private scoreEdge(edgeKey: string): bigint {
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
    } else {
      const delta = targetPrice - sourcePrice;
      return delta <= 0 ? 0n : delta * liquidity;
    }
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
    const edgeKey = this.selectNextEdge();

    // Query actual data and update them in the graph
    const updatedEdgeInfo = await this.updateValues(edgeKey);

    // calculate optimal trade
    const optimalTrade = await this.calculateOptimalTrade(
      updatedEdgeInfo.source,
      updatedEdgeInfo.target,
      updatedEdgeInfo.edge.liquidity,
    );

    // we only want to perform trades abive a certain profit treshold
    if (optimalTrade && optimalTrade.profit > PROFIT_THRESHOLD) {
      await this.executeTrade(optimalTrade);
    }
  }

  private async updateValues(edgeKey: string): Promise<EdgeInfo> {
    const edgeInfo = this.getEdgeInfo(edgeKey);

    const currentSourcePrice = await this.getCurrentPrice(edgeInfo.source);
    const currentTargetPrice = await this.getCurrentPrice(edgeInfo.target);
    const currentEdgeLiquidity = await this.getCurrentLiquidity(
      edgeInfo.source,
      edgeInfo.target,
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

  private async getEstimatedLiquidity(
    source: CirclesNode,
    target: CirclesNode,
  ): Promise<number> {
    return 0;
  }

  private async getCurrentPrice(node: CirclesNode): Promise<bigint | null> {
    const swapData = await this.dataInterface.fetchBalancerQuote({
      tokenAddress: node.erc20tokenAddress,
    });
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
    let currentAmount = liquidity;

    // Get initial quotes
    const initialBuyQuote = await this.dataInterface.fetchBalancerQuote({
      tokenAddress: source.erc20tokenAddress,
      direction: Direction.BUY,
      amount: currentAmount,
    });

    const initialSellQuote = await this.dataInterface.fetchBalancerQuote({
      tokenAddress: target.erc20tokenAddress,
      direction: Direction.SELL,
      amount: currentAmount,
    });

    if (!initialBuyQuote || !initialSellQuote) {
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
    while (currentAmount > 2n * MIN_BUYING_AMOUNT) {
      currentAmount /= 2n;

      // Get quotes for reduced amount
      const buyQuote = await this.dataInterface.fetchBalancerQuote({
        tokenAddress: source.erc20tokenAddress,
        direction: Direction.BUY,
        amount: currentAmount,
      });

      const sellQuote = await this.dataInterface.fetchBalancerQuote({
        tokenAddress: target.erc20tokenAddress,
        direction: Direction.SELL,
        amount: currentAmount,
      });

      if (!buyQuote || !sellQuote) {
        return bestTrade;
      }

      const currentProfit =
        sellQuote.outputAmount.amount - buyQuote.inputAmount.amount;

      // If profit decreased, return the previous (best) trade
      if (currentProfit < bestTrade.profit) {
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

// Usage
const bot = new ArbitrageBot(0.1);
bot.run().catch(console.error);
