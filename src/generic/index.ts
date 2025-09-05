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

import {
  DEFAULT_PRICE_REF_ADDRESS,
  EXPLORATION_RATE,
  LOG_ACTIVITY,
  MIN_BUYING_AMOUNT,
  NODE_LIMIT,
  PROFIT_THRESHOLD,
  QUERY_REFERENCE_AMOUNT,
  QUOTE_TOKEN,
  QUOTE_TOKEN_DEMICALS,
  RESYNC_INTERVAL,
  TRADING_TOKEN,
  TRADING_TOKEN_DECIMALS,
} from "./helpers/constants.js";

class ArbitrageBot {
  private graph: DirectedGraph;
  private explorationRate: number;
  private dataInterface: DataInterface;
  // Failed edge props
  private failedEdges: Map<string, number> = new Map(); // edgeKey -> timestamp when it failed
  private readonly COOLDOWN_PERIOD = 5 * 60 * 1000; // 5 minutes in milliseconds
  private readonly MAX_CONSECUTIVE_FAILURES = 3; // Max failures before longer cooldown
  private edgeFailureCount: Map<string, number> = new Map(); // Track consecutive failures


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

    // 8. Fetch latest liquidity estimates from database
    console.log("Fetching historical liquidity estimates...");
    const latestLiquidityEstimates =
      await this.dataInterface.fetchLatestLiquidityEstimates();

    // 9. Create complete graph with initial liquidity from historical data or zero
    console.log(`Creating edges between ${nodes.length} nodes...`);
    let edgeCount = 0;
    for (const sourceNode of nodes) {
      for (const targetNode of nodes) {
        if (sourceNode === targetNode) continue;

        const historicalKey = `${sourceNode.avatar}-${targetNode.avatar}`;
        const historicalData = latestLiquidityEstimates.get(historicalKey);

        this.graph.addEdge(sourceNode.avatar, targetNode.avatar, {
          liquidity: historicalData ? historicalData.liquidity : BigInt(0),
          lastUpdated: historicalData ? historicalData.timestamp : Date.now(),
        });
        edgeCount++;
        if (edgeCount % 1000 === 0) {
          console.log(`Created ${edgeCount} edges so far...`);
        }
      }
    }

    // 10. Calculate and update liquidity only for edges without historical data
    console.log("Calculating missing edge liquidity...");
    for (const sourceNode of nodes) {
      for (const targetNode of nodes) {
        if (sourceNode === targetNode) continue;

        const historicalKey = `${sourceNode.avatar}-${targetNode.avatar}`;
        if (!latestLiquidityEstimates.has(historicalKey)) {
          // Calculate new liquidity estimate only if no historical data exists
          let relevantBalances: BalanceRow[] = [];
          if (targetNode.isGroup) {
            const groupMembers = groupMemberRelations.filter(
              (rel) => rel.truster === targetNode.avatar,
            );
            groupMembers.forEach((member) => {
              const memberBalances =
                balancesByAccount.get(member.trustee) || [];
              relevantBalances.push(...memberBalances);
            });
          } else {
            relevantBalances = balancesByAccount.get(targetNode.avatar) || [];
          }

          let relevantTrustRelations: TrustRelationRow[] = [];
          if (sourceNode.isGroup) {
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
    // Add small constant to each score and compute sum
    const EPSILON = 1000000n; // Small constant to avoid zero vector
    return scores.reduce((sum, score) => {
      const adjustedScore = score + EPSILON;
      return sum + adjustedScore;
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
    const currentTime = Date.now();
    const edges = this.graph.edges();
    
    // Filter out edges that are in cooldown period
    const availableEdges = edges.filter(edge => {
      const failureTime = this.failedEdges.get(edge);
      if (!failureTime) return true; // Never failed, available
      
      const failureCount = this.edgeFailureCount.get(edge) || 0;
      const cooldownMultiplier = Math.min(failureCount, 5); // Cap at 5x cooldown
      const effectiveCooldown = this.COOLDOWN_PERIOD * cooldownMultiplier;
      
      return (currentTime - failureTime) > effectiveCooldown;
    });

    // If no edges are available (all in cooldown), use all edges as fallback
    const edgesToConsider = availableEdges.length > 0 ? availableEdges : edges;
    
    console.log(`Available edges: ${availableEdges.length}/${edges.length}`);
    
    // Calculate scores only for available edges
    const scores = edgesToConsider.map((edge) => this.scoreEdge(edge));

    const norm = this.calculateNorm(scores);
    if (norm === 0n) {
      // Fallback to uniform sampling if all scores are 0
      return edgesToConsider[Math.floor(Math.random() * edgesToConsider.length)];
    }

    // Calculate probabilities proportional to scores
    const EPSILON = 1000000n;
    const probabilities = scores.map((score) => {
      const adjustedScore = score + EPSILON;
      return (
        Number((adjustedScore * 1000000n) / norm) / 1000000
      );
    });

    const selectedIndex = this.sampleFromDistribution(probabilities);
    return edgesToConsider[selectedIndex];
  }


  // Method to mark an edge as failed
  private markEdgeAsFailed(edgeKey: string): void {
    const currentTime = Date.now();
    this.failedEdges.set(edgeKey, currentTime);
    
    // Increment failure count
    const currentFailures = this.edgeFailureCount.get(edgeKey) || 0;
    this.edgeFailureCount.set(edgeKey, currentFailures + 1);
    
    const cooldownMinutes = Math.min(currentFailures + 1, 5) * 5; // 5, 10, 15, 20, 25 minutes max
    console.log(`Edge ${edgeKey} marked as failed. Cooldown: ${cooldownMinutes} minutes`);
  }

  // Method to mark an edge as successful (reset failure count)
  private markEdgeAsSuccessful(edgeKey: string): void {
    this.failedEdges.delete(edgeKey);
    this.edgeFailureCount.delete(edgeKey);
    console.log(`Edge ${edgeKey} marked as successful`);
  }

  // Method to clean up old failures (call periodically)
  private cleanupOldFailures(): void {
    const currentTime = Date.now();
    const maxCooldown = this.COOLDOWN_PERIOD * 5; // Maximum possible cooldown
    
    for (const [edgeKey, failureTime] of this.failedEdges.entries()) {
      if (currentTime - failureTime > maxCooldown) {
        this.failedEdges.delete(edgeKey);
        this.edgeFailureCount.delete(edgeKey);
      }
    }
  }

  // Add a method to get cooldown statistics (useful for monitoring)
  public getCooldownStats(): { totalFailed: number, currentlyCooling: number } {
    const currentTime = Date.now();
    let currentlyCooling = 0;
    
    for (const [edgeKey, failureTime] of this.failedEdges.entries()) {
      const failureCount = this.edgeFailureCount.get(edgeKey) || 0;
      const cooldownMultiplier = Math.min(failureCount, 5);
      const effectiveCooldown = this.COOLDOWN_PERIOD * cooldownMultiplier;
      
      if ((currentTime - failureTime) <= effectiveCooldown) {
        currentlyCooling++;
      }
    }
    
    return {
      totalFailed: this.failedEdges.size,
      currentlyCooling: currentlyCooling
    };
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

  // Modified executeArbitrageRound method
  private async executeArbitrageRound(): Promise<void> {
    console.log("\nStarting new arbitrage round...");
    
    // Clean up old failures periodically
    if (Math.random() < 0.1) { // 10% chance each round
      //this.cleanupOldFailures();
    }
    
    const edgeKey = this.selectNextEdge();

    console.log("Winning edge score:", this.scoreEdge(edgeKey));
    console.log("Updating values for selected edge: ", edgeKey);
    
    try {
      const updatedEdgeInfo = await this.updateValues(edgeKey);

      console.log("Calculating optimal trade...");
      const optimalTrade = await this.oracleCalculateOptimalTrade(
        updatedEdgeInfo.source,
        updatedEdgeInfo.target,
        updatedEdgeInfo.edge.liquidity,
      );

      console.log("liquidity info and optimal trade: ", updatedEdgeInfo.edge.liquidity, optimalTrade);

      const profit = BigInt(optimalTrade[2]);
      if (optimalTrade[1]) {
        console.log(`Found trade with profit: ${profit.toString()}`);

        if (profit > BigInt(1e14)) {
          console.log("Trade exceeds profit threshold, executing...");
          
          // Try to execute the trade
          const executionSuccess = await this.executeArbitrage(
            updatedEdgeInfo.source, 
            updatedEdgeInfo.target, 
            optimalTrade[3],
            optimalTrade[0]
          );
          
          if (executionSuccess) {
            console.log("Trade executed successfully");
            this.markEdgeAsSuccessful(edgeKey);
          } else {
            console.log("Trade execution failed");
            this.markEdgeAsFailed(edgeKey);
          }
        } else {
          console.log("Trade below profit threshold, skipping execution");
          // Don't mark as failed if it's just unprofitable
        }
      } else {
        console.log("No viable trade found");
        this.markEdgeAsFailed(edgeKey);
      }
    } catch (error) {
      console.error("Error in arbitrage round:", error);
      this.markEdgeAsFailed(edgeKey);
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
    // @todo possibly it makes more sense just to check the price onchain
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
    const spotPrice = await this.dataInterface.getOracleSpotPrice(
      node.erc20tokenAddress,
      node.pools?.[0] || ""
    )

    return BigInt(spotPrice);
    /*
    const swapData = await this.dataInterface.getSpotPrice(
      node.erc20tokenAddress,
    );    
    if (!swapData) {
      return null;
    }
    return swapData.inputAmount.amount;
    */
  }

  private async getCurrentLiquidity(
    source: CirclesNode,
    target: CirclesNode,
  ): Promise<bigint | null> {
    return this.dataInterface.getSimulatedLiquidity(source, target);
  }

  private async oracleCalculateOptimalTrade(
    source: CirclesNode,
    target: CirclesNode,
    liquidity: bigint
  ): Promise<[bigint, boolean, bigint, bigint]> { // Returns [requiredCRCAmount, isProfitable, profitInWstETH, wstETHNeeded]
    console.log("liquidity: ", liquidity);
    console.log("source and target initial price: ", source?.price, target?.price);
    if (
      liquidity < BigInt(1e18) || !source.pools?.[0] || !target.pools?.[0] ||
      (source?.price > target?.price)
    ) {
      return [BigInt(0), false, BigInt(0), BigInt(0)];
    }

    let currentAmount = BigInt(1e18); // Start with 1 CRC (1e18 wei)
    let lastProfitableAmount = BigInt(0);
    let lastProfitableResult: [boolean, bigint, bigint] = [false, BigInt(0), BigInt(0)];

    // Keep doubling until we exceed liquidity or find unprofitable trade
    // @todo limit extra huge transfers `currentAmount < BigInt(1e20)`
    while (currentAmount <= liquidity && currentAmount < BigInt(1e20)) {
      console.log(`Testing amount: ${currentAmount.toString()}`);
      
      try {
        const executionData = await this.dataInterface.getTradeCalculation(
          source.erc20tokenAddress,
          source.pools[0],
          target.erc20tokenAddress,
          target.pools[0],
          currentAmount
        );

        const [isProfitable, profitInWstETH, wstETHNeeded] = executionData;
        
        if (isProfitable) {
          // Store the last profitable result
          lastProfitableAmount = currentAmount;
          lastProfitableResult = [isProfitable, profitInWstETH, wstETHNeeded];
          
          // Double the amount for next iteration
          currentAmount = currentAmount * BigInt(2);
        } else {
          // Trade became unprofitable, break the loop
          console.log(`Trade became unprofitable at amount: ${currentAmount.toString()}`);
          break;
        }
      } catch (error) {
        // @dev its part of regular flow
        console.log(`Error calculating trade for amount ${currentAmount.toString()}`);
        break;
      }
    }
    
    if (currentAmount > liquidity && lastProfitableAmount > BigInt(0)) {
      console.log(`Exceeded liquidity. Last profitable amount: ${lastProfitableAmount.toString()}`);
    }
    
    // Return the optimal (last profitable) result
    return [
      lastProfitableAmount,
      lastProfitableResult[0],
      lastProfitableResult[1],
      lastProfitableResult[2]
    ];
  }

  async executeArbitrage(
    source: CirclesNode,
    target: CirclesNode,
    wstToSpend: bigint,
    crcAmount: bigint = BigInt(1e18)
  ) {
    try {
      const result = await this.dataInterface.executeWithV2(
        source,
        target,
        wstToSpend,
        crcAmount
      );

      return result !== undefined && result !== null;
    } catch (error) {
      console.error("Trade execution failed:", error);
      return false;
    }
  }


  // this is inefficient in the sense that it throws away the whole learned graph and then just reloads
  // the majority of it from the db, however it's a simple way to include new backers and new groups.
  private async resyncGraph() {
    console.log("Resyncing graph...");
    this.graph = new DirectedGraph();
    await this.initializeGraph();
    console.log("Graph resync complete");
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
