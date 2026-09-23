// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3} from "../MimirV3.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
}

/// Minimal 6-decimal USDC stand-in with Circle's blacklist behaviour: a
/// transfer to a blacklisted address reverts instead of returning false.
contract MockUSDC {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blacklisted;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function setBlacklisted(address who, bool v) external { blacklisted[who] = v; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(!blacklisted[to] && !blacklisted[from], "blacklisted");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract MimirV3TokenTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MimirV3 mimir;
    MockUSDC usdc;

    address oracle = address(0x0417ac1e);
    address platform = address(0xFEE);
    address creator = address(0xC7ea704);
    address challenger = address(0xC4a11e);

    uint256 constant ONE = 1e6;
    uint256 constant STAKE = 10 * ONE;

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
        mimir = new MimirV3(oracle, 50, 50, platform, address(usdc));
        usdc.mint(creator, 1_000 * ONE);
        usdc.mint(challenger, 1_000 * ONE);
        vm.prank(creator);
        usdc.approve(address(mimir), type(uint256).max);
        vm.prank(challenger);
        usdc.approve(address(mimir), type(uint256).max);
    }

    function _create(address who, uint256 stake) internal returns (uint256 id) {
        vm.prank(who);
        id = mimir.createClaim(
            "Will it?", "yes", "no", "https://example.com",
            block.timestamp + 1 days, stake, "custom", 0, "binary", "pool",
            0, "", "rule", 0, false, "", address(0)
        );
    }

    function _settle(uint256 id, uint8 side) internal {
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(oracle);
        mimir.resolveClaim(id, side, "because", 90, bytes32(uint256(1)));
    }

    function test_minStakeFollowsTokenDecimals() public view {
        assert(mimir.MIN_STAKE() == 2 * ONE);
        assert(mimir.usdc() == address(usdc));
    }

    function test_stakesArePulledAndPaidInToken() public {
        uint256 id = _create(creator, STAKE);
        vm.prank(challenger);
        mimir.challengeClaim(id, STAKE, "", address(0));
        assert(usdc.balanceOf(address(mimir)) == 2 * STAKE);

        uint256 before = usdc.balanceOf(creator);
        _settle(id, mimir.SIDE_CREATOR());

        uint256 fee = (STAKE * 50) / 10_000;
        assert(usdc.balanceOf(creator) - before == 2 * STAKE - fee);
        // Whatever the escrow still holds is exactly what it owes in fees.
        assert(usdc.balanceOf(address(mimir)) == mimir.lifetimeFeesAccrued());
        (,, uint256 held) = mimir.getPlatformStats();
        assert(held == fee);
    }

    function test_nativeValueIsRejected() public {
        (bool ok,) = address(mimir).call{value: 1}(
            abi.encodeWithSignature(
                "challengeClaim(uint256,uint256,string,address)", 1, STAKE, "", address(0)
            )
        );
        assert(!ok);
    }

    function test_aBlacklistedWinnerIsParkedNotFrozen() public {
        uint256 id = _create(creator, STAKE);
        vm.prank(challenger);
        mimir.challengeClaim(id, STAKE, "", address(0));

        usdc.setBlacklisted(challenger, true);
        _settle(id, mimir.SIDE_CHALLENGERS());

        // Settlement completed; the net payout waits for the recipient to pull.
        assert(mimir.pendingWithdrawals(challenger) == 2 * STAKE - (STAKE * 50) / 10_000);
        (,,,,,,,,, uint8 state,,,,,,,,) = mimir.getClaim(id);
        assert(state == mimir.ST_RESOLVED());
    }

    function test_rematchCreatorIsTheCaller() public {
        uint256 parent = _create(creator, STAKE);
        vm.prank(creator);
        uint256 id = mimir.createRematch(parent, block.timestamp + 1 days, STAKE, "");
        (address who,,,,,,,,,,,,,,,,,) = mimir.getClaim(id);
        assert(who == creator);
    }

    receive() external payable {}
}
