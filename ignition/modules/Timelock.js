import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

let {TIMELOCK_MIN_DELAY, TIMELOCK_PROPOSERS, TIMELOCK_EXECUTORS, TIMELOCK_ADMIN} = process.env;

export default buildModule("Timelock", (m) => {

    TIMELOCK_PROPOSERS = TIMELOCK_PROPOSERS.replace(/,/g, "").replace(/"/g, "").replace(/'/g, "").replace(/\[/g, "").replace(/\]/g, "").split(" ");
    TIMELOCK_EXECUTORS = TIMELOCK_EXECUTORS.replace(/,/g, "").replace(/"/g, "").replace(/'/g, "").replace(/\[/g, "").replace(/\]/g, "").split(" ");

    const Timelock = m.contract("Timelock", [TIMELOCK_MIN_DELAY, TIMELOCK_PROPOSERS, TIMELOCK_EXECUTORS, TIMELOCK_ADMIN]);

    return { Timelock };
});
