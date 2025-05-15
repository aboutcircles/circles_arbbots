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

export const hubV2Abi = [
  {
    constant: true,
    inputs: [{ name: "", type: "address" }],
    name: "treasuries",
    outputs: [{ name: "", type: "address" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_id", type: "uint256" },
    ],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    type: "function",
    name: "safeTransferFrom",
    inputs: [
      {
        name: "_from",
        type: "address",
        internalType: "address",
      },
      {
        name: "_to",
        type: "address",
        internalType: "address",
      },
      {
        name: "_id",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "_value",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "_data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    inputs: [
      { name: "_truster", type: "address" },
      { name: "_trustee", type: "address" },
    ],
    name: "isTrusted",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "_group", type: "address" }],
    name: "isGroup",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];

export const bouncerOrgAbi = [
  {
    inputs: [{ name: "trustee", type: "address", internalType: "address" }],
    name: "forceTrust",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const groupTreasuryAbi = [
  {
    constant: true,
    inputs: [{ name: "user", type: "address" }],
    name: "vaults",
    outputs: [{ name: "", type: "address" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
];

export const groupRedeemAbi = [
  {
    constant: false,
    inputs: [
      { name: "group", type: "address" },
      { name: "redemptionIds", type: "uint256[]" },
      { name: "redemptionValues", type: "uint256[]" },
    ],
    name: "redeem",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "_group", type: "address" },
      { name: "_amountToRedeem", type: "uint256" },
      { name: "_partialFillable", type: "bool" },
    ],
    name: "redeemWithFoundCollateral",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const groupContractAbi = [
  {
    type: "function",
    name: "redemptionHandler",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
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

export const inflationaryTokenAbi = [
  {
    constant: true,
    inputs: [],
    name: "avatar",
    outputs: [{ name: "", type: "address" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "_demurrageValue", type: "uint256" },
      { name: "_dayUpdated", type: "uint64" },
    ],
    name: "convertDemurrageToInflationaryValue",
    outputs: [{ type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { name: "_inflationaryValue", type: "uint256" },
      { name: "_day", type: "uint64" },
    ],
    name: "convertInflationaryToDemurrageValue",
    outputs: [{ type: "uint256" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [{ name: "_timestamp", type: "uint256" }],
    name: "day",
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
    type: "function",
  },
];

export const inflationaryCirclesOperatorAbi = [
  {
    constant: true,
    inputs: [
      { name: "_account", type: "address" },
      { name: "_id", type: "uint256" },
    ],
    name: "inflationaryBalanceOf",
    outputs: [{ name: "", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
];

export const baseRedemptionEncoderAbi = [
  {
    type: "function",
    name: "structureRedemptionData",
    inputs: [
      {
        name: "_redemptionIds",
        type: "uint256[]",
        internalType: "uint256[]",
      },
      {
        name: "_redemptionValues",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    payable: false,
    stateMutability: "pure",
  },
];
export const baseGroupAbi = [
  {
    inputs: [],
    name: "BASE_MINT_HANDLER",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];

export const middlewareAbi = [
  {
    type: "function",
    name: "executeSequentialBatchSwaps",
    inputs: [
      {
        name: "ethToSpend",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "crcToBuy",
        type: "address",
        internalType: "address",
      },
      {
        name: "crcToSell",
        type: "address",
        internalType: "address",
      },
      {
        name: "buySwap",
        type: "tuple",
        components: [
          {
            name: "swapKind",
            type: "uint8",
            internalType: "enum IBalancerVault.SwapKind",
          },
          {
            name: "swaps",
            type: "tuple[]",
            components: [
              {
                name: "poolId",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "assetInIndex",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "assetOutIndex",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "amount",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "userData",
                type: "bytes",
                internalType: "bytes",
              },
            ],
            internalType: "struct IBalancerVault.BatchSwapStep[]",
          },
          {
            name: "assets",
            type: "address[]",
            internalType: "address[]",
          },
          {
            name: "funds",
            type: "tuple",
            components: [
              {
                name: "sender",
                type: "address",
                internalType: "address",
              },
              {
                name: "fromInternalBalance",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "recipient",
                type: "address",
                internalType: "address payable",
              },
              {
                name: "toInternalBalance",
                type: "bool",
                internalType: "bool",
              },
            ],
            internalType: "struct IBalancerVault.FundManagement",
          },
          {
            name: "limits",
            type: "int256[]",
            internalType: "int256[]",
          },
          {
            name: "deadline",
            type: "uint256",
            internalType: "uint256",
          },
        ],
        internalType: "struct CirclesArbbotMiddleware.BatchSwap",
      },
      {
        name: "sellSwap",
        type: "tuple",
        components: [
          {
            name: "swapKind",
            type: "uint8",
            internalType: "enum IBalancerVault.SwapKind",
          },
          {
            name: "swaps",
            type: "tuple[]",
            components: [
              {
                name: "poolId",
                type: "bytes32",
                internalType: "bytes32",
              },
              {
                name: "assetInIndex",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "assetOutIndex",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "amount",
                type: "uint256",
                internalType: "uint256",
              },
              {
                name: "userData",
                type: "bytes",
                internalType: "bytes",
              },
            ],
            internalType: "struct IBalancerVault.BatchSwapStep[]",
          },
          {
            name: "assets",
            type: "address[]",
            internalType: "address[]",
          },
          {
            name: "funds",
            type: "tuple",
            components: [
              {
                name: "sender",
                type: "address",
                internalType: "address",
              },
              {
                name: "fromInternalBalance",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "recipient",
                type: "address",
                internalType: "address payable",
              },
              {
                name: "toInternalBalance",
                type: "bool",
                internalType: "bool",
              },
            ],
            internalType: "struct IBalancerVault.FundManagement",
          },
          {
            name: "limits",
            type: "int256[]",
            internalType: "int256[]",
          },
          {
            name: "deadline",
            type: "uint256",
            internalType: "uint256",
          },
        ],
        internalType: "struct CirclesArbbotMiddleware.BatchSwap",
      },
      {
        name: "pathFlow",
        type: "tuple",
        components: [
          {
            name: "flowVertices",
            type: "address[]",
            internalType: "address[]",
          },
          {
            name: "flow",
            type: "tuple[]",
            components: [
              {
                name: "streamSinkId",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "amount",
                type: "uint192",
                internalType: "uint192",
              },
            ],
            internalType: "struct FlowEdge[]",
          },
          {
            name: "streams",
            type: "tuple[]",
            components: [
              {
                name: "sourceCoordinate",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "flowEdgeIds",
                type: "uint16[]",
                internalType: "uint16[]",
              },
              {
                name: "data",
                type: "bytes",
                internalType: "bytes",
              },
            ],
            internalType: "struct Stream[]",
          },
          {
            name: "packedCoordinates",
            type: "bytes",
            internalType: "bytes",
          },
        ],
        internalType: "struct CirclesArbbotMiddleware.Path",
      },
    ],
    outputs: [
      {
        name: "profit",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "payable",
  },
];
