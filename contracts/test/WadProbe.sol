// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {wadExp, wadLn, wadMul, wadDiv} from "solmate/src/utils/SignedWadMath.sol";

/// @notice Probe to confirm solmate WAD math compiles and runs under the project's Hardhat config.
contract WadProbe {
    function lnOfExp(int256 xWad) external pure returns (int256) {
        return wadLn(wadExp(xWad)); // should return ~xWad
    }

    function product(int256 aWad, int256 bWad) external pure returns (int256) {
        return wadMul(aWad, bWad);
    }

    function quotient(int256 aWad, int256 bWad) external pure returns (int256) {
        return wadDiv(aWad, bWad);
    }
}
