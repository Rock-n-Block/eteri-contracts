// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20Burnable, ERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract MockToken is ERC20Burnable {

    constructor() ERC20("","") {}

    function mint(address account, uint256 value) external {
        _mint(account, value);
    }
}