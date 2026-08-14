// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RevertOnReceive {

    error Reverted(uint256 value);

    receive() external payable {
        revert Reverted(msg.value);
    }
}