// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-share market that supports two or more outcomes for Presto Markets V2.
contract PrestoMultiOutcomeMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant MIN_OUTCOMES = 2;
    uint8 public constant MAX_OUTCOMES = 12;
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 500;

    enum MarketKind {
        Prediction,
        Opinion,
        Opportunity
    }

    enum State {
        Active,
        Resolved,
        Canceled
    }

    IERC20 public immutable collateral;
    address public immutable creator;
    address public immutable resolver;
    address public immutable feeRecipient;
    uint256 public immutable closeTime;
    uint16 public immutable protocolFeeBps;
    MarketKind public immutable marketKind;
    uint8 public immutable outcomeCount;
    string public metadataURI;

    State public state;
    uint8 public winningOutcome;
    uint256 public totalCollateral;
    uint256 public resolvedCollateral;
    string public resolutionURI;

    mapping(uint8 => uint256) public totalShares;
    mapping(uint8 => mapping(address => uint256)) public sharesOf;
    mapping(address => bool) public claimed;

    event SharesBought(address indexed buyer, address indexed recipient, uint8 indexed outcome, uint256 amount);
    event MarketResolved(uint8 indexed winningOutcome, string resolutionURI, uint256 resolvedCollateral);
    event MarketCanceled();
    event Claimed(address indexed user, uint256 amount, uint256 fee);
    event Refunded(address indexed user, uint256 amount);

    error MarketClosed();
    error MarketNotClosed();
    error InvalidOutcome();
    error InvalidFee();
    error InvalidOutcomeCount();
    error ZeroAddress();
    error NotResolver();
    error NotActive();
    error NotResolved();
    error AlreadyClaimed();
    error NoWinningShares();

    constructor(
        address collateral_,
        address creator_,
        address resolver_,
        address feeRecipient_,
        uint16 protocolFeeBps_,
        MarketKind marketKind_,
        uint256 closeTime_,
        string memory metadataURI_,
        uint8 outcomeCount_
    ) {
        if (collateral_ == address(0) || creator_ == address(0) || resolver_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert InvalidFee();
        if (outcomeCount_ < MIN_OUTCOMES || outcomeCount_ > MAX_OUTCOMES) revert InvalidOutcomeCount();
        require(closeTime_ > block.timestamp, "close must be future");

        collateral = IERC20(collateral_);
        creator = creator_;
        resolver = resolver_;
        feeRecipient = feeRecipient_;
        protocolFeeBps = protocolFeeBps_;
        marketKind = marketKind_;
        closeTime = closeTime_;
        metadataURI = metadataURI_;
        outcomeCount = outcomeCount_;
        state = State.Active;
    }

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    function buy(uint8 outcome, uint256 amount) external {
        buyFor(msg.sender, outcome, amount);
    }

    function buyFor(address recipient, uint8 outcome, uint256 amount) public nonReentrant {
        if (state != State.Active) revert NotActive();
        if (block.timestamp >= closeTime) revert MarketClosed();
        _validateOutcome(outcome);
        if (recipient == address(0)) revert ZeroAddress();
        require(amount > 0, "amount required");

        collateral.safeTransferFrom(msg.sender, address(this), amount);
        sharesOf[outcome][recipient] += amount;
        totalShares[outcome] += amount;
        totalCollateral += amount;

        emit SharesBought(msg.sender, recipient, outcome, amount);
    }

    function resolve(uint8 outcome, string calldata resolutionURI_) external onlyResolver {
        if (state != State.Active) revert NotActive();
        if (block.timestamp < closeTime) revert MarketNotClosed();
        _validateOutcome(outcome);
        if (totalShares[outcome] == 0) revert NoWinningShares();

        winningOutcome = outcome;
        resolutionURI = resolutionURI_;
        resolvedCollateral = collateral.balanceOf(address(this));
        state = State.Resolved;

        emit MarketResolved(outcome, resolutionURI_, resolvedCollateral);
    }

    function cancel() external onlyResolver {
        if (state != State.Active) revert NotActive();
        if (block.timestamp < closeTime) revert MarketNotClosed();
        state = State.Canceled;

        emit MarketCanceled();
    }

    function claim() external nonReentrant {
        if (state != State.Resolved) revert NotResolved();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        uint256 userShares = sharesOf[winningOutcome][msg.sender];
        require(userShares > 0, "no winning shares");

        (uint256 payout, uint256 fee) = previewClaim(msg.sender);
        claimed[msg.sender] = true;
        if (fee > 0) collateral.safeTransfer(feeRecipient, fee);
        collateral.safeTransfer(msg.sender, payout);

        emit Claimed(msg.sender, payout, fee);
    }

    function refund() external nonReentrant {
        if (state != State.Canceled) revert NotResolved();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        uint256 amount = previewRefund(msg.sender);
        require(amount > 0, "nothing to refund");

        claimed[msg.sender] = true;
        collateral.safeTransfer(msg.sender, amount);

        emit Refunded(msg.sender, amount);
    }

    function previewClaim(address user) public view returns (uint256 payout, uint256 fee) {
        if (state != State.Resolved) return (0, 0);
        uint256 userShares = sharesOf[winningOutcome][user];
        if (userShares == 0 || totalShares[winningOutcome] == 0) return (0, 0);

        uint256 gross = (resolvedCollateral * userShares) / totalShares[winningOutcome];
        fee = (gross * protocolFeeBps) / 10_000;
        payout = gross - fee;
    }

    function previewRefund(address user) public view returns (uint256 amount) {
        if (state != State.Canceled) return 0;
        for (uint8 outcome = 0; outcome < outcomeCount; outcome++) {
            amount += sharesOf[outcome][user];
        }
    }

    function _validateOutcome(uint8 outcome) internal view {
        if (outcome >= outcomeCount) revert InvalidOutcome();
    }
}
