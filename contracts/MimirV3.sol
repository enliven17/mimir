// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * MimirV3 — AI-settled prediction market on Arc (Circle L1), with fees.
 *
 * USDC is the native currency on Arc, so stakes move through msg.value and
 * payable transfers; there is no ERC-20 approval step.
 *
 * What v3 adds over v2:
 *   - Fees charged on profit only, never on the gross payout. Staking 10 and
 *     winning 11 back must never leave you with less than 10.
 *   - The fee policy is snapshotted onto the claim at creation, so a later
 *     policy change cannot rewrite the economics of a market people already
 *     put money into.
 *   - Agent attribution: a position opened through a registered agent pays
 *     that agent's owner a share of the profit it produced.
 *   - Fee changes are timelocked and hard-capped, so no single owner action
 *     can take a meaningful share of a winner's profit by surprise.
 *   - Fees accrue to a pull balance. A push to a recipient that reverts would
 *     take the whole settlement down with it.
 */
contract MimirV3 {
    // ── State constants ───────────────────────────────────────────────────────
    uint8 public constant ST_OPEN        = 0;
    uint8 public constant ST_ACTIVE      = 1;
    uint8 public constant ST_RESOLVED    = 2;
    uint8 public constant ST_CANCELLED   = 3;

    // Winner side constants
    uint8 public constant SIDE_NONE          = 0;
    uint8 public constant SIDE_CREATOR       = 1;
    uint8 public constant SIDE_CHALLENGERS   = 2;
    uint8 public constant SIDE_DRAW          = 3;
    uint8 public constant SIDE_UNRESOLVABLE  = 4;

    // ── Limits ────────────────────────────────────────────────────────────────
    uint256 public constant MAX_CHALLENGERS        = 100;
    uint256 public constant MIN_STAKE              = 2 * 10**18; // 2 USDC (18 decimals on Arc)
    uint256 public constant DEFAULT_PAYOUT_BPS     = 20_000;    // 2x

    // Anti-sniping: no new challenges accepted in the final N seconds before
    // a claim's deadline. Stops late-information actors from waiting to see
    // the outcome and slipping in a zero-risk bet.
    uint256 public constant CHALLENGE_LOCK_SECONDS = 60;

    // ── Fee limits ────────────────────────────────────────────────────────────
    /// No policy may ever take more than 10% of a winner's profit, in total.
    uint16  public constant MAX_TOTAL_FEE_BPS   = 1_000;
    /// A queued policy cannot take effect for this long, so participants can leave.
    uint256 public constant FEE_TIMELOCK_SECONDS = 2 days;

    // ── Storage ───────────────────────────────────────────────────────────────
    struct Claim {
        address creator;
        string  question;
        string  creatorPosition;
        string  counterPosition;
        string  resolutionUrl;
        uint256 creatorStake;
        uint256 totalChallengerStake;
        uint256 reservedCreatorLiability;
        uint256 deadline;
        uint8   state;
        uint8   winnerSide;
        string  resolutionSummary;
        uint8   confidence;
        string  category;
        uint256 parentId;
        uint256 challengerCount;
        uint256 createdAt;
        // Market config
        string  marketType;          // binary | moneyline | spread | total | prop | custom
        string  oddsMode;            // pool | fixed
        uint256 challengerPayoutBps; // for fixed odds (e.g. 20000 = 2x)
        string  handicapLine;
        string  settlementRule;
        uint256 maxChallengers;
        bool    isPrivate;
        bytes32 inviteKeyHash;       // keccak256(inviteKey) for private claims
        bytes32 evidenceHash;        // keccak256(evidence content) — verifiable reasoning trace
    }

    struct FeePolicy {
        uint16  platformFeeBps;
        uint16  agentOwnerFeeBps;
        address platformRecipient;
    }

    mapping(uint256 => Claim)   public claims;
    /// Fee terms frozen at creation. Changing the live policy never touches these.
    mapping(uint256 => FeePolicy) public claimFeePolicy;
    /// Agent owner credited for the creator's side, set at creation.
    mapping(uint256 => address) public claimAgentOwner;

    // claimId * MAX_CHALLENGERS + index → address / stake / agent owner
    mapping(uint256 => address) public challengerAddresses;
    mapping(uint256 => uint256) public challengerStakes;
    mapping(uint256 => address) public challengerAgentOwner;
    // Prevents double-entry per claim
    mapping(uint256 => mapping(address => bool)) public hasChallenged;

    mapping(address => uint256) public wins;
    mapping(address => uint256) public losses;

    // Pull-payment fallback. A payout is normally pushed during resolveClaim,
    // but if the recipient's receive() reverts (e.g. a contract that refuses
    // funds), the amount is parked here instead of reverting the whole
    // settlement — one bad recipient can't freeze everyone else's payout.
    // The recipient pulls it later via withdraw().
    mapping(address => uint256) public pendingWithdrawals;

    /// Fees owed to a recipient, claimed with claimFees(). Never pushed.
    mapping(address => uint256) public accruedFees;

    uint256 public claimCount;
    uint256 public totalResolved;
    uint256 public lifetimeFeesAccrued;
    uint256 public lifetimeFeesClaimed;

    address public owner;
    address public oracle; // off-chain AI oracle agent

    FeePolicy public feePolicy;
    FeePolicy public pendingFeePolicy;
    /// Timestamp from which the pending policy may be executed. 0 = nothing queued.
    uint256 public pendingFeePolicyEta;

    // ── Events ────────────────────────────────────────────────────────────────
    event ClaimCreated(uint256 indexed id, address indexed creator, string category);
    event ClaimChallenged(uint256 indexed id, address indexed challenger, uint256 stake);
    event ClaimResolved(uint256 indexed id, uint8 winnerSide, string summary, uint8 confidence, bytes32 evidenceHash);
    event ClaimCancelled(uint256 indexed id);
    event OracleChanged(address indexed previous, address indexed next);
    event WithdrawalPending(address indexed to, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);
    event AgentAttributed(uint256 indexed id, address indexed participant, address indexed agentOwner);
    event FeePolicyQueued(uint16 platformFeeBps, uint16 agentOwnerFeeBps, address platformRecipient, uint256 eta);
    event FeePolicyCancelled();
    event FeePolicyUpdated(uint16 platformFeeBps, uint16 agentOwnerFeeBps, address platformRecipient);
    event FeeAccrued(uint256 indexed id, address indexed recipient, uint256 amount);
    event FeeClaimed(address indexed recipient, uint256 amount);
    event MarketSettled(uint256 indexed id, uint256 totalPaid, uint256 totalFees);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Mimir: not owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Mimir: not oracle");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address _oracle, uint16 _platformFeeBps, uint16 _agentOwnerFeeBps, address _platformRecipient) {
        owner  = msg.sender;
        oracle = _oracle;
        _validateFeePolicy(_platformFeeBps, _agentOwnerFeeBps, _platformRecipient);
        feePolicy = FeePolicy({
            platformFeeBps:    _platformFeeBps,
            agentOwnerFeeBps:  _agentOwnerFeeBps,
            platformRecipient: _platformRecipient
        });
        emit OracleChanged(address(0), _oracle);
        emit FeePolicyUpdated(_platformFeeBps, _agentOwnerFeeBps, _platformRecipient);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function setOracle(address _oracle) external onlyOwner {
        emit OracleChanged(oracle, _oracle);
        oracle = _oracle;
    }

    function transferOwnership(address _owner) external onlyOwner {
        owner = _owner;
    }

    // ── Fee governance ────────────────────────────────────────────────────────
    function _validateFeePolicy(uint16 platformFeeBps, uint16 agentOwnerFeeBps, address platformRecipient) internal pure {
        require(uint256(platformFeeBps) + uint256(agentOwnerFeeBps) <= MAX_TOTAL_FEE_BPS, "Mimir: fee too high");
        require(platformFeeBps == 0 || platformRecipient != address(0), "Mimir: no fee recipient");
    }

    function queueFeePolicy(uint16 platformFeeBps, uint16 agentOwnerFeeBps, address platformRecipient) external onlyOwner {
        _validateFeePolicy(platformFeeBps, agentOwnerFeeBps, platformRecipient);
        pendingFeePolicy = FeePolicy({
            platformFeeBps:    platformFeeBps,
            agentOwnerFeeBps:  agentOwnerFeeBps,
            platformRecipient: platformRecipient
        });
        pendingFeePolicyEta = block.timestamp + FEE_TIMELOCK_SECONDS;
        emit FeePolicyQueued(platformFeeBps, agentOwnerFeeBps, platformRecipient, pendingFeePolicyEta);
    }

    function cancelFeePolicy() external onlyOwner {
        require(pendingFeePolicyEta != 0, "Mimir: nothing queued");
        pendingFeePolicyEta = 0;
        emit FeePolicyCancelled();
    }

    /// Permissionless once the timelock has elapsed: the owner cannot queue a
    /// change, let people see it, and then quietly decline to apply it.
    function executeFeePolicy() external {
        require(pendingFeePolicyEta != 0, "Mimir: nothing queued");
        require(block.timestamp >= pendingFeePolicyEta, "Mimir: timelocked");
        feePolicy = pendingFeePolicy;
        pendingFeePolicyEta = 0;
        emit FeePolicyUpdated(feePolicy.platformFeeBps, feePolicy.agentOwnerFeeBps, feePolicy.platformRecipient);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    function _chKey(uint256 claimId, uint256 index) internal pure returns (uint256) {
        return claimId * MAX_CHALLENGERS + index;
    }

    function _transfer(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) {
            // Failed push (recipient rejected funds) → park for pull-withdrawal
            // so a single uncooperative recipient can't revert the settlement.
            pendingWithdrawals[to] += amount;
            emit WithdrawalPending(to, amount);
        }
    }

    /**
     * Pay a winner, charging fees on profit only.
     *
     * The base is always `gross - principal` floored at zero, so a refund and a
     * break-even win are both free, and a winner can never receive less than
     * the amount they staked. Division rounds down, which leaves any remainder
     * with the participant rather than the protocol. Nobody pays themselves:
     * if a fee recipient is the winner, that leg is waived rather than taken
     * and handed straight back.
     */
    function _payWinner(
        uint256 claimId,
        address to,
        uint256 gross,
        uint256 principal,
        address agentOwner
    ) internal returns (uint256 paid, uint256 fees) {
        uint256 profit = gross > principal ? gross - principal : 0;
        if (profit > 0) {
            FeePolicy memory p = claimFeePolicy[claimId];

            if (p.platformFeeBps > 0 && p.platformRecipient != address(0) && p.platformRecipient != to) {
                uint256 platformFee = (profit * p.platformFeeBps) / 10_000;
                if (platformFee > 0) {
                    accruedFees[p.platformRecipient] += platformFee;
                    fees += platformFee;
                    emit FeeAccrued(claimId, p.platformRecipient, platformFee);
                }
            }

            if (p.agentOwnerFeeBps > 0 && agentOwner != address(0) && agentOwner != to) {
                uint256 agentFee = (profit * p.agentOwnerFeeBps) / 10_000;
                if (agentFee > 0) {
                    accruedFees[agentOwner] += agentFee;
                    fees += agentFee;
                    emit FeeAccrued(claimId, agentOwner, agentFee);
                }
            }
        }

        lifetimeFeesAccrued += fees;
        paid = gross - fees;
        _transfer(to, paid);
    }

    // ── Withdraw: pull a parked payout ────────────────────────────────────────
    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Mimir: nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0; // effects before interaction (reentrancy-safe)
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Mimir: withdraw failed");
        emit Withdrawal(msg.sender, amount);
    }

    // ── Claim accrued fees ────────────────────────────────────────────────────
    function claimFees() external {
        uint256 amount = accruedFees[msg.sender];
        require(amount > 0, "Mimir: no fees");
        accruedFees[msg.sender] = 0;
        lifetimeFeesClaimed += amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Mimir: fee claim failed");
        emit FeeClaimed(msg.sender, amount);
    }

    function _grossPayout(uint256 stake, uint256 bps) internal pure returns (uint256) {
        return (stake * bps) / 10_000;
    }

    // ── Write: create ─────────────────────────────────────────────────────────
    function createClaim(
        string  calldata question,
        string  calldata creatorPosition,
        string  calldata counterPosition,
        string  calldata resolutionUrl,
        uint256          deadline,
        uint256          stakeAmount,
        string  calldata category,
        uint256          parentId,
        string  calldata marketType,
        string  calldata oddsMode,
        uint256          challengerPayoutBps,
        string  calldata handicapLine,
        string  calldata settlementRule,
        uint256          maxChallengers,
        bool             isPrivate,
        string  calldata inviteKey,
        address          agentOwnerRecipient
    ) external payable returns (uint256 id) {
        require(stakeAmount >= MIN_STAKE, "Mimir: stake too small");
        require(msg.value == stakeAmount, "Mimir: wrong USDC value");
        require(deadline > block.timestamp, "Mimir: deadline in past");
        require(bytes(question).length > 0, "Mimir: empty question");

        // Normalise odds params
        bool isFixed = _strEq(oddsMode, "fixed");
        uint256 payoutBps = isFixed
            ? (challengerPayoutBps >= 10_000 ? challengerPayoutBps : DEFAULT_PAYOUT_BPS)
            : 0;

        uint256 maxCh = (maxChallengers == 0 || maxChallengers > MAX_CHALLENGERS)
            ? MAX_CHALLENGERS
            : maxChallengers;

        claimCount++;
        id = claimCount;

        claims[id] = Claim({
            creator:                  msg.sender,
            question:                 question,
            creatorPosition:          creatorPosition,
            counterPosition:          counterPosition,
            resolutionUrl:            resolutionUrl,
            creatorStake:             stakeAmount,
            totalChallengerStake:     0,
            reservedCreatorLiability: 0,
            deadline:                 deadline,
            state:                    ST_OPEN,
            winnerSide:               SIDE_NONE,
            resolutionSummary:        "",
            confidence:               0,
            category:                 bytes(category).length > 0 ? category : "custom",
            parentId:                 parentId,
            challengerCount:          0,
            createdAt:                block.timestamp,
            marketType:               bytes(marketType).length > 0 ? marketType : "binary",
            oddsMode:                 isFixed ? "fixed" : "pool",
            challengerPayoutBps:      payoutBps,
            handicapLine:             handicapLine,
            settlementRule:           settlementRule,
            maxChallengers:           maxCh,
            isPrivate:                isPrivate,
            inviteKeyHash:            bytes(inviteKey).length > 0
                                          ? keccak256(bytes(inviteKey))
                                          : bytes32(0),
            evidenceHash:             bytes32(0)
        });

        // Freeze the economics: whatever the policy becomes later, this market
        // settles on the terms its participants agreed to.
        claimFeePolicy[id] = feePolicy;

        if (agentOwnerRecipient != address(0)) {
            claimAgentOwner[id] = agentOwnerRecipient;
            emit AgentAttributed(id, msg.sender, agentOwnerRecipient);
        }

        emit ClaimCreated(id, msg.sender, category);
    }

    // Rematch: create a new claim inheriting fields from a parent
    function createRematch(
        uint256 parentId,
        uint256 deadline,
        uint256 stakeAmount,
        string  calldata inviteKey
    ) external payable returns (uint256 id) {
        Claim storage parent = claims[parentId];
        require(parent.creator != address(0), "Mimir: parent not found");

        return this.createClaim{value: msg.value}(
            parent.question,
            parent.creatorPosition,
            parent.counterPosition,
            parent.resolutionUrl,
            deadline,
            stakeAmount,
            parent.category,
            parentId,
            parent.marketType,
            parent.oddsMode,
            parent.challengerPayoutBps,
            parent.handicapLine,
            parent.settlementRule,
            parent.maxChallengers,
            parent.isPrivate,
            inviteKey,
            claimAgentOwner[parentId]
        );
    }

    // ── Write: challenge ──────────────────────────────────────────────────────
    function challengeClaim(
        uint256 claimId,
        uint256 stakeAmount,
        string  calldata inviteKey,
        address agentOwnerRecipient
    ) external payable {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(claim.state == ST_OPEN || claim.state == ST_ACTIVE, "Mimir: not open");
        require(msg.sender != claim.creator, "Mimir: self-challenge");
        require(!hasChallenged[claimId][msg.sender], "Mimir: already challenged");
        require(claim.challengerCount < claim.maxChallengers, "Mimir: full");
        require(stakeAmount >= MIN_STAKE, "Mimir: stake too small");
        require(msg.value == stakeAmount, "Mimir: wrong USDC value");
        // Anti-sniping: challenges must arrive at least CHALLENGE_LOCK_SECONDS
        // before the deadline so the outcome isn't observable yet.
        require(
            block.timestamp + CHALLENGE_LOCK_SECONDS <= claim.deadline,
            "Mimir: challenge window closed"
        );

        // Private claim: verify invite key
        if (claim.isPrivate && claim.inviteKeyHash != bytes32(0)) {
            require(
                keccak256(bytes(inviteKey)) == claim.inviteKeyHash,
                "Mimir: invalid invite key"
            );
        }

        // Fixed odds: ensure creator has enough unreserved liquidity
        if (_strEq(claim.oddsMode, "fixed")) {
            uint256 gross   = _grossPayout(stakeAmount, claim.challengerPayoutBps);
            uint256 profit  = gross > stakeAmount ? gross - stakeAmount : 0;
            uint256 avail   = claim.creatorStake - claim.reservedCreatorLiability;
            require(avail >= profit, "Mimir: creator has insufficient liquidity");
            claim.reservedCreatorLiability += profit;
        }

        uint256 key = _chKey(claimId, claim.challengerCount);
        challengerAddresses[key]          = msg.sender;
        challengerStakes[key]             = stakeAmount;
        hasChallenged[claimId][msg.sender] = true;

        if (agentOwnerRecipient != address(0)) {
            challengerAgentOwner[key] = agentOwnerRecipient;
            emit AgentAttributed(claimId, msg.sender, agentOwnerRecipient);
        }

        claim.totalChallengerStake += stakeAmount;
        claim.challengerCount++;
        claim.state = ST_ACTIVE;

        emit ClaimChallenged(claimId, msg.sender, stakeAmount);
    }

    // ── Write: resolve (oracle only) ──────────────────────────────────────────
    function resolveClaim(
        uint256 claimId,
        uint8   winnerSide,
        string  calldata summary,
        uint8   confidence,
        bytes32 evidenceHash  // keccak256 of evidence text — verifiable on-chain
    ) external onlyOracle {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(claim.state == ST_ACTIVE, "Mimir: not active");
        require(block.timestamp >= claim.deadline, "Mimir: not yet expired");
        require(
            winnerSide == SIDE_CREATOR ||
            winnerSide == SIDE_CHALLENGERS ||
            winnerSide == SIDE_DRAW ||
            winnerSide == SIDE_UNRESOLVABLE,
            "Mimir: invalid verdict"
        );

        claim.state             = ST_RESOLVED;
        claim.winnerSide        = winnerSide;
        claim.resolutionSummary = summary;
        claim.confidence        = confidence;
        claim.evidenceHash      = evidenceHash;
        totalResolved++;

        uint256 totalPaid;
        uint256 totalFees;

        if (winnerSide == SIDE_CREATOR) {
            (uint256 paid, uint256 fees) = _payWinner(
                claimId,
                claim.creator,
                claim.creatorStake + claim.totalChallengerStake,
                claim.creatorStake,
                claimAgentOwner[claimId]
            );
            totalPaid += paid;
            totalFees += fees;
            wins[claim.creator]++;
            for (uint256 i = 0; i < claim.challengerCount; i++) {
                losses[challengerAddresses[_chKey(claimId, i)]]++;
            }

        } else if (winnerSide == SIDE_CHALLENGERS) {
            bool isFixed      = _strEq(claim.oddsMode, "fixed");
            uint256 remainder = claim.creatorStake;

            for (uint256 i = 0; i < claim.challengerCount; i++) {
                uint256 key      = _chKey(claimId, i);
                address ch       = challengerAddresses[key];
                uint256 chStake  = challengerStakes[key];
                uint256 payout;

                if (isFixed) {
                    payout = _grossPayout(chStake, claim.challengerPayoutBps);
                    uint256 profit = payout > chStake ? payout - chStake : 0;
                    remainder = remainder > profit ? remainder - profit : 0;
                } else {
                    // Pool: proportional share of creator stake
                    uint256 share = (chStake * claim.creatorStake) / claim.totalChallengerStake;
                    payout = chStake + share;
                }

                (uint256 paid, uint256 fees) = _payWinner(
                    claimId, ch, payout, chStake, challengerAgentOwner[key]
                );
                totalPaid += paid;
                totalFees += fees;
                wins[ch]++;
            }

            losses[claim.creator]++;
            if (isFixed && remainder > 0) {
                // Unspent creator liquidity, returned at cost: not a profit, not fee'd.
                _transfer(claim.creator, remainder);
                totalPaid += remainder;
            }

        } else {
            // Draw / unresolvable: full refunds, no fee. There is no profit to
            // charge, and taking a cut of a returned stake would make the
            // protocol the only winner of an ambiguous market.
            _transfer(claim.creator, claim.creatorStake);
            totalPaid += claim.creatorStake;
            for (uint256 i = 0; i < claim.challengerCount; i++) {
                uint256 key = _chKey(claimId, i);
                _transfer(challengerAddresses[key], challengerStakes[key]);
                totalPaid += challengerStakes[key];
            }
        }

        emit ClaimResolved(claimId, winnerSide, summary, confidence, evidenceHash);
        emit MarketSettled(claimId, totalPaid, totalFees);
    }

    // ── Write: cancel ─────────────────────────────────────────────────────────
    function cancelClaim(uint256 claimId) external {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(msg.sender == claim.creator, "Mimir: not creator");
        require(claim.state == ST_OPEN, "Mimir: not open");

        claim.state = ST_CANCELLED;
        _transfer(claim.creator, claim.creatorStake);
        emit ClaimCancelled(claimId);
    }

    // ── View: claim data ──────────────────────────────────────────────────────
    function getClaim(uint256 claimId) external view returns (
        address creator,
        string  memory question,
        string  memory creatorPosition,
        string  memory counterPosition,
        string  memory resolutionUrl,
        uint256 creatorStake,
        uint256 totalChallengerStake,
        uint256 reservedCreatorLiability,
        uint256 deadline,
        uint8   state,
        uint8   winnerSide,
        string  memory resolutionSummary,
        uint8   confidence,
        string  memory category,
        uint256 parentId,
        uint256 challengerCount,
        uint256 createdAt,
        bytes32 evidenceHash
    ) {
        Claim storage c = claims[claimId];
        return (
            c.creator, c.question, c.creatorPosition, c.counterPosition,
            c.resolutionUrl, c.creatorStake, c.totalChallengerStake,
            c.reservedCreatorLiability, c.deadline, c.state, c.winnerSide,
            c.resolutionSummary, c.confidence, c.category,
            c.parentId, c.challengerCount, c.createdAt, c.evidenceHash
        );
    }

    function getClaimMarketConfig(uint256 claimId) external view returns (
        string  memory marketType,
        string  memory oddsMode,
        uint256 challengerPayoutBps,
        string  memory handicapLine,
        string  memory settlementRule,
        uint256 maxChallengers,
        bool    isPrivate,
        uint256 reservedCreatorLiability
    ) {
        Claim storage c = claims[claimId];
        return (
            c.marketType, c.oddsMode, c.challengerPayoutBps,
            c.handicapLine, c.settlementRule, c.maxChallengers,
            c.isPrivate, c.reservedCreatorLiability
        );
    }

    /// The terms this specific market settles on, whatever the live policy is now.
    function getClaimFees(uint256 claimId) external view returns (
        uint16  platformFeeBps,
        uint16  agentOwnerFeeBps,
        address platformRecipient,
        address agentOwnerRecipient
    ) {
        FeePolicy storage p = claimFeePolicy[claimId];
        return (p.platformFeeBps, p.agentOwnerFeeBps, p.platformRecipient, claimAgentOwner[claimId]);
    }

    function getChallenger(uint256 claimId, uint256 index) external view returns (
        address challenger,
        uint256 stake
    ) {
        uint256 key = _chKey(claimId, index);
        return (challengerAddresses[key], challengerStakes[key]);
    }

    function getChallengerList(uint256 claimId) external view returns (
        address[] memory addrs,
        uint256[] memory stakes
    ) {
        uint256 count = claims[claimId].challengerCount;
        addrs  = new address[](count);
        stakes = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 key = _chKey(claimId, i);
            addrs[i]  = challengerAddresses[key];
            stakes[i] = challengerStakes[key];
        }
    }

    function getUserStats(address user) external view returns (
        uint256 userWins,
        uint256 userLosses
    ) {
        return (wins[user], losses[user]);
    }

    function getPlatformStats() external view returns (
        uint256 totalClaims,
        uint256 resolved,
        uint256 balance
    ) {
        return (claimCount, totalResolved, address(this).balance);
    }

    /// Accrued minus claimed must always be covered by the contract balance.
    function getFeeStats() external view returns (
        uint256 accrued,
        uint256 claimed,
        uint256 outstanding
    ) {
        return (lifetimeFeesAccrued, lifetimeFeesClaimed, lifetimeFeesAccrued - lifetimeFeesClaimed);
    }

    // ── Internal ──────────────────────────────────────────────────────────────
    function _strEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    // Fallback: reject accidental USDC sends without a function call
    receive() external payable {
        revert("Mimir: use createClaim or challengeClaim");
    }
}
