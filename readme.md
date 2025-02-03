# ArbBot

```
1. INITIALIZATION
   ├─ Load environment variables (RPC_URL, ARBBOT_ADDRESS, PRIVATE_KEY, etc.)
   ├─ Set up WebSocket and ethers provider
   ├─ Initialize wallet using the private key
   ├─ Connect to the PostgreSQL database
   ├─ Initialize Circles SDK and API objects (CirclesData, CirclesRpc)
   ├─ Create Balancer API instance for on-chain swap queries
   ├─ Initialize necessary smart contract instances (e.g., hubV2, ERC20 token contracts)
   └─ Set up the bot’s internal state (addresses, group token, members cache, etc.)

2. MAIN LOOP (Runs indefinitely)
   ├─ UPDATE GROUP MEMBERS CACHE
   │    ├─ Query the PostgreSQL database for new group members (since the last update)
   │    └─ Append any new members to the local cache and update the timestamp
   │
   ├─ FOR EACH GROUP MEMBER IN CACHE:
   │    ├─ UPDATE MEMBER DATA
   │    │    ├─ If the member's token address is not set, call the contract to fetch it
   │    │    └─ Retrieve the latest token price (using Balancer API)
   │    │         └─ Update the member's last price and timestamp
   │    │
   │    ├─ EVALUATE ARBITRAGE DEAL
   │    │    ├─ Determine the swap direction (group token to member token or vice versa)
   │    │    ├─ Compare the fetched price to a reference value (e.g., 1e18 units)
   │    │    ├─ If the price difference exceeds a defined threshold (EPSILON):
   │    │    │       └─ Mark the deal as potentially profitable
   │    │    └─ Otherwise, skip to the next member
   │    │
   │    ├─ ENSURE REQUIRED TOKENS ARE AVAILABLE
   │    │    ├─ Check if the bot has enough tokens to execute the swap
   │    │    ├─ If not enough:
   │    │    │       ├─ Attempt to mint new tokens from members’ balances
   │    │    │       ├─ Convert tokens (wrap/unwrap) as needed
   │    │    │       └─ If it is still not enough, skip to the next member
   │    │    └─ Confirm that token allowances are set (approve tokens if necessary)
   │    │
   │    └─ EXECUTE SWAP (if deal is profitable and tokens are sufficient)
   │         ├─ Build the swap call using Balancer API (including slippage and deadline settings)
   │         ├─ Send the swap transaction
   │         └─ Log the transaction details (e.g., tx hash)
   │
   └─ (OPTIONAL @todo) Perform housekeeping tasks:
         ├─ Clear any residual “dust” tokens
         └─ Optionally introduce a short delay before the next iteration

3. ERROR HANDLING
   ├─ Catch and log errors during database queries, on-chain calls, or transactions
   └─ If a fatal error occurs in the main function, exit with a non-zero code (for restart by a process manager)
```
