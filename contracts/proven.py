# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass

from genlayer import *

ST_OPEN = "open"
ST_ACTIVE = "active"
ST_RESOLVED = "resolved"
ST_CANCELLED = "cancelled"

SIDE_CREATOR = "creator"
SIDE_CHALLENGERS = "challengers"
SIDE_DRAW = "draw"
SIDE_UNRESOLVABLE = "unresolvable"

MARKET_BINARY = "binary"
MARKET_MONEYLINE = "moneyline"
MARKET_SPREAD = "spread"
MARKET_TOTAL = "total"
MARKET_PROP = "prop"
MARKET_CUSTOM = "custom"

ODDS_POOL = "pool"
ODDS_FIXED = "fixed"

VISIBILITY_PUBLIC = "public"
VISIBILITY_PRIVATE = "private"

MAX_CHALLENGERS = 100
DEFAULT_FIXED_PAYOUT_BPS = 20000
GEN_DECIMALS = 10**18
MIN_STAKE = 2


@allow_storage
@dataclass
class Claim:
    creator: Address
    question: str
    creator_position: str
    counter_position: str
    resolution_url: str
    creator_stake: u256
    total_challenger_stake: u256
    reserved_creator_liability: u256
    deadline: u256
    state: str
    winner_side: str
    resolution_summary: str
    confidence: u256
    category: str
    parent_id: u256
    challenger_count: u256
    created_at: u256
    market_type: str
    odds_mode: str
    challenger_payout_bps: u256
    handicap_line: str
    settlement_rule: str
    max_challengers: u256
    visibility: str
    invite_key: str


class ProvenContract(gl.Contract):
    claims: TreeMap[u256, Claim]
    claim_count: u256
    ch_addr: TreeMap[u256, Address]
    ch_amount: TreeMap[u256, u256]

    def __init__(self):
        self.claim_count = u256(0)

    def _ch_key(self, claim_id: u256, index: u256) -> u256:
        return u256(claim_id * u256(MAX_CHALLENGERS) + index)

    def _normalize_text(self, value: str, fallback: str = "") -> str:
        if value is None:
            return fallback
        normalized = value.strip()
        if normalized:
            return normalized
        return fallback

    def _normalize_category(self, category: str) -> str:
        return self._normalize_text(category, "custom")

    def _normalize_market_type(self, market_type: str) -> str:
        normalized = self._normalize_text(market_type, MARKET_BINARY).lower()
        valid = (
            MARKET_BINARY,
            MARKET_MONEYLINE,
            MARKET_SPREAD,
            MARKET_TOTAL,
            MARKET_PROP,
            MARKET_CUSTOM,
        )
        if normalized not in valid:
            raise gl.vm.UserError("Unsupported market type")
        return normalized

    def _normalize_odds_mode(self, odds_mode: str) -> str:
        normalized = self._normalize_text(odds_mode, ODDS_POOL).lower()
        if normalized not in (ODDS_POOL, ODDS_FIXED):
            raise gl.vm.UserError("Unsupported odds mode")
        return normalized

    def _normalize_max_challengers(self, max_challengers: u256) -> u256:
        if max_challengers <= u256(0):
            return u256(MAX_CHALLENGERS)
        if max_challengers > u256(MAX_CHALLENGERS):
            raise gl.vm.UserError("Maximum challengers exceeds platform limit")
        return max_challengers

    def _normalize_fixed_payout_bps(self, odds_mode: str, payout_bps: u256) -> u256:
        if odds_mode != ODDS_FIXED:
            return u256(0)

        normalized = payout_bps
        if normalized <= u256(0):
            normalized = u256(DEFAULT_FIXED_PAYOUT_BPS)
        if normalized < u256(10000):
            raise gl.vm.UserError("Fixed odds payout must be at least 10000 bps")
        return normalized

    def _normalize_visibility(self, visibility: str) -> str:
        normalized = self._normalize_text(visibility, VISIBILITY_PUBLIC).lower()
        if normalized not in (VISIBILITY_PUBLIC, VISIBILITY_PRIVATE):
            raise gl.vm.UserError("Unsupported visibility mode")
        return normalized

    def _normalize_invite_key(self, invite_key: str) -> str:
        return self._normalize_text(invite_key)

    def _default_settlement_rule(self, category: str, market_type: str) -> str:
        if category == "deportes":
            if market_type == MARKET_SPREAD:
                return "Use the official final score from the linked event and apply the handicap exactly as written."
            if market_type == MARKET_TOTAL:
                return "Use the official final score from the linked event and grade the total exactly as written."
            return "Use the official final result from the linked event and count overtime, extra time, or penalties only if the market text says so."

        if category == "crypto":
            return "Use the linked source as the price reference and grade the threshold or line exactly at the deadline."

        if category == "clima":
            return "Use the linked weather source for the named place and date, and grade the condition exactly as written."

        if category == "cultura":
            return "Use the linked official or authoritative publication and grade only the exact published result."

        if market_type == MARKET_CUSTOM:
            return "Use the linked source only. If the wording or source is ambiguous, return UNRESOLVABLE."

        return "Use the market positions exactly as written."

    def _category_resolution_guidance(self, category: str) -> str:
        if category == "deportes":
            return "Prefer the official league, team, or scoreboard result page for the linked event."
        if category == "crypto":
            return "Treat the linked page as the canonical price source and avoid inferring across multiple exchanges."
        if category == "clima":
            return "Use the linked location-specific weather source and do not infer from nearby cities."
        if category == "cultura":
            return "Prefer the official publication, awards page, or primary entertainment source behind the claim."
        return "Prefer the linked primary source over general knowledge."

    def _require_stake_value(self, stake_amount) -> u256:
        normalized_stake = u256(stake_amount)

        if normalized_stake < u256(MIN_STAKE):
            raise gl.vm.UserError(f"Stake must be at least {MIN_STAKE}")

        return normalized_stake

    def _gross_payout(self, stake_amount: u256, payout_bps: u256) -> u256:
        return u256((stake_amount * payout_bps) // u256(10000))

    def _creator_liability_for(self, stake_amount: u256, payout_bps: u256) -> u256:
        gross_payout = self._gross_payout(stake_amount, payout_bps)
        if gross_payout <= stake_amount:
            return u256(0)
        return u256(gross_payout - stake_amount)

    def _available_creator_liability(self, claim: Claim) -> u256:
        if claim.reserved_creator_liability >= claim.creator_stake:
            return u256(0)
        return u256(claim.creator_stake - claim.reserved_creator_liability)

    def _coerce_address(self, value) -> Address:
        if isinstance(value, Address):
            return value
        return Address(str(value))

    def _transfer(self, addr: Address, amount: u256):
        if amount <= u256(0):
            return
        gl.get_contract_at(addr).emit_transfer(value=amount)

    def _claim_to_dict(self, claim_id: u256, include_challengers: bool) -> dict:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")

        claim = self.claims[claim_id]
        ch_count = int(claim.challenger_count)

        challengers = []
        challenger_addresses = []
        first_challenger = ""

        for i in range(ch_count):
            key = self._ch_key(claim_id, u256(i))
            challenger_address = str(self.ch_addr[key])
            if i == 0:
                first_challenger = challenger_address
            challenger_addresses.append(challenger_address)

            if include_challengers:
                stake = self.ch_amount[key]
                potential_payout = stake
                if claim.odds_mode == ODDS_FIXED:
                    potential_payout = self._gross_payout(stake, claim.challenger_payout_bps)
                challengers.append(
                    {
                        "address": challenger_address,
                        "stake": int(stake),
                        "potential_payout": int(potential_payout),
                    }
                )

        result = {
            "id": int(claim_id),
            "creator": str(claim.creator),
            "question": claim.question,
            "creator_position": claim.creator_position,
            "counter_position": claim.counter_position,
            "resolution_url": claim.resolution_url,
            "creator_stake": int(claim.creator_stake),
            "total_challenger_stake": int(claim.total_challenger_stake),
            "reserved_creator_liability": int(claim.reserved_creator_liability),
            "available_creator_liability": int(self._available_creator_liability(claim)),
            "deadline": int(claim.deadline),
            "state": claim.state,
            "winner_side": claim.winner_side,
            "resolution_summary": claim.resolution_summary,
            "confidence": int(claim.confidence),
            "category": claim.category,
            "parent_id": int(claim.parent_id),
            "challenger_count": ch_count,
            "market_type": claim.market_type,
            "odds_mode": claim.odds_mode,
            "challenger_payout_bps": int(claim.challenger_payout_bps),
            "handicap_line": claim.handicap_line,
            "settlement_rule": claim.settlement_rule,
            "max_challengers": int(claim.max_challengers),
            "created_at": int(claim.created_at),
            "visibility": claim.visibility,
            "is_private": claim.visibility == VISIBILITY_PRIVATE,
            "first_challenger": first_challenger,
            "challenger_addresses": challenger_addresses,
            "total_pot": int(claim.creator_stake + claim.total_challenger_stake),
        }

        if include_challengers:
            result["challengers"] = challengers

        return result

    def _create_claim_internal(
        self,
        question: str,
        creator_position: str,
        counter_position: str,
        resolution_url: str,
        deadline: u256,
        stake_amount: u256,
        category: str,
        parent_id: u256,
        market_type: str,
        odds_mode: str,
        challenger_payout_bps: u256,
        handicap_line: str,
        settlement_rule: str,
        max_challengers: u256,
        visibility: str,
        invite_key: str,
    ) -> int:
        question = self._normalize_text(question)
        creator_position = self._normalize_text(creator_position)
        counter_position = self._normalize_text(counter_position)
        resolution_url = self._normalize_text(resolution_url)
        handicap_line = self._normalize_text(handicap_line)
        settlement_rule = self._normalize_text(settlement_rule)
        category = self._normalize_category(category)
        market_type = self._normalize_market_type(market_type)
        odds_mode = self._normalize_odds_mode(odds_mode)
        max_challengers = self._normalize_max_challengers(max_challengers)
        challenger_payout_bps = self._normalize_fixed_payout_bps(odds_mode, challenger_payout_bps)
        visibility = self._normalize_visibility(visibility)
        invite_key = self._normalize_invite_key(invite_key)

        if not question:
            raise gl.vm.UserError("Question cannot be empty")
        if not creator_position:
            raise gl.vm.UserError("Creator position cannot be empty")
        if not counter_position:
            raise gl.vm.UserError("Counter position cannot be empty")
        if not resolution_url:
            raise gl.vm.UserError("Verification source is required")
        if visibility == VISIBILITY_PRIVATE and not invite_key:
            raise gl.vm.UserError("Private claims require an invite key")
        stake_amount = self._require_stake_value(stake_amount)

        if parent_id > u256(0) and parent_id not in self.claims:
            raise gl.vm.UserError("Parent claim not found")

        self.claim_count = u256(self.claim_count + u256(1))
        cid = self.claim_count

        claim = Claim(
            creator=gl.message.sender_address,
            question=question,
            creator_position=creator_position,
            counter_position=counter_position,
            resolution_url=resolution_url,
            creator_stake=stake_amount,
            total_challenger_stake=u256(0),
            reserved_creator_liability=u256(0),
            deadline=deadline,
            state=ST_OPEN,
            winner_side="",
            resolution_summary="",
            confidence=u256(0),
            category=category,
            parent_id=parent_id,
            challenger_count=u256(0),
            created_at=u256(0),
            market_type=market_type,
            odds_mode=odds_mode,
            challenger_payout_bps=challenger_payout_bps,
            handicap_line=handicap_line,
            settlement_rule=settlement_rule,
            max_challengers=max_challengers,
            visibility=visibility,
            invite_key=invite_key,
        )

        self.claims[cid] = claim
        return int(cid)

    @gl.public.write.payable
    def create_claim(
        self,
        question: str,
        creator_position: str,
        counter_position: str,
        resolution_url: str,
        deadline: u256,
        stake_amount: u256,
        category: str = "custom",
        parent_id: u256 = u256(0),
        market_type: str = MARKET_BINARY,
        odds_mode: str = ODDS_POOL,
        challenger_payout_bps: u256 = u256(0),
        handicap_line: str = "",
        settlement_rule: str = "",
        max_challengers: u256 = u256(0),
        visibility: str = VISIBILITY_PUBLIC,
        invite_key: str = "",
    ) -> int:
        return self._create_claim_internal(
            question=question,
            creator_position=creator_position,
            counter_position=counter_position,
            resolution_url=resolution_url,
            deadline=deadline,
            stake_amount=stake_amount,
            category=category,
            parent_id=parent_id,
            market_type=market_type,
            odds_mode=odds_mode,
            challenger_payout_bps=challenger_payout_bps,
            handicap_line=handicap_line,
            settlement_rule=settlement_rule,
            max_challengers=max_challengers,
            visibility=visibility,
            invite_key=invite_key,
        )

    @gl.public.write.payable
    def create_rematch(
        self,
        parent_id: u256,
        deadline: u256,
        stake_amount: u256,
        question: str = "",
        creator_position: str = "",
        counter_position: str = "",
        resolution_url: str = "",
        category: str = "",
        market_type: str = "",
        odds_mode: str = "",
        challenger_payout_bps: u256 = u256(0),
        handicap_line: str = "",
        settlement_rule: str = "",
        max_challengers: u256 = u256(0),
        visibility: str = "",
        invite_key: str = "",
    ) -> int:
        if parent_id not in self.claims:
            raise gl.vm.UserError("Parent claim not found")

        parent = self.claims[parent_id]

        rematch_question = self._normalize_text(question, parent.question)
        rematch_creator_position = self._normalize_text(creator_position, parent.creator_position)
        rematch_counter_position = self._normalize_text(counter_position, parent.counter_position)
        rematch_resolution_url = self._normalize_text(resolution_url, parent.resolution_url)
        rematch_category = self._normalize_text(category, parent.category)
        rematch_market_type = self._normalize_text(market_type, parent.market_type)
        rematch_odds_mode = self._normalize_text(odds_mode, parent.odds_mode)
        rematch_handicap_line = self._normalize_text(handicap_line, parent.handicap_line)
        rematch_settlement_rule = self._normalize_text(settlement_rule, parent.settlement_rule)
        rematch_visibility = self._normalize_text(visibility, parent.visibility)
        rematch_invite_key = self._normalize_text(invite_key, parent.invite_key)
        rematch_challenger_payout_bps = challenger_payout_bps
        if rematch_challenger_payout_bps <= u256(0):
            rematch_challenger_payout_bps = parent.challenger_payout_bps
        rematch_max_challengers = max_challengers
        if rematch_max_challengers <= u256(0):
            rematch_max_challengers = parent.max_challengers

        return self._create_claim_internal(
            question=rematch_question,
            creator_position=rematch_creator_position,
            counter_position=rematch_counter_position,
            resolution_url=rematch_resolution_url,
            deadline=deadline,
            stake_amount=stake_amount,
            category=rematch_category,
            parent_id=parent_id,
            market_type=rematch_market_type,
            odds_mode=rematch_odds_mode,
            challenger_payout_bps=rematch_challenger_payout_bps,
            handicap_line=rematch_handicap_line,
            settlement_rule=rematch_settlement_rule,
            max_challengers=rematch_max_challengers,
            visibility=rematch_visibility,
            invite_key=rematch_invite_key,
        )

    @gl.public.write.payable
    def challenge_claim(self, claim_id: u256, stake_amount: u256, invite_key: str = ""):
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")

        claim = self.claims[claim_id]

        if claim.state != ST_OPEN and claim.state != ST_ACTIVE:
            raise gl.vm.UserError("Claim is not accepting challengers")
        if gl.message.sender_address == claim.creator:
            raise gl.vm.UserError("Cannot challenge your own claim")
        if claim.visibility == VISIBILITY_PRIVATE:
            normalized_invite_key = self._normalize_invite_key(invite_key)
            if not normalized_invite_key or normalized_invite_key != claim.invite_key:
                raise gl.vm.UserError("Valid private invite link required")
        stake_amount = self._require_stake_value(stake_amount)

        count = int(claim.challenger_count)
        if count >= int(claim.max_challengers):
            raise gl.vm.UserError("Maximum challengers reached")

        for i in range(count):
            key = self._ch_key(claim_id, u256(i))
            if self.ch_addr[key] == gl.message.sender_address:
                raise gl.vm.UserError("Already challenged this claim")

        if claim.odds_mode == ODDS_FIXED:
            liability = self._creator_liability_for(stake_amount, claim.challenger_payout_bps)
            if liability > self._available_creator_liability(claim):
                raise gl.vm.UserError("Not enough creator liquidity at these odds")
            claim.reserved_creator_liability = u256(claim.reserved_creator_liability + liability)

        idx = u256(count)
        key = self._ch_key(claim_id, idx)
        self.ch_addr[key] = gl.message.sender_address
        self.ch_amount[key] = stake_amount

        claim.total_challenger_stake = u256(claim.total_challenger_stake + stake_amount)
        claim.challenger_count = u256(claim.challenger_count + u256(1))
        claim.state = ST_ACTIVE
        self.claims[claim_id] = claim

    @gl.public.write
    def resolve_claim(self, claim_id: u256):
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")

        claim = self.claims[claim_id]
        if claim.state != ST_ACTIVE:
            raise gl.vm.UserError("Claim must have challengers before resolving")

        m_q = str(claim.question)
        m_cp = str(claim.creator_position)
        m_counter = str(claim.counter_position)
        m_url = str(claim.resolution_url)
        has_url = len(m_url) > 0
        m_market_type = str(claim.market_type)
        m_odds_mode = str(claim.odds_mode)
        m_handicap_line = str(claim.handicap_line)
        m_rule = str(claim.settlement_rule)
        m_category = str(claim.category)

        def leader_fn():
            web_data = ""
            if has_url:
                web_response = gl.nondet.web.get(m_url)
                if web_response.body is not None:
                    web_data = web_response.body.decode("utf-8")
                    if len(web_data) > 6000:
                        web_data = web_data[:6000]

            if has_url and web_data:
                evidence = f"""EVIDENCE FROM THE WEB (source: {m_url}):
---
{web_data}
---"""
            else:
                evidence = """NO WEB SOURCE PROVIDED.
Use your general knowledge to evaluate this claim.
Only rule CREATOR_WINS or CHALLENGERS_WIN if you are highly confident.
Otherwise respond UNRESOLVABLE."""

            settlement_rule = m_rule if m_rule else self._default_settlement_rule(m_category, m_market_type)
            handicap_line = m_handicap_line if m_handicap_line else "none"
            category_guidance = self._category_resolution_guidance(m_category)

            prompt = f"""You are PROVEN, an impartial AI judge resolving a public market.

THE MARKET:
Question: "{m_q}"
Creator side: "{m_cp}"
Challenger side: "{m_counter}"
Category: "{m_category}"
Market type: "{m_market_type}"
Odds mode: "{m_odds_mode}"
Handicap / line: "{handicap_line}"
Settlement rule: "{settlement_rule}"
Category guidance: "{category_guidance}"

{evidence}

RULES:
1. Respect the settlement rule and handicap exactly.
2. If the evidence clearly supports the CREATOR side, respond CREATOR_WINS.
3. If the evidence clearly supports the CHALLENGERS side, respond CHALLENGERS_WIN.
4. If the outcome is a push, exact tie, or both sides are equally correct, respond DRAW.
5. If evidence is insufficient or the event has not happened yet, respond UNRESOLVABLE.
6. Respond based on the actual market terms, not which side you prefer.

Respond ONLY as JSON (no markdown, no extra text):
{{"verdict": "CREATOR_WINS", "confidence": 85, "explanation": "One sentence explaining your reasoning."}}

Valid verdicts: CREATOR_WINS, CHALLENGERS_WIN, DRAW, UNRESOLVABLE
Confidence: integer 0-100."""

            result = gl.nondet.exec_prompt(prompt, response_format="json")

            if not isinstance(result, dict):
                return {"verdict": SIDE_UNRESOLVABLE, "confidence": 0, "explanation": "AI returned invalid format"}

            verdict_raw = result.get("verdict", "UNRESOLVABLE")
            confidence = result.get("confidence", 50)
            explanation = result.get("explanation", "No explanation provided")

            verdict_map = {
                "CREATOR_WINS": SIDE_CREATOR,
                "CHALLENGERS_WIN": SIDE_CHALLENGERS,
                "DRAW": SIDE_DRAW,
                "UNRESOLVABLE": SIDE_UNRESOLVABLE,
            }
            verdict = verdict_map.get(verdict_raw, SIDE_UNRESOLVABLE)

            try:
                confidence = max(0, min(100, int(confidence)))
            except Exception:
                confidence = 50

            return {"verdict": verdict, "confidence": confidence, "explanation": explanation}

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            lr = leaders_res.calldata
            if not isinstance(lr, dict) or "verdict" not in lr:
                return False
            my = leader_fn()
            return my["verdict"] == lr["verdict"]

        resolution = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        verdict = resolution["verdict"]
        confidence = resolution["confidence"]
        explanation = resolution["explanation"]

        claim.state = ST_RESOLVED
        claim.winner_side = verdict
        claim.resolution_summary = explanation
        claim.confidence = u256(confidence)
        self.claims[claim_id] = claim

        creator_stake = claim.creator_stake
        total_ch = claim.total_challenger_stake
        total_pot = u256(creator_stake + total_ch)
        ch_count = int(claim.challenger_count)

        if verdict == SIDE_CREATOR:
            self._transfer(claim.creator, total_pot)

        elif verdict == SIDE_CHALLENGERS:
            total_challenger_payout = u256(0)

            for i in range(ch_count):
                key = self._ch_key(claim_id, u256(i))
                ch_stake = self.ch_amount[key]
                ch_addr = self.ch_addr[key]

                if claim.odds_mode == ODDS_FIXED:
                    payout = self._gross_payout(ch_stake, claim.challenger_payout_bps)
                elif total_ch > u256(0):
                    bonus = u256((ch_stake * creator_stake) // total_ch)
                    payout = u256(ch_stake + bonus)
                else:
                    payout = ch_stake

                total_challenger_payout = u256(total_challenger_payout + payout)
                self._transfer(ch_addr, payout)

            if claim.odds_mode == ODDS_FIXED and total_pot > total_challenger_payout:
                self._transfer(claim.creator, u256(total_pot - total_challenger_payout))

        else:
            self._transfer(claim.creator, creator_stake)
            for i in range(ch_count):
                key = self._ch_key(claim_id, u256(i))
                self._transfer(self.ch_addr[key], self.ch_amount[key])

    @gl.public.write
    def cancel_claim(self, claim_id: u256):
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")

        claim = self.claims[claim_id]
        if claim.state != ST_OPEN:
            raise gl.vm.UserError("Can only cancel claims with no challengers")
        if gl.message.sender_address != claim.creator:
            raise gl.vm.UserError("Only creator can cancel")

        claim.state = ST_CANCELLED
        self.claims[claim_id] = claim
        self._transfer(claim.creator, claim.creator_stake)

    @gl.public.view
    def get_claim(self, claim_id: u256) -> dict:
        claim = self.claims[claim_id] if claim_id in self.claims else None
        if claim is None:
            raise gl.vm.UserError("Claim not found")
        if claim.visibility == VISIBILITY_PRIVATE:
            raise gl.vm.UserError("Private claim requires access link")
        return self._claim_to_dict(claim_id, True)

    @gl.public.view
    def get_claim_with_access(self, claim_id: u256, invite_key: str = "") -> dict:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")

        claim = self.claims[claim_id]
        normalized_invite_key = self._normalize_invite_key(invite_key)
        if claim.visibility == VISIBILITY_PRIVATE:
            if not normalized_invite_key or normalized_invite_key != claim.invite_key:
                raise gl.vm.UserError("Private claim requires a valid invite link")
        return self._claim_to_dict(claim_id, True)

    @gl.public.view
    def get_claim_summaries(self, start_id: u256 = u256(1), limit: u256 = u256(50)) -> list:
        result = []
        total = int(self.claim_count)
        start = int(start_id)
        page_limit = int(limit)

        if start < 1:
            start = 1
        if page_limit <= 0:
            return result
        if page_limit > 100:
            page_limit = 100
        if start > total:
            return result

        end = start + page_limit
        if end > total + 1:
            end = total + 1

        for cid_int in range(start, end):
            cid = u256(cid_int)
            if cid in self.claims:
                claim = self.claims[cid]
                if claim.visibility == VISIBILITY_PRIVATE:
                    continue
                result.append(self._claim_to_dict(cid, False))

        return result

    @gl.public.view
    def get_claim_count(self) -> int:
        return int(self.claim_count)

    @gl.public.view
    def get_user_claims(self, user_address: str) -> list:
        addr = self._coerce_address(user_address)
        result = []
        total = int(self.claim_count)
        for i in range(total):
            cid = u256(i + 1)
            if cid not in self.claims:
                continue

            claim = self.claims[cid]
            if claim.creator == addr:
                result.append(int(cid))
                continue

            ch_count = int(claim.challenger_count)
            for j in range(ch_count):
                key = self._ch_key(cid, u256(j))
                if key in self.ch_addr and self.ch_addr[key] == addr:
                    result.append(int(cid))
                    break
        return result

    @gl.public.view
    def get_user_claim_summaries(self, user_address: str) -> list:
        result = []
        for claim_id in self.get_user_claims(user_address):
            result.append(self._claim_to_dict(u256(claim_id), False))
        return result

    @gl.public.view
    def get_open_claims(self) -> list:
        result = []
        total = int(self.claim_count)
        for i in range(total):
            cid = u256(i + 1)
            if cid not in self.claims:
                continue
            claim = self.claims[cid]
            if claim.visibility == VISIBILITY_PRIVATE:
                continue
            if claim.state == ST_OPEN or claim.state == ST_ACTIVE:
                result.append(int(cid))
        return result

    @gl.public.view
    def get_open_claim_summaries(self) -> list:
        result = []
        for claim_id in self.get_open_claims():
            result.append(self._claim_to_dict(u256(claim_id), False))
        return result

    @gl.public.view
    def get_rivalry_chain(self, claim_id: u256) -> list:
        if claim_id not in self.claims:
            raise gl.vm.UserError("Claim not found")

        root = claim_id
        visited = set()
        while True:
            if int(root) in visited:
                break
            visited.add(int(root))
            claim = self.claims[root]
            parent_id = claim.parent_id
            if parent_id == u256(0) or parent_id not in self.claims:
                break
            root = parent_id

        chain = [int(root)]
        visited_chain = {int(root)}

        total = int(self.claim_count)
        changed = True
        while changed:
            changed = False
            for i in range(total):
                cid = u256(i + 1)
                if int(cid) in visited_chain:
                    continue
                if cid not in self.claims:
                    continue
                claim = self.claims[cid]
                if int(claim.parent_id) in visited_chain:
                    chain.append(int(cid))
                    visited_chain.add(int(cid))
                    changed = True

        return chain
