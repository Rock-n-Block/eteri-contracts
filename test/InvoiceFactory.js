import { expect } from "chai";
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

const network = hre.network;
const connection = await network.create();
const { ethers, networkHelpers } = connection;

const upgradesApi = await upgrades(hre, connection);

const factoryContractName = ["InvoiceFactoryEVM", "InvoiceFactoryTron"];
const invoiceContractName = ["InvoiceEVM", "InvoiceTron"];

for (let i = 0; i < factoryContractName.length; i++) {
    describe(factoryContractName[i], () => {
        async function deployFixture() {
            const [deployer, admin, validator, merchant, user1, user2] = await ethers.getSigners();

            const InvoiceImplementation = await ethers.deployContract(invoiceContractName[i]);
            const factory = await ethers.getContractFactory(factoryContractName[i]);
            const InvoiceFactory = await upgradesApi.deployProxy(factory, [admin.address, validator.address, await InvoiceImplementation.getAddress()]);

            const token = await ethers.deployContract("MockToken");
            await token.mint(user1, ethers.parseEther("1"));
            await token.mint(user2, ethers.parseEther("1"));

            const revertOnReceive = await ethers.deployContract("RevertOnReceive");

            return { deployer, admin, validator, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory };
        }

        async function getDeploySignature(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline, InvoiceFactory, signer) {
            return await signer.signMessage(ethers.getBytes(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address", "bytes4", "bytes32"],[(await ethers.provider.getNetwork()).chainId, await InvoiceFactory.getAddress(), InvoiceFactory.interface.getFunction("deployAndProcess").selector, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "address", "address", "uint256", "uint256"], [orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline]))]))));
        }

        async function getWithdrawSignature(orderID, nonce, tokenToWithdraw, valueToWithdraw, InvoiceFactory, signer) {
            return await signer.signMessage(ethers.getBytes(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address", "bytes4", "bytes32", "uint256", "address", "uint256"],[(await ethers.provider.getNetwork()).chainId, await InvoiceFactory.getAddress(), InvoiceFactory.interface.getFunction("withdrawFromInvoice").selector, orderID, nonce, tokenToWithdraw, valueToWithdraw]))));
        }

        it("AccessControl", async () => {
            const { deployer, admin, validator, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            await expect(InvoiceFactory.connect(validator).setInvoiceImplementation(ethers.ZeroAddress)).revertedWithCustomError(InvoiceFactory, "AccessControlUnauthorizedAccount").withArgs(validator, await InvoiceFactory.DEFAULT_ADMIN_ROLE());
            await expect(InvoiceFactory.connect(validator).pause()).revertedWithCustomError(InvoiceFactory, "AccessControlUnauthorizedAccount").withArgs(validator, await InvoiceFactory.DEFAULT_ADMIN_ROLE());
            await expect(InvoiceFactory.connect(validator).unpause()).revertedWithCustomError(InvoiceFactory, "AccessControlUnauthorizedAccount").withArgs(validator, await InvoiceFactory.DEFAULT_ADMIN_ROLE());
            await InvoiceFactory.connect(admin).setInvoiceImplementation(ethers.ZeroAddress);
            await InvoiceFactory.connect(admin).pause();
            await InvoiceFactory.connect(admin).unpause();
        });

        it("CREATE2 and signature", async () => {
            const { deployer, admin, validator, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            expect(await InvoiceFactory.getInvoiceAddress(ethers.ZeroHash, merchant, user1, token, 0, 1))
            .equal(ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), 0, 1])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3")));

            let hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "address", "address", "uint256", "uint256"], [ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), 0, 1]));
            let selector = InvoiceFactory.interface.getFunction("deployAndProcess").selector;

            hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address", "bytes4", "bytes32"],[(await ethers.provider.getNetwork()).chainId, await InvoiceFactory.getAddress(), selector, hash]));
            let signature = await validator.signMessage(ethers.getBytes(hash));

            await expect(InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, 0, 2, signature)).revertedWithCustomError(InvoiceFactory, "InvalidSignature");

            let tx = await InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, 0, 1, signature);

            expect((await tx.wait()).logs[(await tx.wait()).logs.length - 1].args[1]).equal(await InvoiceFactory.getInvoiceAddress(ethers.ZeroHash, merchant, user1, token, 0, 1));
            let Invoice = await ethers.getContractAt(invoiceContractName[i], await InvoiceFactory.getInvoiceAddress(ethers.ZeroHash, merchant, user1, token, 0, 1));
            expect(await Invoice.owner()).equal(InvoiceFactory);
        });

        it("Invoice implementation version control", async () => {
            const { deployer, admin, validator, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            expect(await InvoiceFactory.currentInvoiceImplementationVersion()).equal(1);
            expect(await InvoiceFactory.invoiceImplementationByVersion(0)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceImplementationByVersion(1)).equal(InvoiceImplementation);
            expect(await InvoiceFactory.invoiceImplementationByVersion(2)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceDeployed(ethers.zeroPadValue(ethers.toBeHex(1), 32))).deep.equal([ethers.ZeroAddress, 0]);
            let times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            let versionOneAddress = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times);
            expect(await InvoiceFactory.getInvoiceAddressWithVersion(1, ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times)).equal(versionOneAddress);

            await InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, InvoiceFactory, validator));

            expect(await InvoiceFactory.currentInvoiceImplementationVersion()).equal(1);
            expect(await InvoiceFactory.invoiceImplementationByVersion(0)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceImplementationByVersion(1)).equal(InvoiceImplementation);
            expect(await InvoiceFactory.invoiceImplementationByVersion(2)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceDeployed(ethers.zeroPadValue(ethers.toBeHex(1), 32))).deep.equal([versionOneAddress, 1]);
            let versionOneSecondAddress = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times);

            const InvoiceImplementationV2 = await ethers.deployContract(invoiceContractName[i]);
            await InvoiceFactory.connect(admin).setInvoiceImplementation(InvoiceImplementationV2);

            expect(await InvoiceFactory.currentInvoiceImplementationVersion()).equal(2);
            expect(await InvoiceFactory.invoiceImplementationByVersion(0)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceImplementationByVersion(1)).equal(InvoiceImplementation);
            expect(await InvoiceFactory.invoiceImplementationByVersion(2)).equal(InvoiceImplementationV2);
            expect(await InvoiceFactory.invoiceDeployed(ethers.zeroPadValue(ethers.toBeHex(1), 32))).deep.equal([versionOneAddress, 1]);
            let versionTwoAddress = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times);
            expect(versionOneSecondAddress).not.equal(versionTwoAddress);
            expect(await InvoiceFactory.getInvoiceAddressWithVersion(1, ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times)).equal(versionOneSecondAddress);
            expect(await InvoiceFactory.getInvoiceAddressWithVersion(2, ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times)).equal(versionTwoAddress);

            await InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant.address, user1.address, await token.getAddress(), ...times, InvoiceFactory, validator));

            expect(await InvoiceFactory.invoiceDeployed(ethers.zeroPadValue(ethers.toBeHex(2), 32))).deep.equal([versionTwoAddress, 2]);

            await token.connect(user1).transfer(versionOneAddress, 100);
            await token.connect(user1).transfer(versionTwoAddress, 100);

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, token, 50,
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, await token.getAddress(), 50, InvoiceFactory, validator)))
            .changeTokenBalances(ethers, token, [versionOneAddress, user1], [-50, 50]);

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(2), 32), 0, token, 50,
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), 0, await token.getAddress(), 50, InvoiceFactory, validator)))
            .changeTokenBalances(ethers, token, [versionTwoAddress, user1], [-50, 50]);
        });

        it("Main functionality", async () => {
            const { deployer, admin, validator, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            let times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            let address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times);

            await token.connect(user1).transfer(address, 100);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, times[0], times[0],
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), times[0], times[0], InvoiceFactory, validator)))
            .revertedWithCustomError(InvoiceFactory, "InvalidInput");

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, InvoiceFactory, admin)))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignature");

            await InvoiceFactory.connect(admin).pause();

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, InvoiceFactory, admin)))
            .revertedWithCustomError(InvoiceFactory, "EnforcedPause");

            await InvoiceFactory.connect(admin).unpause();

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, InvoiceFactory, validator)))
            .changeTokenBalances(ethers, token, [address, merchant], [-100, 100]);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user2, token, ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user2.address, await token.getAddress(), ...times, InvoiceFactory, validator)))
            .revertedWithCustomError(InvoiceFactory, "InvoiceDeployed").withArgs(ethers.zeroPadValue(ethers.toBeHex(1), 32));

            await token.connect(user2).transfer(address, 100);

            let Invoice = await ethers.getContractAt(invoiceContractName[i], address);
            await expect(Invoice.connect(admin).withdraw(token, 50)).revertedWithCustomError(Invoice, "OwnableUnauthorizedAccount").withArgs(admin);

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, token, 50,
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, await token.getAddress(), 50, InvoiceFactory, admin)))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignature");

            expect(await InvoiceFactory.nonceUsed(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0)).equal(false);
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, token, 50,
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, await token.getAddress(), 50, InvoiceFactory, validator)))
            .changeTokenBalances(ethers, token, [address, user1], [-50, 50]);

            expect(await InvoiceFactory.nonceUsed(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0)).equal(true);
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, token, 50,
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, await token.getAddress(), 50, InvoiceFactory, validator)))
            .revertedWithCustomError(InvoiceFactory, "NonceUsed");

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(2), 32), 0, token, 50,
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), 0, await token.getAddress(), 50, InvoiceFactory, validator)))
            .revertedWithCustomError(InvoiceFactory, "InvoiceNotDeployed").withArgs(ethers.zeroPadValue(ethers.toBeHex(2), 32));

            times = [await networkHelpers.time.latest() + 10, await networkHelpers.time.latest() + 15];
            address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(2), 32), revertOnReceive, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times);

            await user2.sendTransaction({to: address, value: 100});

            await networkHelpers.time.setNextBlockTimestamp(times[0] - 1);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(2), 32), revertOnReceive, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), await revertOnReceive.getAddress(), user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, InvoiceFactory, validator)))
            .revertedWithCustomError(InvoiceImplementation, "PaymentDeadlineNotPassed").withArgs(times[0], times[0] - 1);

            await networkHelpers.time.increaseTo(times[0] + 1);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(2), 32), revertOnReceive, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), await revertOnReceive.getAddress(), user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, InvoiceFactory, validator)))
            .revertedWithCustomError(InvoiceImplementation, "NativeTransferFailed").withArgs(revertOnReceive, revertOnReceive.interface.encodeErrorResult("Reverted", [100]));

            await networkHelpers.time.increaseTo(times[1] + 1);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(2), 32), revertOnReceive, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), await revertOnReceive.getAddress(), user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, InvoiceFactory, validator)))
            .changeEtherBalances(ethers, [address, user1], [-100, 100]);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times);

            await user2.sendTransaction({to: address, value: 100});

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant.address, user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, InvoiceFactory, validator)))
            .changeEtherBalances(ethers, [address, merchant], [-100, 100]);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(4), 32), merchant, revertOnReceive, token, ...times);

            await user2.sendTransaction({to: address, value: 100});

            await InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(4), 32), merchant, revertOnReceive, token, ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(4), 32), merchant.address, await revertOnReceive.getAddress(), await token.getAddress(), ...times, InvoiceFactory, validator));

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(4), 32), 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 50,
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(4), 32), 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 50, InvoiceFactory, validator)))
            .revertedWithCustomError(InvoiceImplementation, "NativeTransferFailed").withArgs(revertOnReceive, revertOnReceive.interface.encodeErrorResult("Reverted", [50]));

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(5), 32), merchant, user1, token, ...times);

            await user2.sendTransaction({to: address, value: 100});

            await InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(5), 32), merchant, user1, token, ...times,
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(5), 32), merchant.address, user1.address, await token.getAddress(), ...times, InvoiceFactory, validator));

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(5), 32), 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 50,
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(5), 32), 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 50, InvoiceFactory, validator)))
            .changeEtherBalances(ethers, [address, user1], [-50, 50]);
        });
    });
}