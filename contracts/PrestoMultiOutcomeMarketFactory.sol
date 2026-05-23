// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrestoMultiOutcomeMarket} from "./PrestoMultiOutcomeMarket.sol";

contract PrestoMultiOutcomeMarketFactory {
    uint16 public constant MAX_PROTOCOL_FEE_BPS = 500;

    address public immutable collateral;
    address public owner;
    address public feeRecipient;
    uint16 public protocolFeeBps;
    address[] public markets;

    event MarketCreated(
        address indexed market,
        address indexed creator,
        address indexed resolver,
        PrestoMultiOutcomeMarket.MarketKind marketKind,
        uint256 closeTime,
        string metadataURI,
        uint8 outcomeCount
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeesUpdated(address indexed feeRecipient, uint16 protocolFeeBps);

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

    function createMarket(
        address resolver,
        uint256 closeTime,
        string calldata metadataURI,
        PrestoMultiOutcomeMarket.MarketKind marketKind,
        uint8 outcomeCount
    ) external returns (address market) {
        market = address(
            new PrestoMultiOutcomeMarket(
                collateral,
                msg.sender,
                resolver,
                feeRecipient,
                protocolFeeBps,
                marketKind,
                closeTime,
                metadataURI,
                outcomeCount
            )
        );
        markets.push(market);
        emit MarketCreated(market, msg.sender, resolver, marketKind, closeTime, metadataURI, outcomeCount);
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

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
