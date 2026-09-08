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
            const [deployer, admin, validator1, validator2, pauser, unpauser, merchant, user1, user2] = await ethers.getSigners();

            const InvoiceImplementation = await ethers.deployContract(invoiceContractName[i]);
            const factory = await ethers.getContractFactory(factoryContractName[i]);
            await expect(upgradesApi.deployProxy(factory, [admin.address, validator1.address, pauser.address, unpauser.address, await InvoiceImplementation.getAddress(), 0])).revertedWithCustomError(factory, "InvalidInput");
            const InvoiceFactory = await upgradesApi.deployProxy(factory, [admin.address, validator1.address, pauser.address, unpauser.address, await InvoiceImplementation.getAddress(), 1]);

            const token = await ethers.deployContract("MockToken");
            await token.mint(user1, ethers.parseEther("1"));
            await token.mint(user2, ethers.parseEther("1"));

            const revertOnReceive = await ethers.deployContract("RevertOnReceive");

            return { deployer, admin, validator1, validator2, pauser, unpauser, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory };
        }

        async function getDeploySignature(orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline, value, signaturesDeadline, invoiceImplementation, InvoiceFactory, signer) {
            return await signer.signMessage(ethers.getBytes(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["(uint256,address,bytes4)", "bytes32", "(uint256,uint256,address)"],[[(await ethers.provider.getNetwork()).chainId, await InvoiceFactory.getAddress(), InvoiceFactory.interface.getFunction("deployAndProcess").selector], ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "address", "address", "uint256", "uint256"], [orderID, merchant, customer, token, paymentDeadline, merchantChoiceDeadline])), [value, signaturesDeadline, invoiceImplementation]]))));
        }

        async function getWithdrawSignature(orderID, nonce, tokenToWithdraw, valueToWithdraw, signaturesDeadline, InvoiceFactory, signer) {
            return await signer.signMessage(ethers.getBytes(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["(uint256,address,bytes4)", "bytes32", "uint256", "address", "uint256", "uint256"],[[(await ethers.provider.getNetwork()).chainId, await InvoiceFactory.getAddress(), InvoiceFactory.interface.getFunction("withdrawFromInvoice").selector], orderID, nonce, tokenToWithdraw, valueToWithdraw, signaturesDeadline]))));
        }

        it("AccessControl", async () => {
            const { deployer, admin, validator1, validator2, pauser, unpauser, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            await expect(InvoiceFactory.connect(validator1).setInvoiceImplementation(ethers.ZeroAddress)).revertedWithCustomError(InvoiceFactory, "AccessControlUnauthorizedAccount").withArgs(validator1, await InvoiceFactory.DEFAULT_ADMIN_ROLE());
            await expect(InvoiceFactory.connect(validator1).setMinSignatures(2)).revertedWithCustomError(InvoiceFactory, "AccessControlUnauthorizedAccount").withArgs(validator1, await InvoiceFactory.DEFAULT_ADMIN_ROLE());
            await expect(InvoiceFactory.connect(admin).pause()).revertedWithCustomError(InvoiceFactory, "AccessControlUnauthorizedAccount").withArgs(admin, await InvoiceFactory.PAUSER_ROLE());
            await expect(InvoiceFactory.connect(admin).unpause()).revertedWithCustomError(InvoiceFactory, "AccessControlUnauthorizedAccount").withArgs(admin, await InvoiceFactory.UNPAUSER_ROLE());
            await InvoiceFactory.connect(admin).setInvoiceImplementation(ethers.ZeroAddress);
            await InvoiceFactory.connect(admin).setMinSignatures(2);
            await InvoiceFactory.connect(pauser).pause();
            await InvoiceFactory.connect(unpauser).unpause();
        });

        it("CREATE2", async function () {
            if (i == 1) {
                this.skip();
            }
            const { deployer, admin, validator1, validator2, pauser, unpauser, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            expect(await InvoiceFactory.getInvoiceAddress(ethers.ZeroHash, merchant, user1, token, 0, 1))
            .equal(ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), 0, 1])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3")));

            let times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            let tx = await InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, ...times, [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), ...times, 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]);

            expect((await tx.wait()).logs[(await tx.wait()).logs.length - 1].args[1]).equal(await InvoiceFactory.getInvoiceAddress(ethers.ZeroHash, merchant, user1, token, ...times));
            let Invoice = await ethers.getContractAt(invoiceContractName[i], await InvoiceFactory.getInvoiceAddress(ethers.ZeroHash, merchant, user1, token, ...times));
            expect(await Invoice.owner()).equal(InvoiceFactory);
        });

        it("Signatures", async () => {
            const { deployer, admin, validator1, validator2, pauser, unpauser, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            let times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 5, await networkHelpers.time.latest() + 10];
            await networkHelpers.time.setNextBlockTimestamp(times[1]);
            await expect(InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, times[0], times[2], [0, times[0], InvoiceImplementation], [
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[0], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "SignaturesDeadlinePassed").withArgs(times[0], times[1]);

            await expect(InvoiceFactory.connect(admin).setMinSignatures(0)).revertedWithCustomError(InvoiceFactory, "InvalidInput");
            await InvoiceFactory.connect(admin).setMinSignatures(2);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 5, await networkHelpers.time.latest() + 10];
            await networkHelpers.time.setNextBlockTimestamp(times[1]);
            await expect(InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, times[0], times[2], [0, times[1], InvoiceImplementation], []))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(2, 0);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 5, await networkHelpers.time.latest() + 10];
            await networkHelpers.time.setNextBlockTimestamp(times[1]);
            await expect(InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, times[0], times[2], [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(2, 1);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 5, await networkHelpers.time.latest() + 10];
            await networkHelpers.time.setNextBlockTimestamp(times[1]);
            await expect(InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, times[0], times[2], [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1),
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(2, 1);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 5, await networkHelpers.time.latest() + 10];
            await networkHelpers.time.setNextBlockTimestamp(times[1]);
            await expect(InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, times[0], times[2], [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1),
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator2)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(2, 1);

            await InvoiceFactory.connect(admin).grantRole(await InvoiceFactory.VALIDATOR_ROLE(), validator2);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 5, await networkHelpers.time.latest() + 10];
            await networkHelpers.time.setNextBlockTimestamp(times[1]);
            await expect(InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, times[0], times[2], [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1),
                await getDeploySignature(ethers.ZeroHash, merchant.address, merchant.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator2)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(2, 1);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 5, await networkHelpers.time.latest() + 10];
            await networkHelpers.time.setNextBlockTimestamp(times[1]);
            await InvoiceFactory.deployAndProcess(ethers.ZeroHash, merchant, user1, token, times[0], times[2], [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1),
                await getDeploySignature(ethers.ZeroHash, merchant.address, user1.address, await token.getAddress(), times[0], times[2], 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator2)
            ]);

            times = [await networkHelpers.time.latest() + 5, await networkHelpers.time.latest() + 10];
            await networkHelpers.time.setNextBlockTimestamp(times[1]);
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.ZeroHash, 0, token, 0, times[0], [
                await getWithdrawSignature(ethers.ZeroHash, 0, await token.getAddress(), 0, times[0], InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "SignaturesDeadlinePassed").withArgs(times[0], times[1]);

            times = await networkHelpers.time.latest() + 5;
            await networkHelpers.time.setNextBlockTimestamp(times);
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.ZeroHash, 0, token, 0, times, []))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(2, 0);

            times = await networkHelpers.time.latest() + 5;
            await networkHelpers.time.setNextBlockTimestamp(times);
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.ZeroHash, 0, token, 0, times, [
                await getWithdrawSignature(ethers.ZeroHash, 0, await token.getAddress(), 0, times, InvoiceFactory, validator1),
                await getWithdrawSignature(ethers.ZeroHash, 0, await token.getAddress(), 0, times, InvoiceFactory, validator1),
                await getWithdrawSignature(ethers.ZeroHash, 0, await token.getAddress(), 0, times, InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(2, 1);

            times = await networkHelpers.time.latest() + 5;
            await networkHelpers.time.setNextBlockTimestamp(times);
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.ZeroHash, 0, token, 0, times, [
                await getWithdrawSignature(ethers.ZeroHash, 0, await token.getAddress(), 0, times, InvoiceFactory, validator1),
                await getWithdrawSignature(ethers.ZeroHash, 0, await token.getAddress(), 0, 0, InvoiceFactory, validator2)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(2, 1);

            times = await networkHelpers.time.latest() + 5;
            await networkHelpers.time.setNextBlockTimestamp(times);
            await InvoiceFactory.withdrawFromInvoice(ethers.ZeroHash, 0, token, 0, times, [
                await getWithdrawSignature(ethers.ZeroHash, 0, await token.getAddress(), 0, times, InvoiceFactory, validator1),
                await getWithdrawSignature(ethers.ZeroHash, 0, await token.getAddress(), 0, times, InvoiceFactory, validator2)
            ]);
        });

        it("Invoice implementation version control", async () => {
            const { deployer, admin, validator1, validator2, pauser, unpauser, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            expect(await InvoiceFactory.currentInvoiceImplementationVersion()).equal(1);
            expect(await InvoiceFactory.invoiceImplementationByVersion(0)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceImplementationByVersion(1)).equal(InvoiceImplementation);
            expect(await InvoiceFactory.invoiceImplementationByVersion(2)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceDeployed(ethers.zeroPadValue(ethers.toBeHex(1), 32))).deep.equal([ethers.ZeroAddress, 0]);
            let times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            let versionOneAddress = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times);
            if (i == 1) {
                versionOneAddress = ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3"));
            }
            expect(await InvoiceFactory.getInvoiceAddressWithVersion(1, ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times)).equal(await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times));
            await InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times, [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]);

            expect(await InvoiceFactory.currentInvoiceImplementationVersion()).equal(1);
            expect(await InvoiceFactory.invoiceImplementationByVersion(0)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceImplementationByVersion(1)).equal(InvoiceImplementation);
            expect(await InvoiceFactory.invoiceImplementationByVersion(2)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceDeployed(ethers.zeroPadValue(ethers.toBeHex(1), 32))).deep.equal([versionOneAddress, 1]);
            let versionOneSecondAddress = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times);
            if (i == 1) {
                versionOneSecondAddress = ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant.address, user1.address, await token.getAddress(), ...times])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3"));
            }

            const InvoiceImplementationV2 = await ethers.deployContract(invoiceContractName[i]);
            await InvoiceFactory.connect(admin).setInvoiceImplementation(InvoiceImplementationV2);

            expect(await InvoiceFactory.currentInvoiceImplementationVersion()).equal(2);
            expect(await InvoiceFactory.invoiceImplementationByVersion(0)).equal(ethers.ZeroAddress);
            expect(await InvoiceFactory.invoiceImplementationByVersion(1)).equal(InvoiceImplementation);
            expect(await InvoiceFactory.invoiceImplementationByVersion(2)).equal(InvoiceImplementationV2);
            expect(await InvoiceFactory.invoiceDeployed(ethers.zeroPadValue(ethers.toBeHex(1), 32))).deep.equal([versionOneAddress, 1]);
            let versionTwoAddress = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times);
            if (i == 1) {
                versionTwoAddress = ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant.address, user1.address, await token.getAddress(), ...times])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementationV2.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3"));
            }
            expect(versionOneSecondAddress).not.equal(versionTwoAddress);
            if (i != 1) {
                expect(await InvoiceFactory.getInvoiceAddressWithVersion(1, ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times)).equal(versionOneSecondAddress);
            }
            expect(await InvoiceFactory.getInvoiceAddressWithVersion(2, ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times)).equal(await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times));

            await InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant, user1, token, ...times, [0, times[1], InvoiceImplementationV2], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), merchant.address, user1.address, await token.getAddress(), ...times, 0, times[1], await InvoiceImplementationV2.getAddress(), InvoiceFactory, validator1)
            ]);

            expect(await InvoiceFactory.invoiceDeployed(ethers.zeroPadValue(ethers.toBeHex(2), 32))).deep.equal([versionTwoAddress, 2]);

            await token.connect(user1).transfer(versionOneAddress, 100);
            await token.connect(user1).transfer(versionTwoAddress, 100);

            times = await networkHelpers.time.latest() + 5;
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, token, 50, times, [
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, await token.getAddress(), 50, times, InvoiceFactory, validator1)
            ]))
            .changeTokenBalances(ethers, token, [versionOneAddress, user1], [-50, 50]);

            times = await networkHelpers.time.latest() + 5;
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(2), 32), 0, token, 50, times, [
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), 0, await token.getAddress(), 50, times, InvoiceFactory, validator1)
            ]))
            .changeTokenBalances(ethers, token, [versionTwoAddress, user1], [-50, 50]);
        });

        it("Main functionality", async () => {
            const { deployer, admin, validator1, validator2, pauser, unpauser, merchant, user1, user2, token, revertOnReceive, InvoiceImplementation, InvoiceFactory } = await networkHelpers.loadFixture(deployFixture);

            let times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            let address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times);
            if (i == 1) {
                address = ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3"));
            }

            await token.connect(user1).transfer(address, 100);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, times[0], times[0], [100, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), times[0], times[0], 100, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidInput");

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times, [100, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, 100, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, admin)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(1, 0);

            await InvoiceFactory.connect(pauser).pause();

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times, [100, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, 100, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, admin)
            ]))
            .revertedWithCustomError(InvoiceFactory, "EnforcedPause");

            await InvoiceFactory.connect(unpauser).unpause();

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times, [100, times[1], ethers.ZeroAddress], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, 100, times[1], ethers.ZeroAddress, InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidInput");

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user1, token, ...times, [100, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user1.address, await token.getAddress(), ...times, 100, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .changeTokenBalances(ethers, token, [address, merchant], [-100, 100]);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant, user2, token, ...times, [100, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), merchant.address, user2.address, await token.getAddress(), ...times, 100, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvoiceDeployed").withArgs(ethers.zeroPadValue(ethers.toBeHex(1), 32));

            await token.connect(user2).transfer(address, 100);

            let Invoice = await ethers.getContractAt(invoiceContractName[i], address);
            await expect(Invoice.connect(admin).withdraw(token, 50)).revertedWithCustomError(Invoice, "OwnableUnauthorizedAccount").withArgs(admin);

            times = await networkHelpers.time.latest() + 50;

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, token, 50, times, [
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, await token.getAddress(), 50, times, InvoiceFactory, admin)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvalidSignaturesCount").withArgs(1, 0);

            expect(await InvoiceFactory.nonceUsed(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0)).equal(false);
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, token, 50, times, [
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, await token.getAddress(), 50, times, InvoiceFactory, validator1)
            ]))
            .changeTokenBalances(ethers, token, [address, user1], [-50, 50]);

            expect(await InvoiceFactory.nonceUsed(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0)).equal(true);
            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, token, 50, times, [
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(1), 32), 0, await token.getAddress(), 50, times, InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "NonceUsed");

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(2), 32), 0, token, 50, times, [
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), 0, await token.getAddress(), 50, times, InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceFactory, "InvoiceNotDeployed").withArgs(ethers.zeroPadValue(ethers.toBeHex(2), 32));

            times = [await networkHelpers.time.latest() + 10, await networkHelpers.time.latest() + 15];
            address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(2), 32), revertOnReceive, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times);
            if (i == 1) {
                address = ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.zeroPadValue(ethers.toBeHex(2), 32), await revertOnReceive.getAddress(), user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3"));
            }

            await user2.sendTransaction({to: address, value: 100});

            await networkHelpers.time.setNextBlockTimestamp(times[0] - 1);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(2), 32), revertOnReceive, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, [50, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), await revertOnReceive.getAddress(), user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, 50, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceImplementation, "PaymentDeadlineNotPassed").withArgs(times[0], times[0] - 1);

            await networkHelpers.time.increaseTo(times[0] + 1);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(2), 32), revertOnReceive, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, [50, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), await revertOnReceive.getAddress(), user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, 50, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceImplementation, "NativeTransferFailed").withArgs(revertOnReceive, revertOnReceive.interface.encodeErrorResult("Reverted", [50]));

            await networkHelpers.time.increaseTo(times[1] + 1);

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(2), 32), revertOnReceive, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, [50, times[1] + 20, InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(2), 32), await revertOnReceive.getAddress(), user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, 50, times[1] + 20, await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .changeEtherBalances(ethers, [address, user1], [-50, 50]);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times);
            if (i == 1) {
                address = ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant.address, user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3"));
            }

            await user2.sendTransaction({to: address, value: 100});

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, [101, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant.address, user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, 101, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceImplementation, "NativeTransferFailed");

            await expect(InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant, user1, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, [100, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(3), 32), merchant.address, user1.address, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", ...times, 100, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]))
            .changeEtherBalances(ethers, [address, merchant], [-100, 100]);

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(4), 32), merchant, revertOnReceive, token, ...times);
            if (i == 1) {
                address = ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.zeroPadValue(ethers.toBeHex(4), 32), merchant.address, await revertOnReceive.getAddress(), await token.getAddress(), ...times])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3"));
            }

            await user2.sendTransaction({to: address, value: 100});

            await InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(4), 32), merchant, revertOnReceive, token, ...times, [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(4), 32), merchant.address, await revertOnReceive.getAddress(), await token.getAddress(), ...times, 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]);

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(4), 32), 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 50, times[1], [
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(4), 32), 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 50, times[1], InvoiceFactory, validator1)
            ]))
            .revertedWithCustomError(InvoiceImplementation, "NativeTransferFailed").withArgs(revertOnReceive, revertOnReceive.interface.encodeErrorResult("Reverted", [50]));

            times = [await networkHelpers.time.latest() - 10, await networkHelpers.time.latest() + 10];
            address = await InvoiceFactory.getInvoiceAddress(ethers.zeroPadValue(ethers.toBeHex(5), 32), merchant, user1, token, ...times);
            if (i == 1) {
                address = ethers.getCreate2Address(await InvoiceFactory.getAddress(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "address", "address", "address", "uint256", "uint256"],
                [ethers.zeroPadValue(ethers.toBeHex(5), 32), merchant.address, user1.address, await token.getAddress(), ...times])),
                ethers.keccak256("0x3d602d80600a3d3981f3363d3d373d3d3d363d73" + (await InvoiceImplementation.getAddress()).slice(2) + "5af43d82803e903d91602b57fd5bf3"));
            }

            await user2.sendTransaction({to: address, value: 100});

            await InvoiceFactory.deployAndProcess(ethers.zeroPadValue(ethers.toBeHex(5), 32), merchant, user1, token, ...times, [0, times[1], InvoiceImplementation], [
                await getDeploySignature(ethers.zeroPadValue(ethers.toBeHex(5), 32), merchant.address, user1.address, await token.getAddress(), ...times, 0, times[1], await InvoiceImplementation.getAddress(), InvoiceFactory, validator1)
            ]);

            await expect(InvoiceFactory.withdrawFromInvoice(ethers.zeroPadValue(ethers.toBeHex(5), 32), 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 50, times[1], [
                await getWithdrawSignature(ethers.zeroPadValue(ethers.toBeHex(5), 32), 0, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 50, times[1], InvoiceFactory, validator1)
            ]))
            .changeEtherBalances(ethers, [address, user1], [-50, 50]);
        });
    });
}