// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrestoLmsrMarket} from "./PrestoLmsrMarket.sol";

/// @notice Deploys LMSR markets for a single collateral (USDC or EURC). The owner controls the
/// trading fee and the default proposer/disputer bond, and is the pause guardian for every market
/// it creates. The `MarketCreated` event keeps the same shape as PrestoMarketFactory so the app's
/// on-chain reader parses V2 and V3 markets identically.
contract PrestoLmsrMarketFactory {
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 500;

    address public immutable collateral;
    address public owner;
    address public feeRecipient;
    uint16 public protocolFeeBps;
    uint256 public defaultBond6;
    address[] public markets;

    event MarketCreated(
        address indexed market,
        address indexed creator,
        address indexed resolver,
        uint8 marketKind,
        uint256 closeTime,
        string metadataURI
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeesUpdated(address indexed feeRecipient, uint16 protocolFeeBps);
    event DefaultBondUpdated(uint256 bond6);

    error NotOwner();
    error InvalidFee();
    error ZeroAddress();

    constructor(address collateral_) {
        if (collateral_ == address(0)) revert ZeroAddress();
        collateral = collateral_;
        owner = msg.sender;
        feeRecipient = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Deploy an LMSR market. The creator funds the seed subsidy afterward via `seed()`.
    function createMarket(
        address resolver,
        uint64 closeTime,
        string calldata metadataURI,
        uint8 marketKind,
        uint8 outcomeCount,
        uint256 seed6
    ) external returns (address market) {
        market = address(
            new PrestoLmsrMarket(
                collateral,
                resolver,
                closeTime,
                marketKind,
                metadataURI,
                outcomeCount,
                seed6,
                protocolFeeBps,
                feeRecipient,
                msg.sender,
                defaultBond6,
                owner // pause guardian
            )
        );
        markets.push(market);
        emit MarketCreated(market, msg.sender, resolver, marketKind, closeTime, metadataURI);
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function setFees(address feeRecipient_, uint16 protocolFeeBps_) external onlyOwner {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        if (protocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) revert InvalidFee();
        feeRecipient = feeRecipient_;
        protocolFeeBps = protocolFeeBps_;
        emit FeesUpdated(feeRecipient_, protocolFeeBps_);
    }

    function setDefaultBond(uint256 bond6_) external onlyOwner {
        defaultBond6 = bond6_;
        emit DefaultBondUpdated(bond6_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
