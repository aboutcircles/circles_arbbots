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
            { name: "_spender", type: "address" }
        ],
        name: "allowance",
        outputs: [{ name: "remaining", type: "uint256" }],
        type: "function",
    },
    {
        inputs: [
            { name: '_spender', type: 'address' },
            { name: '_value', type: 'uint256' },
        ],
        name: 'approve',
        outputs: [{ type: 'bool' }],
        stateMutability: 'nonpayable',
        type: 'function',
    }
];

export const hubV2Abi = [
    {
        constant: true,
        inputs: [
            { name: "", type: "address" }
        ],
        name: "treasuries",
        outputs: [
            { name: "", type: "address" }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
    },
    {
        constant: true,
        inputs: [
            { name: "_owner", type: "address" },
            { name: "_id", type: "uint256" }
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
          { name: "approved", type: "bool" }
        ],
        name: "setApprovalForAll",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    }
];

export const groupTreasuryAbi = [
    {
        constant: true,
        inputs: [
            { name: "user", type: "address" }
        ],
        name: "vaults",
        outputs: [
            { name: "", type: "address" }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
    }
];

export const superGroupOperatorAbi = [
    {
        constant: false,
        inputs: [
            { name: "group", type: "address" },
            { name: "redemptionIds", type: "uint256[]" },
            { name: "redemptionValues", type: "uint256[]" }
        ],
        name: "redeem",
        outputs: [],
        payable: false,
        stateMutability: "nonpayable",
        type: "function"
    }    
];

export const tokenWrapperAbi = [{"inputs":[{"internalType":"contract IHubV2","name":"_hub","type":"address"},{"internalType":"contract INameRegistry","name":"_nameRegistry","type":"address"},{"internalType":"address","name":"_masterCopyERC20Demurrage","type":"address"},{"internalType":"address","name":"_masterCopyERC20Inflation","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesAmountOverflow","type":"error"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"uint8","name":"","type":"uint8"}],"name":"CirclesErrorAddressUintArgs","type":"error"},{"inputs":[{"internalType":"uint8","name":"","type":"uint8"}],"name":"CirclesErrorNoArgs","type":"error"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint8","name":"","type":"uint8"}],"name":"CirclesErrorOneAddressArg","type":"error"},{"inputs":[{"internalType":"uint256","name":"providedId","type":"uint256"},{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesIdMustBeDerivedFromAddress","type":"error"},{"inputs":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesInvalidCirclesId","type":"error"},{"inputs":[{"internalType":"uint256","name":"parameter","type":"uint256"},{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesInvalidParameter","type":"error"},{"inputs":[],"name":"CirclesProxyAlreadyInitialized","type":"error"},{"inputs":[{"internalType":"uint8","name":"code","type":"uint8"}],"name":"CirclesReentrancyGuard","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"avatar","type":"address"},{"indexed":true,"internalType":"address","name":"erc20Wrapper","type":"address"},{"indexed":false,"internalType":"enum CirclesType","name":"circlesType","type":"uint8"}],"name":"ERC20WrapperDeployed","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"contract Proxy","name":"proxy","type":"address"},{"indexed":false,"internalType":"address","name":"masterCopy","type":"address"}],"name":"ProxyCreation","type":"event"},{"inputs":[],"name":"ERC20_WRAPPER_SETUP_CALLPREFIX","outputs":[{"internalType":"bytes4","name":"","type":"bytes4"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_avatar","type":"address"},{"internalType":"enum CirclesType","name":"_circlesType","type":"uint8"}],"name":"ensureERC20","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"enum CirclesType","name":"","type":"uint8"},{"internalType":"address","name":"","type":"address"}],"name":"erc20Circles","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"hub","outputs":[{"internalType":"contract IHubV2","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"masterCopyERC20Wrapper","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"nameRegistry","outputs":[{"internalType":"contract INameRegistry","name":"","type":"address"}],"stateMutability":"view","type":"function"}];
