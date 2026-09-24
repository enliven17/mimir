// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Mimir} from "../Mimir.sol";

/**
 * Tests for the live v2 escrow on Arc. It is immutable, so these pin down what
 * it actually does, including its known flaw, rather than what we wish it did.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
}

contract MimirV2Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    Mimir mimir;

    address oracle = address(0x0417ac1e);
    address creator = address(0xC7ea704);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ONE = 1e18;
    uint256 constant STAKE = 10 * ONE;
    uint256 constant GAP = 1 days;

    function setUp() public {
        vm.warp(1_000_000);
        mimir = new Mimir(oracle);
        vm.deal(creator, 1_000 * ONE);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(bob, 1_000 * ONE);
    }

    function _create(address who, uint256 stake, string memory oddsMode, uint256 payoutBps) internal returns (uint256 id) {
        vm.prank(who);
        id = mimir.createClaim{value: stake}(
            "Will it?", "yes", "no", "https://example.com",
            block.timestamp + GAP, stake, "custom", 0, "binary",
            oddsMode, payoutBps, "", "resolve from the source", 0, false, ""
        );
    }

    function _challenge(address who, uint256 id, uint256 stake) internal returns (bool ok) {
        vm.prank(who);
        (ok,) = address(mimir).call{value: stake}(abi.encodeWithSelector(Mimir.challengeClaim.selector, id, stake, ""));
    }

    function _resolve(uint256 id, uint8 side) internal {
        vm.warp(block.timestamp + GAP + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "because", 90, bytes32(uint256(1)));
    }

    function test_creatorWinsThePot() public {
        uint256 id = _create(creator, STAKE, "pool", 0);
        assert(_challenge(alice, id, STAKE));
        uint256 before = creator.balance;
        _resolve(id, mimir.SIDE_CREATOR());
        assert(creator.balance - before == 2 * STAKE);
        assert(address(mimir).balance == 0);
    }

    function test_poolSplitsTheCreatorStakeProportionally() public {
        uint256 id = _create(creator, 20 * ONE, "pool", 0);
        assert(_challenge(alice, id, 10 * ONE));
        assert(_challenge(bob, id, 30 * ONE));
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        _resolve(id, mimir.SIDE_CHALLENGERS());
        assert(alice.balance - aliceBefore == 15 * ONE);
        assert(bob.balance - bobBefore == 45 * ONE);
        assert(address(mimir).balance == 0);
    }

    function test_fixedOddsReturnsUnusedLiquidity() public {
        uint256 id = _create(creator, STAKE, "fixed", 20_000);
        assert(_challenge(alice, id, 4 * ONE));
        uint256 creatorBefore = creator.balance;
        _resolve(id, mimir.SIDE_CHALLENGERS());
        assert(creator.balance - creatorBefore == 6 * ONE);
    }

    function test_unresolvableRefundsEveryone() public {
        uint256 id = _create(creator, STAKE, "pool", 0);
        assert(_challenge(alice, id, STAKE));
        uint256 creatorBefore = creator.balance;
        uint256 aliceBefore = alice.balance;
        _resolve(id, mimir.SIDE_UNRESOLVABLE());
        assert(creator.balance - creatorBefore == STAKE);
        assert(alice.balance - aliceBefore == STAKE);
    }

    function test_onlyTheOracleResolvesAndOnlyAfterTheDeadline() public {
        uint256 id = _create(creator, STAKE, "pool", 0);
        assert(_challenge(alice, id, STAKE));

        vm.prank(oracle);
        (bool early,) = address(mimir).call(abi.encodeWithSelector(Mimir.resolveClaim.selector, id, uint8(1), "x", uint8(90), bytes32(0)));
        assert(!early);

        vm.warp(block.timestamp + GAP + 1);
        vm.prank(alice);
        (bool stranger,) = address(mimir).call(abi.encodeWithSelector(Mimir.resolveClaim.selector, id, uint8(1), "x", uint8(90), bytes32(0)));
        assert(!stranger);
    }

    function test_challengesCloseBeforeTheDeadline() public {
        uint256 id = _create(creator, STAKE, "pool", 0);
        vm.warp(block.timestamp + GAP - mimir.CHALLENGE_LOCK_SECONDS() + 1);
        assert(!_challenge(alice, id, STAKE));
    }

    /**
     * KNOWN FLAW, pinned so nobody "fixes" the test instead of the caller:
     * v2's createRematch calls `this.createClaim`, so the new claim's creator
     * is the contract itself, not the caller. Its stake can then only ever be
     * paid to the contract, whose receive() reverts, so the payout parks under
     * address(this) where nobody can withdraw it. The app refuses rematches on
     * v2 (assertRematchSupported); anyone calling the contract directly loses
     * their stake. MimirV3 fixes this with an internal call.
     */
    function test_knownFlaw_rematchCreatorIsTheContract() public {
        uint256 parent = _create(creator, STAKE, "pool", 0);

        vm.prank(creator);
        uint256 rematch = mimir.createRematch{value: STAKE}(parent, block.timestamp + GAP, STAKE, "");

        (address rematchCreator,,,,,,,,,,,,,,,,,) = mimir.getClaim(rematch);
        assert(rematchCreator == address(mimir));
        assert(rematchCreator != creator);
    }
}
