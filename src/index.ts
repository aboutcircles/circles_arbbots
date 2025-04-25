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
const PRICE_REFERENCE_ADDRESS = "0x86533d1aDA8Ffbe7b6F7244F9A1b707f7f3e239b"; // METRI TEST SUPERGROUP

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
    // Get accounts with presumable liquidity (right now backers and basegroups with existing erc20 tokens)
    let nodes = await this.dataInterface.loadNodes();

    nodes = await this.estimatePrices(nodes);

    // Add all nodes first
    for (let node of nodes) {
      this.graph.addNode(node.avatar, node);
    }
    // Add the extended information for groups
    // For every group in the liquid accounts
    for (const targetNode of nodes) {
      let balances;
      if (targetNode.isGroup) {
        // Get the group members
        const groupMembers = await this.dataInterface.getTrustRelations({
          trusters: [targetNode.avatar],
        });

        // Get the accounts that hold member tokens (since these could be turned into group tokens).
        balances = await this.dataInterface.getBalances(
          groupMembers.map((member) => member.trustee),
        );
      } else {
        // get the accounts that hold the target token
        balances = await this.dataInterface.getBalances([targetNode.avatar]);
      }

      for (const sourceNode of nodes) {
        if (sourceNode == targetNode) continue;

        let trustRelations;
        if (sourceNode.isGroup) {
          // Get the group members
          const groupMembers = await this.dataInterface.getTrustRelations({
            trusters: [sourceNode.avatar],
          });

          // TODO: This is systematically overestimating the redeemable amounts, since it assumes any amounts of
          // user collateral can be redeemed. To avoid this, might think about capping liquidity from groups by the total supply.
          // get the users that accept tokens created by group members (since )
          trustRelations = await this.dataInterface.getTrustRelations({
            trustees: groupMembers.map((member) => member.trustee),
          });
        } else {
          // get the users that accept the sourceToken
          trustRelations = await this.dataInterface.getTrustRelations({
            trustees: [sourceNode.avatar],
          });
        }

        // we now iterate over the trustRelations
        // and the balances and add edges accordingly
        for (const balance of balances) {
          for (const trustRelation of trustRelations) {
            // the balances are by construction of the targetToken (or memberTokens)
            // while the trustRelations are by construction with sourceTOkens (or memberTokens) as trustees
            // liqiduity between tokens is created from users holding the target token and trusting the source token
            if (balance.account == trustRelation.truster) {
              const sourceKey = sourceNode.avatar;
              const targetKey = targetNode.avatar;
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
      }
    }
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

  private async estimatePrices(nodes: CirclesNode[]): Promise<CirclesNode[]> {
    // create a reference price for nodes whose price haven't been logged
    const referenceToken = await this.dataInterface.getERC20Token(
      PRICE_REFERENCE_ADDRESS,
    );
    const referencePrice = (await this.dataInterface.fetchBalancerQuote({
      tokenAddress: referenceToken!,
    }))!.inputAmount.amount;

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
