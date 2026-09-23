// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3} from "../MimirV3.sol";

/**
 * Tests for the fee-bearing escrow.
 *
 * Deliberately dependency-free: only the cheatcodes actually needed are
 * declared, so the suite runs without vendoring forge-std into the repo. The
 * assertions are the ones that decide whether the money is safe, not a
 * line-coverage exercise.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
}

/** A recipient whose receive() reverts, to prove one bad address cannot freeze a settlement. */
contract RejectsPayment {
    receive() external payable {
        revert("no thanks");
    }

    function challenge(MimirV3 m, uint256 id, uint256 stake) external payable {
        m.challengeClaim{value: stake}(id, stake, "", address(0));
    }

    function pull(MimirV3 m) external {
        m.withdraw();
    }
}

contract MimirV3Test {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;

    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address agentOwner = address(0xA6E7);
    address creator = address(0xC7ea704);
    address challenger = address(0xC4a11e);

    uint256 constant ONE = 1e18;
    uint256 constant STAKE = 10 * ONE;
    uint256 constant DEADLINE_GAP = 1 days;

    function setUp() public {
        vm.warp(1_000_000);
        mimir = new MimirV3(oracle, 50, 50, platform, address(0));
        vm.deal(creator, 1_000 * ONE);
        vm.deal(challenger, 1_000 * ONE);
        vm.deal(address(this), 1_000 * ONE);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _create(address who, uint256 stake, address agent) internal returns (uint256 id) {
        vm.prank(who);
        id = mimir.createClaim{value: stake}(
            "Will it?",
            "yes",
            "no",
            "https://example.com",
            block.timestamp + DEADLINE_GAP,
            stake,
            "custom",
            0,
            "binary",
            "pool",
            0,
            "",
            "resolve from the source",
            0,
            false,
            "",
            agent
        );
    }

    function _challenge(address who, uint256 id, uint256 stake, address agent) internal {
        vm.prank(who);
        mimir.challengeClaim{value: stake}(id, stake, "", agent);
    }

    function _settle(uint256 id, uint8 side) internal {
        vm.warp(block.timestamp + DEADLINE_GAP + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "because", 90, bytes32(uint256(1)));
    }

    // ── Fees are charged on profit, never on principal ──────────────────────

    function test_feeIsChargedOnProfitOnly() public {
        uint256 id = _create(creator, STAKE, agentOwner);
        _challenge(challenger, id, STAKE, address(0));

        uint256 before = creator.balance;
        _settle(id, mimir.SIDE_CREATOR());

        // Gross 20, principal 10, profit 10. Platform 50bps + agent owner 50bps of 10.
        uint256 profit = 10 * ONE;
        uint256 expectedFees = (profit * 50) / 10_000 + (profit * 50) / 10_000;
        assert(creator.balance - before == 20 * ONE - expectedFees);
        assert(mimir.accruedFees(platform) == (profit * 50) / 10_000);
        assert(mimir.accruedFees(agentOwner) == (profit * 50) / 10_000);
    }

    function test_winnerNeverReceivesLessThanPrincipal() public {
        uint256 id = _create(creator, STAKE, agentOwner);
        _challenge(challenger, id, 2 * ONE, address(0));

        uint256 before = creator.balance;
        _settle(id, mimir.SIDE_CREATOR());

        assert(creator.balance - before >= STAKE);
    }

    function test_refundsAreFree() public {
        uint256 id = _create(creator, STAKE, agentOwner);
        _challenge(challenger, id, STAKE, agentOwner);

        uint256 creatorBefore = creator.balance;
        uint256 challengerBefore = challenger.balance;
        _settle(id, mimir.SIDE_DRAW());

        assert(creator.balance - creatorBefore == STAKE);
        assert(challenger.balance - challengerBefore == STAKE);
        assert(mimir.lifetimeFeesAccrued() == 0);
    }

    function test_unresolvableRefundsInFull() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));

        uint256 challengerBefore = challenger.balance;
        _settle(id, mimir.SIDE_UNRESOLVABLE());

        assert(challenger.balance - challengerBefore == STAKE);
        assert(mimir.lifetimeFeesAccrued() == 0);
    }

    function test_noAgentAttributionMeansNoAgentLeg() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));
        _settle(id, mimir.SIDE_CREATOR());

        assert(mimir.accruedFees(agentOwner) == 0);
        assert(mimir.accruedFees(platform) > 0);
    }

    function test_nobodyPaysThemselves() public {
        // The winner is also the attributed agent owner: that leg is waived.
        uint256 id = _create(creator, STAKE, creator);
        _challenge(challenger, id, STAKE, address(0));
        _settle(id, mimir.SIDE_CREATOR());

        assert(mimir.accruedFees(creator) == 0);
    }

    function test_challengerAttributionIsPerPosition() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, agentOwner);
        _settle(id, mimir.SIDE_CHALLENGERS());

        // The challenger won through an agent, so the agent owner earns.
        assert(mimir.accruedFees(agentOwner) > 0);
    }

    function test_feesAreConserved() public {
        uint256 id = _create(creator, STAKE, agentOwner);
        _challenge(challenger, id, STAKE, address(0));
        _settle(id, mimir.SIDE_CREATOR());

        // Everything not paid out is exactly the fees still owed.
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued());
    }

    // ── Pull payments ───────────────────────────────────────────────────────

    function test_feesArePulledNotPushed() public {
        uint256 id = _create(creator, STAKE, agentOwner);
        _challenge(challenger, id, STAKE, address(0));
        _settle(id, mimir.SIDE_CREATOR());

        uint256 owed = mimir.accruedFees(platform);
        assert(owed > 0);

        uint256 before = platform.balance;
        vm.prank(platform);
        mimir.claimFees();
        assert(platform.balance - before == owed);
        assert(mimir.accruedFees(platform) == 0);
        assert(mimir.lifetimeFeesClaimed() == owed);
    }

    function test_aRejectingWinnerCannotFreezeSettlement() public {
        RejectsPayment bad = new RejectsPayment();
        vm.deal(address(bad), 100 * ONE);

        uint256 id = _create(creator, STAKE, address(0));
        bad.challenge{value: STAKE}(mimir, id, STAKE);

        // Settlement must not revert even though the push to `bad` fails.
        _settle(id, mimir.SIDE_CHALLENGERS());

        // The payout was parked instead of reverting the whole settlement. Fees
        // are still charged on the profit, so what is parked is the net.
        uint256 profit = 10 * ONE;
        uint256 parked = mimir.pendingWithdrawals(address(bad));
        assert(parked == 20 * ONE - (profit * 50) / 10_000);

        // The settlement itself completed regardless.
        (,,,,,,,,, uint8 state,,,,,,,,) = mimir.getClaim(id);
        assert(state == mimir.ST_RESOLVED());

        // A failed pull is atomic: the recipient still rejects payment, so
        // withdraw() reverts and the balance stays on the books rather than
        // being zeroed on the way out.
        vm.prank(address(bad));
        (bool pulled,) = address(mimir).call(abi.encodeWithSignature("withdraw()"));
        assert(!pulled);
        assert(mimir.pendingWithdrawals(address(bad)) == parked);
    }

    // ── Fee governance ──────────────────────────────────────────────────────

    function test_feePolicyIsTimelocked() public {
        mimir.queueFeePolicy(100, 100, platform);

        (bool early,) = address(mimir).call(abi.encodeWithSignature("executeFeePolicy()"));
        assert(!early);

        vm.warp(block.timestamp + 2 days);
        (bool late,) = address(mimir).call(abi.encodeWithSignature("executeFeePolicy()"));
        assert(late);

        (uint16 platformBps,,) = mimir.feePolicy();
        assert(platformBps == 100);
    }

    function test_aQueuedPolicyCanBeCancelled() public {
        mimir.queueFeePolicy(100, 100, platform);
        mimir.cancelFeePolicy();
        vm.warp(block.timestamp + 3 days);

        (bool ok,) = address(mimir).call(abi.encodeWithSignature("executeFeePolicy()"));
        assert(!ok);
    }

    function test_theFeeCapCannotBeExceeded() public {
        (bool ok,) = address(mimir).call(
            abi.encodeWithSignature("queueFeePolicy(uint16,uint16,address)", 900, 200, platform)
        );
        assert(!ok);
    }

    function test_openMarketsKeepTheTermsTheyWereCreatedUnder() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));

        // The policy changes after the market is funded.
        mimir.queueFeePolicy(1000, 0, platform);
        vm.warp(block.timestamp + 2 days);
        mimir.executeFeePolicy();

        (uint16 snapshotBps,,,) = mimir.getClaimFees(id);
        assert(snapshotBps == 50);

        uint256 before = creator.balance;
        _settle(id, mimir.SIDE_CREATOR());

        // Settled on the original 50 bps, not the new 1000 bps.
        uint256 profit = 10 * ONE;
        assert(creator.balance - before == 20 * ONE - (profit * 50) / 10_000);
    }

    // ── The invariant, fuzzed ───────────────────────────────────────────────

    /**
     * Across any stake sizes and any policy the cap allows, a winner must never
     * receive less than they staked, and the escrow must never pay out more
     * than it took in.
     *
     * Inputs are folded into range by hand rather than with forge-std's bound,
     * which keeps the suite dependency-free.
     */
    function testFuzz_winnerNeverLosesPrincipal(
        uint96 rawCreatorStake,
        uint96 rawChallengerStake,
        uint16 rawPlatformBps,
        uint16 rawAgentBps
    ) public {
        uint256 creatorStake = 2 * ONE + (uint256(rawCreatorStake) % (500 * ONE));
        uint256 challengerStake = 2 * ONE + (uint256(rawChallengerStake) % (500 * ONE));
        uint16 platformBps = uint16(rawPlatformBps % 501); // 0-500
        uint16 agentBps = uint16(rawAgentBps % 501); // together at most 1000

        MimirV3 m = new MimirV3(oracle, platformBps, agentBps, platform, address(0));
        vm.deal(creator, creatorStake);
        vm.deal(challenger, challengerStake);

        vm.prank(creator);
        uint256 id = m.createClaim{value: creatorStake}(
            "Will it?",
            "yes",
            "no",
            "https://example.com",
            block.timestamp + DEADLINE_GAP,
            creatorStake,
            "custom",
            0,
            "binary",
            "pool",
            0,
            "",
            "rule",
            0,
            false,
            "",
            agentOwner
        );
        vm.prank(challenger);
        m.challengeClaim{value: challengerStake}(id, challengerStake, "", address(0));

        uint256 escrow = creatorStake + challengerStake;
        uint256 before = creator.balance;
        // Read before the prank: an external call in the argument list would
        // consume it, and the resolve would arrive from the test contract.
        uint8 creatorSide = m.SIDE_CREATOR();

        vm.warp(block.timestamp + DEADLINE_GAP + 1);
        vm.prank(oracle);
        m.resolveClaim(id, creatorSide, "because", 90, bytes32(uint256(1)));

        uint256 received = creator.balance - before;

        // Being right never costs money.
        assert(received >= creatorStake);
        // Nothing is created: what was paid out plus what is owed in fees is
        // never more than what came in.
        assert(received + m.lifetimeFeesAccrued() <= escrow);
        // Whatever the escrow still holds is exactly what it owes.
        assert(address(m).balance == m.lifetimeFeesAccrued());
    }

    // ── Authorization ───────────────────────────────────────────────────────

    function test_onlyTheOracleSettles() public {
        uint256 id = _create(creator, STAKE, address(0));
        _challenge(challenger, id, STAKE, address(0));
        vm.warp(block.timestamp + DEADLINE_GAP + 1);

        (bool ok,) = address(mimir).call(
            abi.encodeWithSignature(
                "resolveClaim(uint256,uint8,string,uint8,bytes32)", id, uint8(1), "x", uint8(90), bytes32(0)
            )
        );
        assert(!ok);
    }

    receive() external payable {}
}
