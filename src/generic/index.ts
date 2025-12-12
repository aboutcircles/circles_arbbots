import { DirectedGraph } from "graphology";
import { CirclesConverter } from "@aboutcircles/sdk-utils";
import { DataInterface } from "./dataInterface.js";
import {
  CirclesNode,
  CirclesEdge,
  EdgeInfo,
  Address,
  BalanceRow,
  TrustRelationRow,
} from "./interfaces/index.js";

import { sDAI } from "./helpers/poolConfig.js";
import {
  LOG_ACTIVITY,
  NODE_LIMIT,
  PROFIT_THRESHOLD,
  MAX_ARBITRAGE_CRC_AMOUNT,
  QUERY_REFERENCE_AMOUNT,
  RESYNC_INTERVAL,
} from "./helpers/constants.js";
import { appendFileSync } from "fs";

class ArbitrageBot {
  private graph: DirectedGraph;
  private dataInterface: DataInterface;
  private nodes: CirclesNode[] = []; // Store nodes for periodic price logging
  // Failed edge props
  private failedEdges: Map<string, number> = new Map(); // edgeKey -> timestamp when it failed
  private readonly COOLDOWN_PERIOD = 30 * 60 * 1000; // 5 minutes in milliseconds
  private edgeFailureCount: Map<string, number> = new Map(); // Track consecutive failures


  constructor() {
    this.graph = new DirectedGraph();
    this.dataInterface = new DataInterface({
      quoteReferenceAmount: QUERY_REFERENCE_AMOUNT,
      logActivity: LOG_ACTIVITY
    });
  }

  // Add an init method to ArbitrageBot
  public async init(): Promise<void> {
    await this.dataInterface.init();
  }

  private writeToDebugLog(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    try {
      appendFileSync('debug.log', logEntry);
    } catch (error) {
      console.error('Failed to write to debug.log:', error);
    }
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

    // 8. Fetch latest liquidity estimates from database (only if logging is enabled)
    console.log("Fetching historical liquidity estimates...");
    const latestLiquidityEstimates =
      await this.dataInterface.fetchLatestLiquidityEstimates();

    const hasObservations = latestLiquidityEstimates.size > 0;
    if (hasObservations) {
      console.log(`Found ${latestLiquidityEstimates.size} historical liquidity observations`);
    } else {
      console.log("No historical liquidity observations found - skipping missing edge liquidity calculation");
    }

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

    // 10. Calculate and update liquidity only for edges without historical data (skip if no observations exist)
    if (hasObservations) {
      console.log("Calculating missing edge liquidity...");

      // Calculate how many edges need calculation
      const totalPossibleEdges = nodes.length * (nodes.length - 1);
      const edgesWithHistory = latestLiquidityEstimates.size;
      const edgesToCalculate = totalPossibleEdges - edgesWithHistory;

      console.log(`Total possible edges: ${totalPossibleEdges}`);
      console.log(`Edges with historical data: ${edgesWithHistory}`);
      console.log(`Edges to calculate: ${edgesToCalculate}`);

      // Skip if too many edges to calculate (performance optimization)
      const MAX_EDGES_TO_CALCULATE = 10000;
      if (edgesToCalculate > MAX_EDGES_TO_CALCULATE) {
        console.log(`⚠️  Skipping liquidity calculation - too many edges (${edgesToCalculate} > ${MAX_EDGES_TO_CALCULATE})`);
        console.log("   Edges will start with 0 liquidity and be updated during runtime");
      } else {
        let calculatedCount = 0;
        let progressInterval = Math.max(1, Math.floor(edgesToCalculate / 10));

        for (let i = 0; i < nodes.length; i++) {
          const sourceNode = nodes[i];

          for (let j = 0; j < nodes.length; j++) {
            const targetNode = nodes[j];
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

              calculatedCount++;
              if (calculatedCount % progressInterval === 0) {
                const progress = ((calculatedCount / edgesToCalculate) * 100).toFixed(1);
                console.log(`  Progress: ${calculatedCount}/${edgesToCalculate} edges (${progress}%)`);
              }
            }
          }
        }
        console.log(`  Completed: ${calculatedCount} edges calculated`);
      }
    } else {
      console.log("Skipping liquidity calculation - no historical observations available");
    }

    console.log("Graph initialization complete");
    console.timeEnd("Graph initialization");

    // Store nodes for periodic price logging
    this.nodes = nodes;

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
    if (delta <= 0) {
      return 0n;
    }

    // Apply liquidity-based multiplier to the score
    const LIQUIDITY_THRESHOLD = BigInt(1e18); // 1 CRC
    let liquidityMultiplier: bigint;

    if (liquidity < LIQUIDITY_THRESHOLD) {
      // Low liquidity: multiply by 0.1 (divide by 10)
      liquidityMultiplier = 1n; // Will divide by 10 later
      return (delta * liquidityMultiplier) / 10n;
    } else {
      // High liquidity: multiply by 2
      liquidityMultiplier = 2n;
      return delta * liquidityMultiplier;
    }
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
      const cooldownMultiplier = Math.min(failureCount, 100); // Cap at 5x cooldown
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
    const maxCooldown = this.COOLDOWN_PERIOD * 100; // Maximum possible cooldown
    
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

  private async executeArbitrageRound(): Promise<void> {
    console.log("\nStarting new arbitrage round...");
    
    if (Math.random() < 0.1) { // 10% chance each round
      //this.cleanupOldFailures();
    }
    
    const edgeKey = this.selectNextEdge();
    console.log("Winning edge score:", this.scoreEdge(edgeKey));
    console.log("Updating values for selected edge: ", edgeKey);
     
    try {
      const updatedEdgeInfo = await this.updateValues(edgeKey);
      // Simple price check - source should be higher than target for profitable arbitrage
      if (!updatedEdgeInfo.source.price || !updatedEdgeInfo.target.price) {
        // Missing price data for nodes
        this.markEdgeAsFailed(edgeKey);
        return;
      }
      //@todo inspect why such trades are not executed
      if (updatedEdgeInfo.source.price * 12n / 10n > updatedEdgeInfo.target.price) {
        console.log(`Price check failed: source ${updatedEdgeInfo.source.price}, target ${updatedEdgeInfo.target.price}`);
        this.markEdgeAsFailed(edgeKey);
        return;
      }

      console.log("Price check passed, proceeding to execution...");

      // Execute arbitrage with dynamic optimization
      const executionSuccess = await this.executeArbitrage(
        updatedEdgeInfo.source,
        updatedEdgeInfo.target,
        edgeKey
      );

      if (executionSuccess) {
        console.log("Trade executed successfully");
        this.markEdgeAsSuccessful(edgeKey);
      } else {
        console.log("Trade execution failed");
        this.markEdgeAsFailed(edgeKey);
      }
    // @todo Make liquidity logging already handled in executeArbitrage

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
    // @todo skip this step
    /*
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
    });*/

    return this.getEdgeInfo(edgeKey);
  }

  private async estimatePrices(nodes: CirclesNode[]): Promise<CirclesNode[]> {
    console.log(`Fetching oracle prices for ${nodes.length} nodes...`);

    // Get the next snapshot ID
    const snapshotId = await this.dataInterface.getNextSnapshotId();
    console.log(`Creating price snapshot with ID: ${snapshotId}`);

    let referencePrice: bigint = BigInt(1e16); // Default to 0.01 cents

    const swapAmount = BigInt(1e18); // 1 token with 18 decimals

    // Fetch oracle prices for all nodes
    for (const node of nodes) {
      if (!node.pools || node.pools.length === 0) {
        // No pool information - use random variation around reference price
        const randomMultiplier = 1000n + BigInt(Math.floor(Math.random() * 100));
        const randomDivisor = 1000n + BigInt(Math.floor(Math.random() * 100));
        node.price = (referencePrice * randomMultiplier) / randomDivisor;
        node.lastUpdated = Date.now();
        continue;
      }

      try {
        // Fetch oracle price for this node (use first pool)
        const firstPool = node.pools[0];
        node.price = await this.dataInterface.getOracleSpotPrice(
          node.erc20tokenAddress,
          firstPool
        );
        node.lastUpdated = Date.now();

        // Insert price snapshot to database
        const poolType = firstPool.isV3 ? "balancer_v3" : "balancer_v2";
        await this.dataInterface.insertPriceSnapshot(
          snapshotId,
          node.erc20tokenAddress,
          firstPool.poolId,
          poolType,
          node.price,
          sDAI,
          swapAmount
        );

      } catch (error) {
        console.error(`Error fetching oracle price for ${node.erc20tokenAddress}:`, error);
        // Fallback to random variation around reference price
        const randomMultiplier = 1000n + BigInt(Math.floor(Math.random() * 100));
        const randomDivisor = 1000n + BigInt(Math.floor(Math.random() * 100));
        node.price = (referencePrice * randomMultiplier) / randomDivisor;
        node.lastUpdated = Date.now();
      }
    }

    console.log(`Price estimation complete for ${nodes.length} nodes (snapshot ID: ${snapshotId})`);
    return nodes;
  }

  private async getCurrentSpotPrice(node: CirclesNode): Promise<bigint | null> {
    if(!node.pools?.[0]) 
      return 0n;

    const spotPrice = await this.dataInterface.getOracleSpotPrice(
      node.erc20tokenAddress,
      node.pools?.[0]
    )

    return BigInt(spotPrice);
  }

  async executeArbitrage(
    source: CirclesNode,
    target: CirclesNode,
    edgeKey?: string
  ): Promise<boolean> {
    let actualLiquidity: bigint | null = null;
    const startTime = Date.now();

    try {
      // Step 2: Get actual liquidity after trust setup
      console.log("Getting current liquidity...");
      const liquidityResult = await this.dataInterface.getPathfinderTransferData(
        source,
        target,
        BigInt(99999999999999999999999999999999999n),
        true
      );
      actualLiquidity = typeof liquidityResult === 'bigint' ? liquidityResult : null;
      const executionTime = Date.now() - startTime;

      // Calculate edge score (price ratio)
      const edgeScore = source.price && target.price
        ? (source.price * BigInt(1e18)) / target.price
        : undefined;

      // Log liquidity observation
      // @todo this should be moved to after the arbitrage execution
      await this.dataInterface.logLiquidityObservation({
        source_avatar: source.avatar,
        target_avatar: target.avatar,
        measured_liquidity: actualLiquidity || 0n,
        required_amount: QUERY_REFERENCE_AMOUNT,
        edge_id: edgeKey,
        edge_score: edgeScore,
        success: !!(actualLiquidity && actualLiquidity >= QUERY_REFERENCE_AMOUNT),
        source_token_price: source.price,
        target_token_price: target.price,
        ref_token: sDAI // Prices are quoted in sDAI
      });

      // @todo implement the update of the liquidity edge
      /*this.graph.updateEdgeAttributes(edgeKey, (attr) => {
        return {
          ...attr,
          liquidity: currentEdgeLiquidity,
          lastUpdated: Date.now(),
        };
      });*/
      // @todo QUERY_REFERENCE_AMOUNT is not demurrage
      if (!actualLiquidity || actualLiquidity < QUERY_REFERENCE_AMOUNT) {
        console.log(`Insufficient liquidity: ${actualLiquidity?.toString() || '0'}`);
        return false;
      }

      console.log(`Available liquidity: ${actualLiquidity.toString()}`);
      // Step 3: Find optimal trade amount with doubledown binary search approach
      let currentAmount = CirclesConverter.attoCirclesToAttoStaticCircles(BigInt(actualLiquidity));
      let bestAmount = BigInt(0);
      let bestWstETHNeeded = BigInt(0);

      // Validate that both nodes have pools
      if (!source.pools || source.pools.length === 0 || !target.pools || target.pools.length === 0) {
        console.log("Missing pool information for source or target");
        return false;
      }

      // Start with doubling until we hit liquidity limit or find unprofitable trade
      while (currentAmount > QUERY_REFERENCE_AMOUNT) {
        console.log(`Testing amount: ${currentAmount.toString()}`);

        const [isProfitable, profitInWstETH, wstETHNeeded] = await this.dataInterface.getTradeCalculation(
          source.erc20tokenAddress,
          source.pools[0],
          target.erc20tokenAddress,
          target.pools[0],
          currentAmount
        );

        if (isProfitable && profitInWstETH > PROFIT_THRESHOLD) { // Minimum profit threshold
          bestAmount = currentAmount;
          bestWstETHNeeded = wstETHNeeded;
          console.log(`Profitable trade found: amount=${currentAmount.toString()}, profit=${profitInWstETH.toString()}, wstETH needed=${wstETHNeeded.toString()}`);

          break;
        } else {
          currentAmount = currentAmount / BigInt(2);
        }
      }

      // Step 4: Execute the best trade found
      if (bestAmount > BigInt(0) && bestWstETHNeeded > BigInt(0)) {
        console.log(`Executing optimal trade: amount=${bestAmount.toString()}, wstETH=${bestWstETHNeeded.toString()}`);

        const result = await this.dataInterface.executeArbitrageV2(
          source,
          target,
          bestWstETHNeeded,
          bestAmount
        );
        

        if (result === undefined || result === null) {
          // Transaction execution failed
          return false;
        }

        return true;
      } else {
        console.log("No profitable trade found after optimization");
        return false;
      }

    } catch (error) {
      // @todo fix ts issue
      // @ts-ignore
      const failureMessage = error?.metaMessages || error?.shortMessage || "";
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${failureMessage}`;
      this.writeToDebugLog(logEntry);

      return false;
    }
  }


  // this is inefficient in the sense that it throws away the whole learned graph and then just reloads
  // the majority of it from the db, however it's a simple way to include new backers and new groups.
  private async resyncGraph(): Promise<void> {
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

async function main(): Promise<void> {
  try {
    const bot = new ArbitrageBot();
    await bot.init();
    await bot.run();
  } catch (error) {
    console.error("Critical error in bot execution:", error);
    process.exit(1); // This will trigger PM2 restart
  }
}

main();
