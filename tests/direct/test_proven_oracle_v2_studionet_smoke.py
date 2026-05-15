from datetime import datetime


def _unix(iso_timestamp: str) -> int:
    return int(datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00")).timestamp())


def test_studionet_variant_resolves_with_logical_stakes_only(
    direct_vm,
    direct_deploy,
    direct_alice,
    direct_bob,
):
    contract = direct_deploy("contracts/proven_oracle_v2_studionet.py")
    direct_vm.warp("2026-04-01T00:00:00Z")

    direct_vm.sender = direct_alice
    direct_vm.value = 0
    claim_id = contract.create_claim(
        "Will BTC close above 100k by the deadline?",
        "Yes",
        "No",
        "https://example.com/market",
        _unix("2026-04-02T00:00:00Z"),
        5,
        "sports",
        0,
        "binary",
        "pool",
        0,
        "",
        "",
        1,
        "public",
        "",
    )

    direct_vm.sender = direct_bob
    direct_vm.value = 0
    contract.challenge_claim(claim_id, 3)

    direct_vm.mock_web(
        r".*example\.com/market.*",
        {
            "status": 200,
            "body": "Official market update: BTC closed above 100k by the deadline.",
        },
    )
    direct_vm.mock_llm(
        r".*Will BTC close above 100k by the deadline\?.*",
        '{"verdict":"CREATOR_WINS","confidence":91,"explanation":"The linked source confirms BTC closed above the threshold by the deadline."}',
    )

    direct_vm.warp("2026-04-03T00:00:00Z")
    direct_vm.value = 0

    direct_vm.sender = direct_alice
    contract.request_resolve(claim_id)

    direct_vm.sender = direct_bob
    contract.request_resolve(claim_id)

    claim = contract.get_claim(claim_id)
    assert claim["state"] == "resolved"
    assert claim["winner_side"] == "creator"
    assert claim["resolve_attempts"] == 1
    assert claim["confidence"] == 91
    assert (
        claim["resolution_summary"]
        == "The linked source confirms BTC closed above the threshold by the deadline."
    )
    assert claim["creator_requested_resolve"] is False
    assert claim["challenger_requested_resolve"] is False
