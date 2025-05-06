1. INITIALIZATION
   ├─ Initialize data interface and graph structure
   ├─ Connect to required APIs (Balancer, Circles)
   └─ Set up configuration parameters

2. GRAPH CONSTRUCTION
   ├─ Load initial nodes from database
   ├─ Fetch group members and trust relationships
   ├─ Calculate initial price estimates
   └─ Build complete graph with liquidity edges

3. DEAL FINDING & EXECUTION
   ├─ SELECT EDGE
   │    ├─ Random exploration (with probability EXPLORATION_RATE)
   │    └─ Best score selection based on:
   │         score = (targetPrice - sourcePrice) × edgeLiquidity
   │
   ├─ UPDATE VALUES
   │    ├─ Refresh spot prices for source and target nodes
   │    └─ Update edge liquidity through trust relationships
   │
   ├─ CALCULATE OPTIMAL TRADE
   │    ├─ Start with minimum extractable amount
   │    ├─ Double amount iteratively while profitable
   │    └─ Select best profit/amount combination
   │
   └─ EXECUTE TRADE
        ├─ Verify profit > threshold
        ├─ Build Balancer swap parameters
        └─ Execute transaction
```

## Group-Specific Arbitrage Bot

The group-focused implementation targets arbitrage between group tokens and member tokens:

```text
1. INITIALIZATION
   ├─ Load environment variables and contracts
   ├─ Initialize Circles SDK and APIs
   └─ Set up database connections

2. DEAL FINDING & EXECUTION
   ├─ FOR EACH GROUP MEMBER:
   │    ├─ Update token prices via Balancer quotes
   │    │
   │    ├─ EVALUATE BOTH DIRECTIONS:
   │    │    ├─ Group token → Member token
   │    │    └─ Member token → Group token
   │    │
   │    ├─ OPTIMIZE TRADE SIZE:
   │    │    ├─ Start with MIN_EXTRACTABLE_AMOUNT
   │    │    ├─ Double amount while:
   │    │    │    ├─ Price remains favorable
   │    │    │    ├─ Required tokens are available
   │    │    │    └─ Profit increases
   │    │    └─ Select most profitable amount
   │    │
   │    └─ CHECK PROFITABILITY:
   │         outputAmount - inputAmount > EPSILON
   │
   ├─ ENSURE LIQUIDITY
   │    ├─ Check current token balances (ERC20 + ERC1155)
   │    ├─ Calculate required additional tokens
   │    ├─ Pull tokens through pathfinder if needed
   │    └─ Convert tokens (wrap/unwrap)
   │
   └─ EXECUTE TRADE
        ├─ Set token approvals if needed
        ├─ Build Balancer swap parameters
        └─ Execute transaction
```
