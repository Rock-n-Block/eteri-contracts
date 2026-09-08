// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

contract Timelock is TimelockController {

    uint256 public constant MIN_MIN_DELAY = 48 hours;
    uint256 public constant MAX_DELAY = 30 days;
    uint256 public constant PROPOSAL_AUTOMATIC_CANCELLATION_DELAY = 14 days;

    error InvalidNewDelay(uint256 minDelay, uint256 maxDelay, uint256 attemptedDelay);
    error MaxDelayExceeded(uint256 maxDelay, uint256 attemptedDelay);

    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin)
    TimelockController(minDelay, proposers, executors, admin) {
        if (minDelay > MAX_DELAY || minDelay < MIN_MIN_DELAY) {
            revert InvalidNewDelay(MIN_MIN_DELAY, MAX_DELAY, minDelay);
        }
    }

    function getTimestamp(bytes32 id) public view override returns (uint256) {
        if (super.getTimestamp(id) != DONE_TIMESTAMP && block.timestamp > super.getTimestamp(id) + PROPOSAL_AUTOMATIC_CANCELLATION_DELAY) {
            return 0;
        }
        return super.getTimestamp(id);
    }

    function schedule(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) public override {
        if (delay > MAX_DELAY) {
            revert MaxDelayExceeded(MAX_DELAY, delay);
        }
        super.schedule(target, value, data, predecessor, salt, delay);
    }

    function scheduleBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata payloads,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) public override {
        if (delay > MAX_DELAY) {
            revert MaxDelayExceeded(MAX_DELAY, delay);
        }
        super.scheduleBatch(targets, values, payloads, predecessor, salt, delay);
    }

    function updateDelay(uint256 newDelay) public override {
        if (newDelay > MAX_DELAY || newDelay < MIN_MIN_DELAY) {
            revert InvalidNewDelay(MIN_MIN_DELAY, MAX_DELAY, newDelay);
        }
        super.updateDelay(newDelay);
    }
}