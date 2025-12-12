// ABIs
export const erc20Abi = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "remaining", type: "uint256" }],
    type: "function",
  },
  {
    inputs: [
      { name: "_spender", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const erc20LiftAbi = [
  {
    inputs: [
      { internalType: "uint8", name: "", type: "uint8" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "erc20Circles",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

export const arbbotOracleAbi = [
    {
        "type": "constructor",
        "inputs": [
            { "name": "_v2Queries", "type": "address", "internalType": "address" },
            { "name": "_v3BatchRouter", "type": "address", "internalType": "address" },
            { "name": "owner", "type": "address", "internalType": "address" }
        ],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "BALANCER_V2_VAULT",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "BALANCER_V3_VAULT",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "GNO",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "POOL_MULTI_V3",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "POOL_SDAI_WAGNO_GNO_V3",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "POOL_WAGNO_GNO_WAGNO_WSTETH_V3",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "POOL_WAGNO_WETH_WAGNO_WSTETH_V3",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "SDAI",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WAGNO_GNO",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WAGNO_WETH",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WAGNO_WSTETH",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WBTC",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WBTC_WSTETH_POOL_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WETH",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WETH_WSTETH_POOL_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WSTETH",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WSTETH_GNO_POOL_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WSTETH_SDAI_POOL_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildBackwardSwapStepsV2",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v2PoolId", "type": "bytes32", "internalType": "bytes32" }
        ],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct BalancerOracle.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildBackwardSwapStepsV3",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v3PoolAddress", "type": "address", "internalType": "address" }
        ],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildForwardSwapStepsV2",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v2PoolId", "type": "bytes32", "internalType": "bytes32" }
        ],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct BalancerOracle.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildForwardSwapStepsV3",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v3PoolAddress", "type": "address", "internalType": "address" }
        ],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getAmountInV2",
        "inputs": [
            { "name": "tokenIn", "type": "address", "internalType": "address" },
            { "name": "amountOut", "type": "uint256", "internalType": "uint256" },
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct BalancerOracle.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "outputs": [{ "name": "amountIn", "type": "uint256", "internalType": "uint256" }],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "getAmountInV3",
        "inputs": [
            { "name": "tokenIn", "type": "address", "internalType": "contract IERC20" },
            { "name": "amountOut", "type": "uint256", "internalType": "uint256" },
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "outputs": [{ "name": "amountIn", "type": "uint256", "internalType": "uint256" }],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "getAmountOutV2",
        "inputs": [
            { "name": "tokenIn", "type": "address", "internalType": "address" },
            { "name": "amountIn", "type": "uint256", "internalType": "uint256" },
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct BalancerOracle.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "outputs": [{ "name": "amountOut", "type": "uint256", "internalType": "uint256" }],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "getAmountOutV3",
        "inputs": [
            { "name": "tokenIn", "type": "address", "internalType": "contract IERC20" },
            { "name": "amountIn", "type": "uint256", "internalType": "uint256" },
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "outputs": [{ "name": "amountOut", "type": "uint256", "internalType": "uint256" }],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "getIntermediateTokenV2",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "poolId", "type": "bytes32", "internalType": "bytes32" }
        ],
        "outputs": [{ "name": "intermediateToken", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getIntermediateTokenV3",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v3PoolAddress", "type": "address", "internalType": "address" }
        ],
        "outputs": [{ "name": "intermediateToken", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getV2StableSwapPath",
        "inputs": [{ "name": "token", "type": "address", "internalType": "address" }],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct BalancerOracle.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getV3StableSwapPath",
        "inputs": [{ "name": "token", "type": "address", "internalType": "address" }],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "removeStableSwapPath",
        "inputs": [{ "name": "token", "type": "address", "internalType": "address" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    { "type": "function", "name": "renounceOwnership", "inputs": [], "outputs": [], "stateMutability": "nonpayable" },
    {
        "type": "function",
        "name": "setV2StableSwapPath",
        "inputs": [
            { "name": "token", "type": "address", "internalType": "address" },
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct BalancerOracle.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "setV3StableSwapPath",
        "inputs": [
            { "name": "token", "type": "address", "internalType": "address" },
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "transferOwnership",
        "inputs": [{ "name": "newOwner", "type": "address", "internalType": "address" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "v2Queries",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "contract IBalancerQueries" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "v3BatchRouter",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "contract IBatchRouterQueries" }],
        "stateMutability": "view"
    },
    {
        "type": "event",
        "name": "OwnershipTransferred",
        "inputs": [
            { "name": "previousOwner", "type": "address", "indexed": true, "internalType": "address" },
            { "name": "newOwner", "type": "address", "indexed": true, "internalType": "address" }
        ],
        "anonymous": false
    }
];

export const arbbotV2Abi = [
    {
        "type": "constructor",
        "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "BALANCER_V2_VAULT",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "BALANCER_V3_ROUTER",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "BALANCER_V3_VAULT",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "ERC20_LIFT",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "contract IERC20Lift" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "GNO",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "HUB_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "contract IHubV2" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "POOL_MULTI_V3",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "POOL_SDAI_WAGNO_GNO_V3",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "POOL_WAGNO_GNO_WAGNO_WSTETH_V3",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "POOL_WAGNO_WETH_WAGNO_WSTETH_V3",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "SDAI",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WAGNO_GNO",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WAGNO_WETH",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WAGNO_WSTETH",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WBTC",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WBTC_WSTETH_POOL_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WETH",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WETH_WSTETH_POOL_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WSTETH",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WSTETH_GNO_POOL_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "WSTETH_SDAI_POOL_V2",
        "inputs": [],
        "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildBackwardSwapConfigV2",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v2PoolId", "type": "bytes32", "internalType": "bytes32" },
            { "name": "amount", "type": "uint256", "internalType": "uint256" }
        ],
        "outputs": [
            {
                "name": "swapConfigs",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.SwapConfig[]",
                "components": [
                    { "name": "isV3", "type": "bool", "internalType": "bool" },
                    { "name": "swapData", "type": "bytes", "internalType": "bytes" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildBackwardSwapConfigV3",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v3PoolAddress", "type": "address", "internalType": "address" },
            { "name": "amount", "type": "uint256", "internalType": "uint256" }
        ],
        "outputs": [
            {
                "name": "swapConfigs",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.SwapConfig[]",
                "components": [
                    { "name": "isV3", "type": "bool", "internalType": "bool" },
                    { "name": "swapData", "type": "bytes", "internalType": "bytes" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildBackwardSwapStepsV2",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v2PoolId", "type": "bytes32", "internalType": "bytes32" }
        ],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildBackwardSwapStepsV3",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v3PoolAddress", "type": "address", "internalType": "address" }
        ],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildForwardSwapConfigV2",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v2PoolId", "type": "bytes32", "internalType": "bytes32" },
            { "name": "amount", "type": "uint256", "internalType": "uint256" }
        ],
        "outputs": [
            {
                "name": "swapConfigs",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.SwapConfig[]",
                "components": [
                    { "name": "isV3", "type": "bool", "internalType": "bool" },
                    { "name": "swapData", "type": "bytes", "internalType": "bytes" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildForwardSwapConfigV3",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v3PoolAddress", "type": "address", "internalType": "address" },
            { "name": "amount", "type": "uint256", "internalType": "uint256" }
        ],
        "outputs": [
            {
                "name": "swapConfigs",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.SwapConfig[]",
                "components": [
                    { "name": "isV3", "type": "bool", "internalType": "bool" },
                    { "name": "swapData", "type": "bytes", "internalType": "bytes" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildForwardSwapStepsV2",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v2PoolId", "type": "bytes32", "internalType": "bytes32" }
        ],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "buildForwardSwapStepsV3",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v3PoolAddress", "type": "address", "internalType": "address" }
        ],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "executeArbitrage",
        "inputs": [
            {
                "name": "params",
                "type": "tuple",
                "internalType": "struct CirclesArbbotV2.ArbitrageParams",
                "components": [
                    { "name": "flashLoanToken", "type": "address", "internalType": "address" },
                    { "name": "flashLoanAmount", "type": "uint256", "internalType": "uint256" },
                    { "name": "unwrapFlashloanToken", "type": "bool", "internalType": "bool" },
                    { "name": "flashloanUnderlyingToken", "type": "address", "internalType": "address" },
                    {
                        "name": "forwardSwaps",
                        "type": "tuple[]",
                        "internalType": "struct CirclesArbbotV2.SwapConfig[]",
                        "components": [
                            { "name": "isV3", "type": "bool", "internalType": "bool" },
                            { "name": "swapData", "type": "bytes", "internalType": "bytes" }
                        ]
                    },
                    { "name": "sourceCRC", "type": "address", "internalType": "address" },
                    { "name": "targetCRC", "type": "address", "internalType": "address" },
                    {
                        "name": "transitiveePath",
                        "type": "tuple",
                        "internalType": "struct CirclesArbbotV2.CirclesPath",
                        "components": [
                            { "name": "flowVertices", "type": "address[]", "internalType": "address[]" },
                            {
                                "name": "flow",
                                "type": "tuple[]",
                                "internalType": "struct FlowEdge[]",
                                "components": [
                                    { "name": "streamSinkId", "type": "uint16", "internalType": "uint16" },
                                    { "name": "amount", "type": "uint192", "internalType": "uint192" }
                                ]
                            },
                            {
                                "name": "streams",
                                "type": "tuple[]",
                                "internalType": "struct Stream[]",
                                "components": [
                                    { "name": "sourceCoordinate", "type": "uint16", "internalType": "uint16" },
                                    { "name": "flowEdgeIds", "type": "uint16[]", "internalType": "uint16[]" },
                                    { "name": "data", "type": "bytes", "internalType": "bytes" }
                                ]
                            },
                            { "name": "packedCoordinates", "type": "bytes", "internalType": "bytes" }
                        ]
                    },
                    {
                        "name": "backwardSwaps",
                        "type": "tuple[]",
                        "internalType": "struct CirclesArbbotV2.SwapConfig[]",
                        "components": [
                            { "name": "isV3", "type": "bool", "internalType": "bool" },
                            { "name": "swapData", "type": "bytes", "internalType": "bytes" }
                        ]
                    },
                    { "name": "wrapBackToFlashloan", "type": "bool", "internalType": "bool" },
                    { "name": "backwardOutputToken", "type": "address", "internalType": "address" },
                    { "name": "collector", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "getIntermediateTokenV2",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "poolId", "type": "bytes32", "internalType": "bytes32" }
        ],
        "outputs": [{ "name": "intermediateToken", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getIntermediateTokenV3",
        "inputs": [
            { "name": "crcToken", "type": "address", "internalType": "address" },
            { "name": "v3PoolAddress", "type": "address", "internalType": "address" }
        ],
        "outputs": [{ "name": "intermediateToken", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getV2StableSwapPath",
        "inputs": [{ "name": "token", "type": "address", "internalType": "address" }],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "getV3StableSwapPath",
        "inputs": [{ "name": "token", "type": "address", "internalType": "address" }],
        "outputs": [
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "onERC1155BatchReceived",
        "inputs": [
            { "name": "", "type": "address", "internalType": "address" },
            { "name": "", "type": "address", "internalType": "address" },
            { "name": "", "type": "uint256[]", "internalType": "uint256[]" },
            { "name": "", "type": "uint256[]", "internalType": "uint256[]" },
            { "name": "", "type": "bytes", "internalType": "bytes" }
        ],
        "outputs": [{ "name": "", "type": "bytes4", "internalType": "bytes4" }],
        "stateMutability": "pure"
    },
    {
        "type": "function",
        "name": "onERC1155Received",
        "inputs": [
            { "name": "", "type": "address", "internalType": "address" },
            { "name": "", "type": "address", "internalType": "address" },
            { "name": "", "type": "uint256", "internalType": "uint256" },
            { "name": "", "type": "uint256", "internalType": "uint256" },
            { "name": "", "type": "bytes", "internalType": "bytes" }
        ],
        "outputs": [{ "name": "", "type": "bytes4", "internalType": "bytes4" }],
        "stateMutability": "pure"
    },
    {
        "type": "function",
        "name": "owner",
        "inputs": [],
        "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "removeStableSwapPath",
        "inputs": [{ "name": "token", "type": "address", "internalType": "address" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    { "type": "function", "name": "renounceOwnership", "inputs": [], "outputs": [], "stateMutability": "nonpayable" },
    {
        "type": "function",
        "name": "rescueERC1155",
        "inputs": [
            { "name": "token", "type": "address", "internalType": "address" },
            { "name": "id", "type": "uint256", "internalType": "uint256" },
            { "name": "to", "type": "address", "internalType": "address" },
            { "name": "amount", "type": "uint256", "internalType": "uint256" }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "rescueERC20",
        "inputs": [
            { "name": "token", "type": "address", "internalType": "address" },
            { "name": "to", "type": "address", "internalType": "address" },
            { "name": "amount", "type": "uint256", "internalType": "uint256" }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "setV2StableSwapPath",
        "inputs": [
            { "name": "token", "type": "address", "internalType": "address" },
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.V2SwapStep[]",
                "components": [
                    { "name": "poolId", "type": "bytes32", "internalType": "bytes32" },
                    { "name": "tokenOut", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "setV3StableSwapPath",
        "inputs": [
            { "name": "token", "type": "address", "internalType": "address" },
            {
                "name": "steps",
                "type": "tuple[]",
                "internalType": "struct CirclesArbbotV2.SwapPathStep[]",
                "components": [
                    { "name": "pool", "type": "address", "internalType": "address" },
                    { "name": "tokenOut", "type": "address", "internalType": "contract IERC20" },
                    { "name": "isBuffer", "type": "bool", "internalType": "bool" }
                ]
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "supportsInterface",
        "inputs": [{ "name": "interfaceId", "type": "bytes4", "internalType": "bytes4" }],
        "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
        "stateMutability": "pure"
    },
    {
        "type": "function",
        "name": "transferOwnership",
        "inputs": [{ "name": "newOwner", "type": "address", "internalType": "address" }],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "trust",
        "inputs": [
            { "name": "trustee", "type": "address", "internalType": "address" },
            { "name": "expiry", "type": "uint96", "internalType": "uint96" }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "unlockCallback",
        "inputs": [
            {
                "name": "params",
                "type": "tuple",
                "internalType": "struct CirclesArbbotV2.ArbitrageParams",
                "components": [
                    { "name": "flashLoanToken", "type": "address", "internalType": "address" },
                    { "name": "flashLoanAmount", "type": "uint256", "internalType": "uint256" },
                    { "name": "unwrapFlashloanToken", "type": "bool", "internalType": "bool" },
                    { "name": "flashloanUnderlyingToken", "type": "address", "internalType": "address" },
                    {
                        "name": "forwardSwaps",
                        "type": "tuple[]",
                        "internalType": "struct CirclesArbbotV2.SwapConfig[]",
                        "components": [
                            { "name": "isV3", "type": "bool", "internalType": "bool" },
                            { "name": "swapData", "type": "bytes", "internalType": "bytes" }
                        ]
                    },
                    { "name": "sourceCRC", "type": "address", "internalType": "address" },
                    { "name": "targetCRC", "type": "address", "internalType": "address" },
                    {
                        "name": "transitiveePath",
                        "type": "tuple",
                        "internalType": "struct CirclesArbbotV2.CirclesPath",
                        "components": [
                            { "name": "flowVertices", "type": "address[]", "internalType": "address[]" },
                            {
                                "name": "flow",
                                "type": "tuple[]",
                                "internalType": "struct FlowEdge[]",
                                "components": [
                                    { "name": "streamSinkId", "type": "uint16", "internalType": "uint16" },
                                    { "name": "amount", "type": "uint192", "internalType": "uint192" }
                                ]
                            },
                            {
                                "name": "streams",
                                "type": "tuple[]",
                                "internalType": "struct Stream[]",
                                "components": [
                                    { "name": "sourceCoordinate", "type": "uint16", "internalType": "uint16" },
                                    { "name": "flowEdgeIds", "type": "uint16[]", "internalType": "uint16[]" },
                                    { "name": "data", "type": "bytes", "internalType": "bytes" }
                                ]
                            },
                            { "name": "packedCoordinates", "type": "bytes", "internalType": "bytes" }
                        ]
                    },
                    {
                        "name": "backwardSwaps",
                        "type": "tuple[]",
                        "internalType": "struct CirclesArbbotV2.SwapConfig[]",
                        "components": [
                            { "name": "isV3", "type": "bool", "internalType": "bool" },
                            { "name": "swapData", "type": "bytes", "internalType": "bytes" }
                        ]
                    },
                    { "name": "wrapBackToFlashloan", "type": "bool", "internalType": "bool" },
                    { "name": "backwardOutputToken", "type": "address", "internalType": "address" },
                    { "name": "collector", "type": "address", "internalType": "address" }
                ]
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "event",
        "name": "ArbitrageExecuted",
        "inputs": [
            { "name": "sourceCRC", "type": "address", "indexed": true, "internalType": "address" },
            { "name": "targetCRC", "type": "address", "indexed": true, "internalType": "address" },
            { "name": "profit", "type": "uint256", "indexed": false, "internalType": "uint256" }
        ],
        "anonymous": false
    },
    {
        "type": "event",
        "name": "FlashLoanReceived",
        "inputs": [
            { "name": "token", "type": "address", "indexed": true, "internalType": "address" },
            { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" }
        ],
        "anonymous": false
    },
    {
        "type": "event",
        "name": "OwnershipTransferred",
        "inputs": [
            { "name": "previousOwner", "type": "address", "indexed": true, "internalType": "address" },
            { "name": "newOwner", "type": "address", "indexed": true, "internalType": "address" }
        ],
        "anonymous": false
    },
    { "type": "error", "name": "CRCUnwrapFailed", "inputs": [] },
    { "type": "error", "name": "CRCWrapFailed", "inputs": [] },
    { "type": "error", "name": "InvalidSwapPath", "inputs": [] },
    { "type": "error", "name": "NoProfitGenerated", "inputs": [] },
    {
        "type": "error",
        "name": "OwnableInvalidOwner",
        "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }]
    },
    {
        "type": "error",
        "name": "OwnableUnauthorizedAccount",
        "inputs": [{ "name": "account", "type": "address", "internalType": "address" }]
    },
    { "type": "error", "name": "SwapFailed", "inputs": [] },
    { "type": "error", "name": "TransitiveTransferFailed", "inputs": [] },
    { "type": "error", "name": "UnauthorizedCallback", "inputs": [] }
];

export const baseGroupMintRouterAbi = [
  {
    type: "function",
    name: "enableCRCForRouting",
    inputs: [{ name: "crcList", type: "address[]", internalType: "address[]" }],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "disableCRCForRouting",
    inputs: [{ name: "crcList", type: "address[]", internalType: "address[]" }],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const;