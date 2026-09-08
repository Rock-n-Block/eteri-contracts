// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InvoiceFactory} from "../base/InvoiceFactory.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract InvoiceFactoryEVM is InvoiceFactory {

    function getInvoiceAddress(bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view override returns(address) {
        return Clones.predictDeterministicAddress(invoiceImplementationByVersion[currentInvoiceImplementationVersion], _getSalt(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));
    }

    function getInvoiceAddressWithVersion(uint256 version, bytes32 orderID, address merchant, address customer, address token, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external view override returns(address) {
        return Clones.predictDeterministicAddress(invoiceImplementationByVersion[version], _getSalt(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline));
    }

    function _cloneDeterministic(address implementation, bytes32 salt) internal override returns(address) {
        return Clones.cloneDeterministic(implementation, salt);
    }
}