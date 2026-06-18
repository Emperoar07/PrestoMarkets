// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {wadExp, wadLn, wadMul, wadDiv} from "solmate/src/utils/SignedWadMath.sol";

/// @notice LMSR prediction market. Collateral-agnostic (USDC or EURC, 6 decimals).
/// @dev Shares are tracked in 18-decimal WAD; 1 winning share redeems for 1 collateral unit.
/// Pricing uses the logarithmic market scoring rule: C(q) = b * ln(sum exp(q_i / b)).
contract PrestoLmsrMarket is ReentrancyGuard {
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

    int256 public immutable b; // liquidity parameter, WAD
    int256[] internal q;       // per-outcome net shares, WAD
    mapping(uint8 => mapping(address => uint256)) public userShares6; // outcome => holder => shares (6dp)

    State public state;
    bool public seeded;
    uint256 public accruedFees6;

    event SharesBought(address indexed buyer, uint8 indexed outcome, uint256 shares6, uint256 cost6);

    error WrongOutcome();
    error NotSeeded();
    error AlreadySeeded();
    error MarketClosed();
    error SlippageExceeded();

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
        address creator_
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
    function buy(uint8 outcome, uint256 shares6, uint256 maxCost6) external nonReentrant onlyOpen {
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
