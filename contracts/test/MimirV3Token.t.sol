// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MimirV3} from "../MimirV3.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function deal(address, uint256) external;
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
        uint256 id = _create(creator, STAKE);
        vm.deal(challenger, 1 ether);

        // Every payable entry point refuses native value in token mode.
        vm.prank(challenger);
        (bool challenged,) = address(mimir).call{value: 1}(
            abi.encodeWithSignature(
                "challengeClaim(uint256,uint256,string,address)", id, STAKE, "", address(0)
            )
        );
        assert(!challenged);

        vm.prank(challenger);
        (bool rematched,) = address(mimir).call{value: 1}(
            abi.encodeWithSignature(
                "createRematch(uint256,uint256,uint256,string)", id, block.timestamp + 1 days, STAKE, ""
            )
        );
        assert(!rematched);

        vm.prank(creator);
        vm.deal(creator, 1 ether);
        (bool created,) = address(mimir).call{value: 1}(
            abi.encodeWithSignature(
                "createClaim(string,string,string,string,uint256,uint256,string,uint256,string,string,uint256,string,string,uint256,bool,string,address)",
                "q", "a", "b", "u", block.timestamp + 1 days, STAKE, "custom", 0, "binary", "pool",
                0, "", "r", 0, false, "", address(0)
            )
        );
        assert(!created);

        // Nothing moved: the escrow holds exactly the one claim's stake.
        assert(usdc.balanceOf(address(mimir)) == STAKE);
        assert(address(mimir).balance == 0);
    }

    function test_aParkedPayoutCanBePulledElsewhere() public {
        uint256 id = _create(creator, STAKE);
        vm.prank(challenger);
        mimir.challengeClaim(id, STAKE, "", address(0));
        usdc.setBlacklisted(challenger, true);
        _settle(id, mimir.SIDE_CHALLENGERS());

        uint256 parked = mimir.pendingWithdrawals(challenger);
        assert(parked > 0);

        // Its own address still cannot receive...
        vm.prank(challenger);
        (bool self,) = address(mimir).call(abi.encodeWithSignature("withdraw()"));
        assert(!self);
        assert(mimir.pendingWithdrawals(challenger) == parked);

        // ...but it can send the payout somewhere that can.
        address rescue = address(0x5AFE);
        vm.prank(challenger);
        mimir.withdrawTo(rescue);
        assert(usdc.balanceOf(rescue) == parked);
        assert(mimir.pendingWithdrawals(challenger) == 0);
    }

    function test_aStrangersRematchDoesNotInheritTheAgentOwner() public {
        address agent = address(0xA6E7);
        vm.prank(creator);
        uint256 parent = mimir.createClaim(
            "Will it?", "yes", "no", "https://example.com",
            block.timestamp + 1 days, STAKE, "custom", 0, "binary", "pool",
            0, "", "rule", 0, false, "", agent
        );

        vm.prank(challenger);
        uint256 strangers = mimir.createRematch(parent, block.timestamp + 1 days, STAKE, "");
        (,,, address strangerAgent) = mimir.getClaimFees(strangers);
        assert(strangerAgent == address(0));

        vm.prank(creator);
        uint256 own = mimir.createRematch(parent, block.timestamp + 1 days, STAKE, "");
        (,,, address ownAgent) = mimir.getClaimFees(own);
        assert(ownAgent == agent);
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
