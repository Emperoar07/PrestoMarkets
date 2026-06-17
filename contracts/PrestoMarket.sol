// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal binary USDC market for the first Presto Markets pilot.
/// @dev This is a fixed-share pilot, not an AMM. Add pricing, selling, disputes, and oracle flow later.
contract PrestoMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_PROTOCOL_FEE_BPS = 500;
    uint256 public constant RESOLUTION_CHALLENGE_WINDOW = 30 minutes;
    /// @notice After closeTime + this timeout, anyone may cancel an unresolved market so a
    /// lost or dead resolver key can never strand participant funds.
    uint256 public constant RESOLUTION_TIMEOUT = 14 days;
    uint256 public constant BPS = 10_000;

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
    string public metadataURI;

    State public state;
    uint8 public winningOutcome;
    uint256 public totalCollateral;
    uint256 public resolvedCollateral;
    string public resolutionURI;
    uint8 public proposedOutcome;
    address public proposalProposer;
    uint256 public proposalTime;
    string public proposalURI;
    bool public proposalDisputed;

    mapping(uint8 => uint256) public totalShares;
    mapping(uint8 => mapping(address => uint256)) public sharesOf;
    mapping(address => bool) public claimed;

    event SharesBought(address indexed buyer, address indexed recipient, uint8 indexed outcome, uint256 amount);
    event ResolutionProposed(address indexed proposer, uint8 indexed outcome, string resolutionURI);
    event ResolutionDisputed(address indexed disputer, string reason);
    event MarketResolved(uint8 indexed winningOutcome, string resolutionURI, uint256 resolvedCollateral);
    event MarketCanceled();
    event Claimed(address indexed user, uint256 amount, uint256 fee);
    event Refunded(address indexed user, uint256 amount);

    error MarketClosed();
    error MarketNotClosed();
    error InvalidOutcome();
    error InvalidFee();
    error ZeroAddress();
    error NotResolver();
    error NotActive();
    error NotResolved();
    error AlreadyClaimed();
    error NoWinningShares();
    error ResolutionProposalPending();
    error NoResolutionProposal();
    error ChallengeWindowOpen();
    error ResolutionDisputedAlready();
    error ResolutionTimeoutNotReached();

    constructor(
        address collateral_,
        address creator_,
        address resolver_,
        address feeRecipient_,
        uint16 protocolFeeBps_,
        MarketKind marketKind_,
        uint256 closeTime_,
        string memory metadataURI_
    ) {
        if (collateral_ == address(0) || creator_ == address(0) || resolver_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert InvalidFee();
        require(closeTime_ > block.timestamp, "close must be future");

        collateral = IERC20(collateral_);
        creator = creator_;
        resolver = resolver_;
        feeRecipient = feeRecipient_;
        protocolFeeBps = protocolFeeBps_;
        marketKind = marketKind_;
        closeTime = closeTime_;
        metadataURI = metadataURI_;
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
        if (outcome > 1) revert InvalidOutcome();
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
        if (proposalProposer != address(0) && !proposalDisputed) revert ResolutionProposalPending();
        if (outcome > 1) revert InvalidOutcome();
        if (totalShares[outcome] == 0) revert NoWinningShares();

        _resolve(outcome, resolutionURI_);
    }

    function proposeResolution(uint8 outcome, string calldata resolutionURI_) external onlyResolver {
        if (state != State.Active) revert NotActive();
        if (block.timestamp < closeTime) revert MarketNotClosed();
        if (proposalProposer != address(0)) revert ResolutionProposalPending();
        if (outcome > 1) revert InvalidOutcome();
        if (totalShares[outcome] == 0) revert NoWinningShares();

        proposedOutcome = outcome;
        proposalProposer = msg.sender;
        proposalTime = block.timestamp;
        proposalURI = resolutionURI_;
        proposalDisputed = false;

        emit ResolutionProposed(msg.sender, outcome, resolutionURI_);
    }

    function disputeResolution(string calldata reason) external {
        if (state != State.Active) revert NotActive();
        if (proposalProposer == address(0)) revert NoResolutionProposal();
        if (proposalDisputed) revert ResolutionDisputedAlready();
        if (block.timestamp >= proposalChallengeEndsAt()) revert ChallengeWindowOpen();

        proposalDisputed = true;
        emit ResolutionDisputed(msg.sender, reason);
    }

    function settleProposedResolution() external {
        if (state != State.Active) revert NotActive();
        if (proposalProposer == address(0)) revert NoResolutionProposal();
        if (proposalDisputed) revert ResolutionDisputedAlready();
        if (block.timestamp < proposalChallengeEndsAt()) revert ChallengeWindowOpen();

        _resolve(proposedOutcome, proposalURI);
    }

    /// @notice Resolver may cancel at any time while Active. Early-cancel is safe by
    /// construction: cancellation refunds every participant their full stake.
    function cancel() external onlyResolver {
        if (state != State.Active) revert NotActive();
        state = State.Canceled;

        emit MarketCanceled();
    }

    /// @notice Permissionless escape hatch: once a market has sat unresolved long past close,
    /// anyone may cancel it so funds are always refundable even if the resolver disappears.
    function timeoutCancel() external {
        if (state != State.Active) revert NotActive();
        if (block.timestamp < closeTime + RESOLUTION_TIMEOUT) revert ResolutionTimeoutNotReached();
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

        uint256 amount = sharesOf[0][msg.sender] + sharesOf[1][msg.sender];
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

    function previewRefund(address user) external view returns (uint256) {
        if (state != State.Canceled) return 0;
        return sharesOf[0][user] + sharesOf[1][user];
    }

    function previewBuy(uint8 outcome, uint256 amount) external view returns (uint256 shares, uint256 impliedProbabilityBps, uint256 estimatedPayout) {
        if (outcome > 1) revert InvalidOutcome();
        shares = amount;
        impliedProbabilityBps = _impliedProbabilityBps(outcome);
        estimatedPayout = impliedProbabilityBps == 0 ? 0 : (amount * BPS) / impliedProbabilityBps;
    }

    function proposalChallengeEndsAt() public view returns (uint256) {
        if (proposalTime == 0) return 0;
        return proposalTime + RESOLUTION_CHALLENGE_WINDOW;
    }

    function _resolve(uint8 outcome, string memory resolutionURI_) internal {
        winningOutcome = outcome;
        resolutionURI = resolutionURI_;
        resolvedCollateral = collateral.balanceOf(address(this));
        state = State.Resolved;

        emit MarketResolved(outcome, resolutionURI_, resolvedCollateral);
    }

    function _impliedProbabilityBps(uint8 outcome) internal view returns (uint256) {
        uint256 total = totalShares[0] + totalShares[1];
        if (total == 0) return BPS / 2;
        return (totalShares[outcome] * BPS) / total;
    }
}
