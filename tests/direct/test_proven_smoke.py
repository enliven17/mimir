WEI = 10**18


def _create_claim(
    contract,
    direct_vm,
    sender,
    stake,
    *,
    visibility="public",
    invite_key="",
    max_challengers=2,
    market_type="binary",
    odds_mode="pool",
    challenger_payout_bps=0,
    parent_id=0,
):
    direct_vm.sender = sender
    direct_vm.value = stake
    return contract.create_claim(
        "Will BTC close above 100k by the deadline?",
        "Yes",
        "No",
        "https://example.com/market",
        1_700_000_000,
        stake,
        "crypto",
        parent_id,
        market_type,
        odds_mode,
        challenger_payout_bps,
        "",
        "",
        max_challengers,
        visibility,
        invite_key,
    )


def test_create_claim_smoke(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/proven.py")

    claim_id = _create_claim(contract, direct_vm, direct_alice, 5)

    direct_vm.value = 0
    claim = contract.get_claim(claim_id)

    assert claim["id"] == 1
    assert claim["creator"].lower() == f"0x{direct_alice.hex()}"
    assert claim["creator_stake"] == 5
    assert claim["state"] == "open"
    assert claim["challenger_count"] == 0
    assert claim["total_pot"] == 5


def test_create_claim_accepts_browser_scaled_value(
    direct_vm,
    direct_deploy,
    direct_alice,
):
    contract = direct_deploy("contracts/proven.py")

    direct_vm.sender = direct_alice
    direct_vm.value = 5 * WEI
    claim_id = contract.create_claim(
        "Will BTC close above 100k by the deadline?",
        "Yes",
        "No",
        "https://example.com/market",
        1_700_000_000,
        5,
        "crypto",
        0,
        "binary",
        "pool",
        0,
        "",
        "",
        2,
        "public",
        "",
    )

    direct_vm.value = 0
    claim = contract.get_claim(claim_id)
    assert claim["creator_stake"] == 5
    assert claim["total_pot"] == 5


def test_challenge_claim_updates_totals(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/proven.py")

    claim_id = _create_claim(contract, direct_vm, direct_alice, 5)

    direct_vm.sender = direct_bob
    direct_vm.value = 3
    contract.challenge_claim(claim_id, 3)

    direct_vm.value = 0
    claim = contract.get_claim(claim_id)

    assert claim["state"] == "active"
    assert claim["challenger_count"] == 1
    assert claim["total_challenger_stake"] == 3
    assert claim["total_pot"] == 8


def test_private_claim_requires_valid_invite_for_read_and_join(
    direct_vm,
    direct_deploy,
    direct_alice,
    direct_bob,
):
    contract = direct_deploy("contracts/proven.py")
    invite_key = "invite-demo-123"

    claim_id = _create_claim(
        contract,
        direct_vm,
        direct_alice,
        5,
        visibility="private",
        invite_key=invite_key,
    )

    direct_vm.value = 0
    with direct_vm.expect_revert("Private claim requires access link"):
        contract.get_claim(claim_id)

    with direct_vm.expect_revert("Private claim requires a valid invite link"):
        contract.get_claim_with_access(claim_id, "wrong-key")

    direct_vm.sender = direct_bob
    direct_vm.value = 3
    with direct_vm.expect_revert("Valid private invite link required"):
        contract.challenge_claim(claim_id, 3, "wrong-key")

    contract.challenge_claim(claim_id, 3, invite_key)
    direct_vm.value = 0

    claim = contract.get_claim_with_access(claim_id, invite_key)
    assert claim["challenger_count"] == 1
    assert claim["is_private"] is True


def test_rematch_keeps_parent_terms(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/proven.py")

    parent_id = _create_claim(
        contract,
        direct_vm,
        direct_alice,
        5,
        visibility="private",
        invite_key="alpha",
        max_challengers=3,
        market_type="spread",
    )

    direct_vm.sender = direct_alice
    direct_vm.value = 7
    rematch_id = contract.create_rematch(parent_id, 1_800_000_000, 7)

    direct_vm.value = 0
    rematch = contract.get_claim_with_access(rematch_id, "alpha")

    assert rematch["parent_id"] == parent_id
    assert rematch["visibility"] == "private"
    assert rematch["market_type"] == "spread"
    assert rematch["max_challengers"] == 3
    assert contract.get_rivalry_chain(rematch_id) == [1, 2]


def test_fixed_odds_liquidity_cap_blocks_extra_challenger(
    direct_vm,
    direct_deploy,
    direct_alice,
    direct_bob,
    direct_charlie,
):
    contract = direct_deploy("contracts/proven.py")

    claim_id = _create_claim(
        contract,
        direct_vm,
        direct_alice,
        10,
        odds_mode="fixed",
        challenger_payout_bps=25000,
        max_challengers=3,
    )

    direct_vm.sender = direct_bob
    direct_vm.value = 4
    contract.challenge_claim(claim_id, 4)

    direct_vm.value = 0
    claim = contract.get_claim(claim_id)
    assert claim["reserved_creator_liability"] == 6
    assert claim["available_creator_liability"] == 4

    direct_vm.sender = direct_charlie
    direct_vm.value = 4
    with direct_vm.expect_revert("Not enough creator liquidity at these odds"):
        contract.challenge_claim(claim_id, 4)
