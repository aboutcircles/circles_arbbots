// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {IBalancerVault} from "src/interfaces/IBalancerVault.sol";
import {IHubV2, FlowEdge, Stream} from "src/interfaces/IHubV2.sol";
import {IERC20Lift, CirclesType} from "src/interfaces/IERC20Lift.sol";
import {IInflationaryCircles} from "src/interfaces/IInflationaryCircles.sol";


import {console} from "forge-std/console.sol";
// @todo update License
/**
 * @title CirclesArbbotMiddleware
 * @dev Contract that executes two Balancer V2 batch swaps in sequence
 */
contract CirclesArbbotMiddleware is Ownable {
    using SafeERC20 for IERC20; // @todo check if it is required

    /* @param kind The swap kind for the swap (GIVEN_IN or GIVEN_OUT)
     * @param swaps The swap steps for the batch swap
     * @param assets The assets involved in the batch swap
     * @param funds The fund management parameters for the swap
     * @param limits The limits for the batch swap
     * @param deadline The deadline for the batch swap
    */
    // Struct
    struct BatchSwap {
        IBalancerVault.SwapKind swapKind;
        IBalancerVault.BatchSwapStep[] swaps;
        address[] assets;
        IBalancerVault.FundManagement funds;
        int256[] limits;
        uint256 deadline;
    }

    struct Path {
        address[] flowVertices;
        FlowEdge[] flow;
        Stream[] streams;
        bytes packedCoordinates;
    }

    // Balancer V2 Vault address
    address public constant balancerVault = address(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    /// Address of the Hub contract to check if an address is a Circles account
    IHubV2 public constant HUB_V2 = IHubV2(address(0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8));

    IERC20Lift public constant ERC20Lift = IERC20Lift(0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5);


    // Events
    event SequentialBatchSwapExecuted(
        address indexed caller,
        int256[] firstSwapReturns,
        int256[] secondSwapReturns
    );
    
    /**
     * @dev Constructor
     */
    constructor() Ownable(msg.sender) {
        // register itself as org
        HUB_V2.registerOrganization("ArbbotMiddleware", 0);
    }

    /**
     * @dev Executes the first batch swap
     */
    function _executeBatchSwap(
        IBalancerVault.SwapKind kind,
        IBalancerVault.BatchSwapStep[] calldata swaps,
        address[] calldata assets,
        IBalancerVault.FundManagement calldata funds,
        int256[] calldata limits,
        uint256 deadline
    ) private returns (int256[] memory) {
        return IBalancerVault(balancerVault).batchSwap(
            kind,
            swaps,
            assets,
            funds,
            limits,
            deadline
        );
    }
    
    function _executeFlow(
        address[] calldata _flowVertices,
        FlowEdge[] calldata _flow,
        Stream[] calldata _streams,
        bytes calldata _packedCoordinates
    ) public {
        HUB_V2.operateFlowMatrix(_flowVertices, _flow, _streams, _packedCoordinates);
    }

    /**
     * @dev Executes two batch swaps sequentially
     * @return firstReturns The returns from the first batch swap
     * @return secondReturns The returns from the second batch swap
     */

    function executeSequentialBatchSwaps(
        address crcToBuy,
        address crcToSell,
        BatchSwap calldata buySwap,
        BatchSwap calldata sellSwap,
        Path calldata pathFlow
    ) external payable returns (int256[] memory firstReturns, int256[] memory secondReturns) {
        address assetToSell = buySwap.assets[0];

        IERC20(assetToSell).approve(balancerVault, uint256(buySwap.limits[0]));
        // Execute first batch swap
        firstReturns = _executeBatchSwap(
            buySwap.swapKind,
            buySwap.swaps,
            buySwap.assets,
            buySwap.funds,
            buySwap.limits,
            buySwap.deadline
        );
        // @todo estimate before and after balance
        uint256 purchasedCRCAmount = IERC20(crcToBuy).balanceOf(address(this));

        // Unwrap
        IInflationaryCircles(crcToBuy).unwrap(purchasedCRCAmount);
        address avatarBuy = IInflationaryCircles(crcToBuy).avatar();
        console.log(HUB_V2.balanceOf(address(this), uint256(uint160(avatarBuy))));
        // @todo call the pathfinder
        // @todo convert tokens back
        // @todo this might be stored in transient storage
        // Execute second batch swap
        //@todo remove
        return (firstReturns, firstReturns);
        secondReturns = _executeBatchSwap(
            sellSwap.swapKind,
            sellSwap.swaps,
            sellSwap.assets,
            sellSwap.funds,
            sellSwap.limits,
            sellSwap.deadline
        );

        // @todo trust the incoming asset
        _executeFlow(
            pathFlow.flowVertices,
            pathFlow.flow,
            pathFlow.streams,
            pathFlow.packedCoordinates
        );
        // @todo execute the sell swap
        emit SequentialBatchSwapExecuted(msg.sender, firstReturns, secondReturns);
        
        return (firstReturns, secondReturns);
    }
    
    /**
     * @dev Approves tokens for the Balancer Vault
     * @param tokens The tokens to approve
     */
    function approveVault(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(balancerVault, type(uint256).max);
        }
    }
    
    /**
     * @dev Revokes approvals for tokens
     * @param tokens The tokens to revoke approval for
     */
    function revokeApprovals(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(balancerVault, 0);
        }
    }
    
    /**
     * @dev Rescues tokens accidentally sent to this contract
     * @param token The token to rescue
     * @param to The address to send the tokens to
     * @param amount The amount of tokens to rescue
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
    
    /**
     * @dev Allows the contract to receive ETH
     */
    receive() external payable {}

    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) external returns (bytes4) {
        return this.onERC1155Received.selector;
    }

}