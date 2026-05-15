from gltest import get_accounts, get_contract_factory
from gltest.assertions import tx_execution_succeeded


def _create_claim_args(stake_amount: int) -> list:
    return [
        "Will BTC close above 100k by the deadline?",
        "Yes",
        "No",
        "https://example.com/market",
        1_700_000_000,
        stake_amount,
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
    ]


def test_public_claim_flow_smoke():
    creator, challenger = get_accounts()[:2]
    factory = get_contract_factory(contract_file_path="proven.py")
    contract = factory.deploy(args=[], account=creator)

    create_receipt = contract.create_claim(args=_create_claim_args(5)).transact(
        value=5
    )
    assert tx_execution_succeeded(create_receipt)

    claim_count = contract.get_claim_count().call()
    assert claim_count == 1

    challenger_contract = contract.connect(challenger)
    challenge_receipt = challenger_contract.challenge_claim(args=[1, 3, ""]).transact(
        value=3
    )
    assert tx_execution_succeeded(challenge_receipt)

    claim = contract.get_claim(args=[1]).call()
    assert claim["state"] == "active"
    assert claim["creator_stake"] == 5
    assert claim["challenger_count"] == 1
    assert claim["total_challenger_stake"] == 3
    assert claim["total_pot"] == 8
