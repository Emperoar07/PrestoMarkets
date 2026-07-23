// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {wadExp, wadLn, wadMul, wadDiv} from "solmate/src/utils/SignedWadMath.sol";

/// @notice LMSR prediction market. Collateral-agnostic (USDC or EURC, 6 decimals).
/// @dev Shares are tracked in 18-decimal WAD; 1 winning share redeems for 1 collateral unit.
/// Pricing uses the logarithmic market scoring rule: C(q) = b * ln(sum exp(q_i / b)).
contract PrestoLmsrMarket is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum State { Open, Proposed, Disputed, Resolved, Canceled }

    IERC20 public immutable collateralToken;
    address public immutable resolver;
    address public immutable creator;
    address public immutable factory;
    uint64 public immutable closeTime;
    uint8 public immutable marketKind;
    uint8 public immutable outcomeCount;
    string public metadataURI;
    uint16 public immutable feeBps;
    address public immutable protocolFeeRecipient;
    address public immutable guardian; // can pause/unpause in an emergency

    int256 public immutable b; // liquidity parameter, WAD
    int256[] internal q;       // per-outcome net shares, WAD
    mapping(uint8 => mapping(address => uint256)) public userShares6; // outcome => holder => shares (6dp)

    uint256 public immutable bond6; // proposer/disputer bond (6dp)
    uint256 public constant RESOLUTION_CHALLENGE_WINDOW = 30 minutes;
    uint256 public constant RESOLUTION_TIMEOUT = 7 days; // after close, anyone can cancel a stuck market

    State public state;
    bool public seeded;
    uint256 public accruedFees6;

    // Optimistic resolution.
    address public proposer;
    uint8 public proposedOutcome;
    uint64 public proposalTime;
    address public disputer;
    uint8 public winningOutcome;

    event SharesBought(address indexed buyer, uint8 indexed outcome, uint256 shares6, uint256 cost6);
    event SharesSold(address indexed seller, uint8 indexed outcome, uint256 shares6, uint256 refund6);
    event ResolutionProposed(uint8 indexed outcome, address indexed proposer, string evidenceURI);
    event ResolutionDisputed(address indexed disputer, string reason);
    event Resolved(uint8 indexed outcome);
    event WinnerPaid(address indexed winner, uint256 amount6);
    event FeesWithdrawn(address indexed to, uint256 amount6);
    event MarketCanceled();
    event Refunded(address indexed holder, uint256 amount6);

    error WrongOutcome();
    error NotSeeded();
    error AlreadySeeded();
    error MarketClosed();
    error MarketNotClosed();
    error SlippageExceeded();
    error InsufficientShares();
    error NotResolver();
    error NotProposed();
    error NotDisputed();
    error NotResolved();
    error ChallengeWindowOpen();
    error ChallengeWindowClosed();
    error NoPosition();
    error NotGuardian();
    error NotCancelable();
    error TimeoutNotReached();
    error NotCanceled();

    modifier onlyOpen() {
        if (state != State.Open) revert MarketClosed();
        if (block.timestamp >= closeTime) revert MarketClosed();
        _;
    }

    constructor(
        address collateral_,
        address resolver_,
        uint64 closeTime_,
        uint8 marketKind_,
        string memory metadataURI_,
        uint8 outcomeCount_,
        uint256 seed6_,
        uint16 feeBps_,
        address protocolFeeRecipient_,
        address creator_,
        uint256 bond6_,
        address guardian_
    ) {
        require(outcomeCount_ >= 2 && outcomeCount_ <= 12, "outcomes");
        require(collateral_ != address(0) && resolver_ != address(0), "zero");
        require(seed6_ > 0, "seed");
        require(feeBps_ <= 1000, "fee"); // <= 10%
        collateralToken = IERC20(collateral_);
        resolver = resolver_;
        closeTime = closeTime_;
        marketKind = marketKind_;
        metadataURI = metadataURI_;
        outcomeCount = outcomeCount_;
        feeBps = feeBps_;
        protocolFeeRecipient = protocolFeeRecipient_;
        creator = creator_;
        bond6 = bond6_;
        guardian = guardian_ == address(0) ? msg.sender : guardian_;
        factory = msg.sender;
        q = new int256[](outcomeCount_);
        // b = S / ln(n), so the maximum maker loss b*ln(n) equals the seed S exactly.
        int256 seedWad = int256(seed6_) * 1e12;
        int256 lnN = wadLn(int256(uint256(outcomeCount_)) * 1e18);
        b = wadDiv(seedWad, lnN);
        state = State.Open;
    }

    /// @notice Pull the maker subsidy (= seed S) from the caller. Called once after deploy.
    function seed() external nonReentrant {
        if (seeded) revert AlreadySeeded();
        seeded = true;
        collateralToken.safeTransferFrom(msg.sender, address(this), _maxLoss6());
    }

    function _maxLoss6() internal view returns (uint256) {
        int256 lnN = wadLn(int256(uint256(outcomeCount)) * 1e18);
        int256 sWad = wadMul(b, lnN);
        return uint256(sWad) / 1e12;
    }

    /// @dev C(q) = b * ln(sum exp(q_i / b)), log-sum-exp stabilized to avoid overflow.
    function _cost(int256[] memory qq) internal view returns (int256) {
        int256 maxQ = qq[0];
        for (uint256 i = 1; i < qq.length; i++) {
            if (qq[i] > maxQ) maxQ = qq[i];
        }
        int256 sumExp;
        for (uint256 i = 0; i < qq.length; i++) {
            sumExp += wadExp(wadDiv(qq[i] - maxQ, b));
        }
        return wadMul(b, wadLn(sumExp)) + maxQ;
    }

    /// @notice Live LMSR price of an outcome in WAD; prices sum to ~1e18 across outcomes.
    function price(uint8 outcome) external view returns (uint256) {
        if (outcome >= outcomeCount) revert WrongOutcome();
        int256 maxQ = q[0];
        for (uint256 i = 1; i < q.length; i++) {
            if (q[i] > maxQ) maxQ = q[i];
        }
        int256 denom;
        for (uint256 i = 0; i < q.length; i++) {
            denom += wadExp(wadDiv(q[i] - maxQ, b));
        }
        int256 num = wadExp(wadDiv(q[outcome] - maxQ, b));
        return uint256(wadDiv(num, denom));
    }

    /// @notice Collateral (6dp) needed to buy `shares6` of `outcome`, fee excluded. Rounds up.
    function buyCost(uint8 outcome, uint256 shares6) public view returns (uint256) {
        if (outcome >= outcomeCount) revert WrongOutcome();
        int256[] memory q2 = q; // memory copy of the storage array
        int256 deltaWad = int256(shares6) * 1e12;
        int256 before = _cost(q2);
        q2[outcome] += deltaWad;
        int256 afterCost = _cost(q2);
        int256 costWad = afterCost - before;
        if (costWad < 0) costWad = 0;
        return (uint256(costWad) + 1e12 - 1) / 1e12; // round 6dp up
    }

    function _fee6(uint256 amount6) internal view returns (uint256) {
        return (amount6 * feeBps) / 10_000;
    }

    /// @notice Buy `shares6` of `outcome`, paying LMSR cost + fee, guarded by `maxCost6`.
    function buy(uint8 outcome, uint256 shares6, uint256 maxCost6) external nonReentrant whenNotPaused onlyOpen {
        if (!seeded) revert NotSeeded();
        if (outcome >= outcomeCount) revert WrongOutcome();
        uint256 cost = buyCost(outcome, shares6);
        uint256 fee = _fee6(cost);
        uint256 total = cost + fee;
        if (total > maxCost6) revert SlippageExceeded();
        q[outcome] += int256(shares6) * 1e12;
        userShares6[outcome][msg.sender] += shares6;
        accruedFees6 += fee;
        collateralToken.safeTransferFrom(msg.sender, address(this), total);
        emit SharesBought(msg.sender, outcome, shares6, cost);
    }

    /// @notice Collateral (6dp) returned for selling `shares6` of `outcome`, fee excluded. Rounds down.
    function sellRefund(uint8 outcome, uint256 shares6) public view returns (uint256) {
        if (outcome >= outcomeCount) revert WrongOutcome();
        int256[] memory q2 = q;
        int256 before = _cost(q2);
        q2[outcome] -= int256(shares6) * 1e12;
        int256 afterCost = _cost(q2);
        int256 refundWad = before - afterCost;
        if (refundWad < 0) refundWad = 0;
        return uint256(refundWad) / 1e12; // round 6dp down
    }

    /// @notice Sell `shares6` of `outcome` back to the maker for the LMSR refund minus fee.
    function sell(uint8 outcome, uint256 shares6, uint256 minRefund6) external nonReentrant whenNotPaused onlyOpen {
        if (shares6 > userShares6[outcome][msg.sender]) revert InsufficientShares();
        uint256 refund6 = sellRefund(outcome, shares6);
        uint256 fee = _fee6(refund6);
        uint256 net = refund6 - fee;
        if (net < minRefund6) revert SlippageExceeded();
        q[outcome] -= int256(shares6) * 1e12;
        userShares6[outcome][msg.sender] -= shares6;
        accruedFees6 += fee;
        collateralToken.safeTransfer(msg.sender, net);
        emit SharesSold(msg.sender, outcome, shares6, net);
    }

    // ----------------------------------------------------------------------
    // Optimistic resolution
    // ----------------------------------------------------------------------

    /// @notice Timestamp after which an unchallenged proposal can be settled.
    function proposalChallengeEndsAt() public view returns (uint64) {
        return proposalTime + uint64(RESOLUTION_CHALLENGE_WINDOW);
    }

    /// @notice Resolver proposes the winning outcome after close, posting a bond.
    function propose(uint8 outcome, string calldata evidenceURI) external nonReentrant whenNotPaused {
        if (msg.sender != resolver) revert NotResolver();
        if (state != State.Open) revert MarketClosed();
        if (block.timestamp < closeTime) revert MarketNotClosed();
        if (outcome >= outcomeCount) revert WrongOutcome();
        proposer = msg.sender;
        proposedOutcome = outcome;
        proposalTime = uint64(block.timestamp);
        state = State.Proposed;
        collateralToken.safeTransferFrom(msg.sender, address(this), bond6);
        emit ResolutionProposed(outcome, msg.sender, evidenceURI);
    }

    /// @notice A position holder disputes the proposal within the challenge window, posting a bond.
    function dispute(string calldata reason) external nonReentrant {
        if (state != State.Proposed) revert NotProposed();
        if (block.timestamp >= proposalChallengeEndsAt()) revert ChallengeWindowClosed();
        if (!_hasPosition(msg.sender)) revert NoPosition();
        disputer = msg.sender;
        state = State.Disputed;
        collateralToken.safeTransferFrom(msg.sender, address(this), bond6);
        emit ResolutionDisputed(msg.sender, reason);
    }

    /// @notice Settle an unchallenged proposal once the window closes; returns the proposer bond.
    function settle() external nonReentrant {
        if (state != State.Proposed) revert NotProposed();
        if (block.timestamp < proposalChallengeEndsAt()) revert ChallengeWindowOpen();
        state = State.Resolved;
        winningOutcome = proposedOutcome;
        if (bond6 > 0) collateralToken.safeTransfer(proposer, bond6);
        emit Resolved(winningOutcome);
    }

    /// @notice The GUARDIAN (not the resolver) adjudicates a disputed proposal, so the party that
    /// proposed the outcome is never the party that judges the dispute against it (audit #3:
    /// independent optimistic arbitration). The guardian is the factory owner — a distinct key from
    /// the agent-resolver that proposes — giving proposer/adjudicator separation with no new role.
    /// The bond loser is slashed to the winner.
    function resolveDisputed(uint8 finalOutcome, string calldata evidenceURI) external nonReentrant {
        if (msg.sender != guardian) revert NotGuardian();
        if (state != State.Disputed) revert NotDisputed();
        if (finalOutcome >= outcomeCount) revert WrongOutcome();
        state = State.Resolved;
        winningOutcome = finalOutcome;
        // If the proposal stood, the dispute was frivolous: proposer takes both bonds.
        // Otherwise the dispute was upheld: disputer takes both bonds.
        address bondWinner = finalOutcome == proposedOutcome ? proposer : disputer;
        if (bond6 > 0) collateralToken.safeTransfer(bondWinner, bond6 * 2);
        emit Resolved(finalOutcome);
        evidenceURI; // retained in calldata/logs by the caller; not stored on-chain
    }

    function _hasPosition(address who) internal view returns (bool) {
        for (uint8 i = 0; i < outcomeCount; i++) {
            if (userShares6[i][who] > 0) return true;
        }
        return false;
    }

    /// @notice Redeem the caller's winning shares 1:1 for collateral.
    function claim() external nonReentrant {
        if (state != State.Resolved) revert NotResolved();
        uint256 amount = userShares6[winningOutcome][msg.sender];
        if (amount == 0) revert NoPosition();
        userShares6[winningOutcome][msg.sender] = 0;
        collateralToken.safeTransfer(msg.sender, amount);
        emit WinnerPaid(msg.sender, amount);
    }

    /// @notice Push payouts to a batch of winners (idempotent; skips empty positions).
    function payWinners(address[] calldata winners) external nonReentrant {
        if (state != State.Resolved) revert NotResolved();
        for (uint256 i = 0; i < winners.length; i++) {
            address w = winners[i];
            uint256 amount = userShares6[winningOutcome][w];
            if (amount == 0) continue;
            userShares6[winningOutcome][w] = 0;
            collateralToken.safeTransfer(w, amount);
            emit WinnerPaid(w, amount);
        }
    }

    // ----------------------------------------------------------------------
    // Emergency pause + cancel / refund
    // ----------------------------------------------------------------------

    /// @notice Halt trading and proposals in an emergency. Claims and refunds stay open.
    function pause() external {
        if (msg.sender != guardian) revert NotGuardian();
        _pause();
    }

    function unpause() external {
        if (msg.sender != guardian) revert NotGuardian();
        _unpause();
    }

    /// @notice Resolver voids the market before close; holders then refund at LMSR value.
    function cancel() external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        if (state != State.Open) revert NotCancelable();
        state = State.Canceled;
        emit MarketCanceled();
    }

    /// @notice Anyone may void a market the resolver abandoned past the timeout. Disputed markets
    /// are included: after a dispute only the resolver can adjudicate, so without this hatch an
    /// abandoned dispute would lock every holder's collateral forever. Bonds return to their
    /// posters — with no adjudication there is no basis to slash either side.
    function timeoutCancel() external nonReentrant {
        if (state != State.Open && state != State.Proposed && state != State.Disputed) revert NotCancelable();
        if (block.timestamp < closeTime + RESOLUTION_TIMEOUT) revert TimeoutNotReached();
        State prior = state;
        state = State.Canceled;
        if (bond6 > 0) {
            if (prior == State.Proposed || prior == State.Disputed) collateralToken.safeTransfer(proposer, bond6);
            if (prior == State.Disputed) collateralToken.safeTransfer(disputer, bond6);
        }
        emit MarketCanceled();
    }

    /// @notice After cancellation, unwind the caller's entire position back to the maker at LMSR
    /// value (no fee). Sequential refunds are collateral-conserving: the pool always covers them
    /// and what remains once every position is unwound is the original seed subsidy.
    function refund() external nonReentrant {
        if (state != State.Canceled) revert NotCanceled();
        int256[] memory q2 = q; // mutate a memory copy, then write back
        uint256 payout6;
        bool any;
        for (uint8 i = 0; i < outcomeCount; i++) {
            uint256 held = userShares6[i][msg.sender];
            if (held == 0) continue;
            any = true;
            int256 before = _cost(q2);
            q2[i] -= int256(held) * 1e12;
            int256 refundWad = before - _cost(q2);
            if (refundWad > 0) payout6 += uint256(refundWad) / 1e12;
            userShares6[i][msg.sender] = 0;
        }
        if (!any) revert NoPosition();
        for (uint8 i = 0; i < outcomeCount; i++) q[i] = q2[i];
        if (payout6 > 0) collateralToken.safeTransfer(msg.sender, payout6);
        emit Refunded(msg.sender, payout6);
    }

    /// @notice Sweep accrued trading fees to the protocol recipient. Fees are surplus to the
    /// LMSR pool, so this never touches winner collateral.
    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees6;
        if (amount == 0) return;
        accruedFees6 = 0;
        collateralToken.safeTransfer(protocolFeeRecipient, amount);
        emit FeesWithdrawn(protocolFeeRecipient, amount);
    }

    function collateral() external view returns (address) {
        return address(collateralToken);
    }

    function totalShares(uint8 outcome) external view returns (int256) {
        return q[outcome];
    }

    function sharesOf(uint8 outcome, address who) external view returns (uint256) {
        return userShares6[outcome][who];
    }
}
