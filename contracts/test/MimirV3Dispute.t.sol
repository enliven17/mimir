// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3} from "../MimirV3.sol";

/**
 * Optimistic resolution with a dispute window, and one-signature staking via
 * EIP-2612 permit + multicall.
 */
interface Vm {
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

/// 6-decimal token with a real EIP-2612 permit.
contract PermitUSDC {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    constructor() {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("USDC"), keccak256("2"), block.chainid, address(this)
        ));
    }

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(block.timestamp <= deadline, "expired");
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR,
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))));
        require(ecrecover(digest, v, r, s) == owner, "bad sig");
        allowance[owner][spender] = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MimirV3DisputeTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address creator = address(0xC7ea704);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ONE = 1e18;
    uint256 constant STAKE = 10 * ONE;
    uint256 constant GAP = 1 days;
    uint256 constant WINDOW = 1 days;

    function setUp() public {
        vm.warp(1_000_000);
        mimir = new MimirV3(oracle, 50, 0, platform, address(0), WINDOW);
        vm.deal(creator, 1_000 * ONE);
        vm.deal(alice, 1_000 * ONE);
        vm.deal(bob, 1_000 * ONE);
    }

    function _claim() internal returns (uint256 id) {
        vm.prank(creator);
        id = mimir.createClaim{value: STAKE}(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, STAKE,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );
        vm.prank(alice);
        mimir.challengeClaim{value: STAKE}(id, STAKE, "", address(0));
    }

    function _propose(uint256 id, uint8 side) internal {
        vm.warp(block.timestamp + GAP + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "proposed", 90, bytes32(uint256(7)));
    }

    function _state(uint256 id) internal view returns (uint8 state) {
        (,,,,,,,,, state,,,,,,,,) = mimir.getClaim(id);
    }

    function test_aProposalPaysNothingUntilTheWindowCloses() public {
        uint256 id = _claim();
        uint256 before = creator.balance;
        _propose(id, mimir.SIDE_CREATOR());
        assert(_state(id) == mimir.ST_PROPOSED());
        assert(creator.balance == before);

        (bool early,) = address(mimir).call(abi.encodeWithSelector(MimirV3.finalizeResolution.selector, id));
        assert(!early);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(bob); // anyone may finalize
        mimir.finalizeResolution(id);
        assert(_state(id) == mimir.ST_RESOLVED());
        assert(creator.balance > before);
    }

    function test_onlyParticipantsDisputeAndOnlyInTime() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());

        uint256 bond = mimir.MIN_STAKE();
        vm.prank(bob);
        (bool stranger,) = address(mimir).call{value: bond}(abi.encodeWithSelector(MimirV3.disputeResolution.selector, id));
        assert(!stranger);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        (bool late,) = address(mimir).call{value: bond}(abi.encodeWithSelector(MimirV3.disputeResolution.selector, id));
        assert(!late);
    }

    function test_aRightDisputeFlipsTheVerdictAndReturnsTheBond() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());

        uint256 bond = mimir.MIN_STAKE();
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);
        assert(_state(id) == mimir.ST_DISPUTED());

        // The oracle can no longer finalize its own proposal.
        vm.warp(block.timestamp + WINDOW);
        (bool fin,) = address(mimir).call(abi.encodeWithSelector(MimirV3.finalizeResolution.selector, id));
        assert(!fin);

        mimir.resolveDispute(id, mimir.SIDE_CHALLENGERS(), "arbiter", 100, bytes32(uint256(8)));
        assert(_state(id) == mimir.ST_RESOLVED());
        // Alice got her bond back and won the pot (minus the 50 bps fee on profit).
        assert(alice.balance - aliceBefore == 2 * STAKE - (STAKE * 50) / 10_000);
    }

    function test_aWrongDisputeForfeitsTheBondToThePlatform() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        uint256 bond = mimir.MIN_STAKE();
        vm.prank(alice);
        mimir.disputeResolution{value: bond}(id);

        uint256 feesBefore = mimir.accruedFees(platform);
        mimir.resolveDispute(id, mimir.SIDE_CREATOR(), "upheld", 95, bytes32(uint256(7)));
        assert(mimir.accruedFees(platform) - feesBefore >= bond);
        assert(address(mimir).balance == mimir.lifetimeFeesAccrued());
    }

    function test_onlyTheArbiterRulesOnADispute() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        uint256 bondAmount = mimir.MIN_STAKE();
        vm.prank(alice);
        mimir.disputeResolution{value: bondAmount}(id);

        vm.prank(oracle);
        (bool ok,) = address(mimir).call(
            abi.encodeWithSelector(MimirV3.resolveDispute.selector, id, uint8(2), "x", uint8(1), bytes32(0))
        );
        assert(!ok);
    }

    function test_anUnruledDisputeIsRefundableAndReturnsTheBond() public {
        uint256 id = _claim();
        _propose(id, mimir.SIDE_CREATOR());
        uint256 aliceBefore = alice.balance;
        uint256 bondAmount = mimir.MIN_STAKE();
        vm.prank(alice);
        mimir.disputeResolution{value: bondAmount}(id);

        vm.warp(block.timestamp + mimir.RESOLUTION_GRACE_SECONDS());
        vm.prank(bob);
        mimir.refundExpired(id);
        assert(alice.balance - aliceBefore == STAKE); // stake back, bond back
        assert(_state(id) == mimir.ST_RESOLVED());
    }

    function test_theDisputeWindowIsBounded() public {
        (bool ok,) = address(this).call(abi.encodeWithSelector(this.deployWithWindow.selector, 8 days));
        assert(!ok);
    }

    function deployWithWindow(uint256 window) external {
        new MimirV3(oracle, 50, 0, platform, address(0), window);
    }

    // ── permit + multicall ──────────────────────────────────────────────────

    function test_aPermitAndAStakeGoThroughInOneTransaction() public {
        PermitUSDC usdc = new PermitUSDC();
        MimirV3 m = new MimirV3(oracle, 50, 0, platform, address(usdc), 0);
        uint256 key = 0xA11CE5;
        address owner = vm.addr(key);
        usdc.mint(owner, 100e6);
        usdc.mint(creator, 100e6);

        // The creator opens with a plain approve; the challenger uses permit.
        vm.prank(creator);
        usdc.approve(address(m), 10e6);
        vm.prank(creator);
        uint256 id = m.createClaim(
            "Will it?", "yes", "no", "https://example.com", block.timestamp + GAP, 10e6,
            "custom", 0, "binary", "pool", 0, "", "rule", 0, false, "", address(0)
        );

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            owner, address(m), uint256(5e6), uint256(0), deadline
        ))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSelector(MimirV3.usdcPermit.selector, uint256(5e6), deadline, v, r, s);
        calls[1] = abi.encodeWithSelector(MimirV3.challengeClaim.selector, id, uint256(5e6), "", address(0));
        vm.prank(owner);
        m.multicall(calls);

        assert(m.hasChallenged(id, owner));
        assert(usdc.balanceOf(owner) == 95e6);
    }

    function test_multicallIsRefusedInNativeMode() public {
        bytes[] memory calls = new bytes[](0);
        (bool ok,) = address(mimir).call(abi.encodeWithSelector(MimirV3.multicall.selector, calls));
        assert(!ok);
    }
}
