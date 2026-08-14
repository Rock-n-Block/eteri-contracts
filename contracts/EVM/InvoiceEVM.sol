// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Invoice, IERC20} from "../base/Invoice.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract InvoiceEVM is Invoice {
    using SafeERC20 for IERC20;

    function _tokenTransfer(IERC20 token, address receiver, uint256 value) internal override {
        token.safeTransfer(receiver, value);
    }
}