// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Invoice is OwnableUpgradeable {

    address public constant MOCK_NATIVE_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    address public customer;

    event Accept(IERC20 token, uint256 value);
    event Refund(IERC20 token, uint256 value);
    event Withdraw(IERC20 indexed token, uint256 value);

    error PaymentDeadlineNotPassed(uint256 paymentDeadline, uint256 currentTimestamp);
    error NativeTransferFailed(address receiver, bytes returnData);

    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the cloned instance, checks deadlines, and auto-settles or refunds if boundaries are met.
     * @dev Automatically distributes funds if called after either deadline. Reverts if called before the `paymentDeadline`.
     * @param merchant The recipient address of the funds if the payment is accepted.
     * @param _customer The customer address who will receive refunds or assets withdrawn later.
     * @param token The token address used for payment.
     * @param value Token amount to be withdrawn during settlement.
     * @param paymentDeadline The unix timestamp after which the merchant is allowed to accept funds.
     * @param merchantChoiceDeadline The unix timestamp after which the customer is refunded.
     * @return A boolean indicating whether the invoice was settled and accepted (`true`) or refunded (`false`).
     */
    function initialize(address merchant, address _customer, IERC20 token, uint256 value, uint256 paymentDeadline, uint256 merchantChoiceDeadline) external virtual initializer returns(bool) {
        __Ownable_init(_msgSender());
        customer = _customer;
        if (block.timestamp > merchantChoiceDeadline) {
            _transfer(token, customer, value);
            emit Refund(token, value);
            return false;
        }
        else if (block.timestamp > paymentDeadline) {
            _transfer(token, merchant, value);
            emit Accept(token, value);
            return true;
        }
        else {
            revert PaymentDeadlineNotPassed(paymentDeadline, block.timestamp);
        }
    }

    /**
     * @notice Safely withdraws specified token out of this Invoice clone instance to customer address.
     * @dev Restricted to the factory contract (`onlyOwner`).
     * @param token The token address to withdraw.
     * @param value The exact amount to withdraw.
     */
    function withdraw(IERC20 token, uint256 value) external virtual onlyOwner {
        _transfer(token, customer, value);
        emit Withdraw(token, value);
    }

    function _transfer(IERC20 token, address receiver, uint256 value) internal virtual {
        if (address(token) == MOCK_NATIVE_ADDRESS) {
            _nativeTransfer(receiver, value);
        }
        else {
            _tokenTransfer(token, receiver, value);
        }
    }

    function _nativeTransfer(address receiver, uint256 value) internal virtual {
        (bool success, bytes memory returnData) = receiver.call{value: value}("");
        if (!success) {
            revert NativeTransferFailed(receiver, returnData);
        }
    }

    function _tokenTransfer(IERC20 token, address receiver, uint256 value) internal virtual {
        token.transfer(receiver, value);
    }
}