// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IInvoice {

    function initialize(address merchant, address _customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external returns(bool);

    function withdraw(address token, uint256 value) external;
}