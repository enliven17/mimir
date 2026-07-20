// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Mimir — AI-settled prediction market on Arc (Circle L1)
 *
 * USDC is the native currency on Arc (like ETH on Ethereum).
 * Stakes use msg.value / payable transfers — no ERC-20 approve needed.
 *
 * Resolution is performed by an authorized off-chain AI oracle agent that:
 *   1. Fetches web evidence from the claim's resolution_url
 *   2. Uses an LLM to evaluate the claim
 *   3. Calls resolveClaim() with verdict + summary
 */
contract Mimir {
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
    uint256 public constant MAX_PAYOUT_BPS         = 1_000_000; // 100x ceiling

    // Gas stipend for pushed payouts during settlement. Enough for a normal
    // receive()/EOA, but caps how much a malicious challenger contract can burn
    // per iteration so it can't grief the whole settlement loop into OOG.
    // ponytail: fixed stipend; failed pushes fall back to pull-withdrawal.
    uint256 public constant PAYOUT_GAS_STIPEND     = 30_000;

    // Anti-sniping: no new challenges accepted in the final N seconds before
    // a claim's deadline. Stops late-information actors from waiting to see
    // the outcome and slipping in a zero-risk bet.
    uint256 public constant CHALLENGE_LOCK_SECONDS = 60;

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

    mapping(uint256 => Claim)   public claims;
    // claimId * MAX_CHALLENGERS + index → address / stake
    mapping(uint256 => address) public challengerAddresses;
    mapping(uint256 => uint256) public challengerStakes;
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

    uint256 public claimCount;
    uint256 public totalResolved;

    address public owner;
    address public pendingOwner; // two-step ownership transfer
    address public oracle; // off-chain AI oracle agent
    bool    public paused;  // emergency freeze for state-changing entrypoints

    // ── Events ────────────────────────────────────────────────────────────────
    event ClaimCreated(uint256 indexed id, address indexed creator, string category);
    event ClaimChallenged(uint256 indexed id, address indexed challenger, uint256 stake);
    event ClaimResolved(uint256 indexed id, uint8 winnerSide, string summary, uint8 confidence, bytes32 evidenceHash);
    event ClaimCancelled(uint256 indexed id);
    event OracleChanged(address indexed previous, address indexed next);
    event OwnershipTransferStarted(address indexed previous, address indexed next);
    event OwnershipTransferred(address indexed previous, address indexed next);
    event PausedSet(bool paused);
    event WithdrawalPending(address indexed to, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Mimir: not owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Mimir: not oracle");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Mimir: paused");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address _oracle) {
        owner  = msg.sender;
        oracle = _oracle;
        emit OracleChanged(address(0), _oracle);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Mimir: zero oracle");
        emit OracleChanged(oracle, _oracle);
        oracle = _oracle;
    }

    // Two-step ownership transfer: the new owner must call acceptOwnership(),
    // so a fat-fingered or zero address can never take (or brick) control.
    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "Mimir: zero owner");
        pendingOwner = _owner;
        emit OwnershipTransferStarted(owner, _owner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Mimir: not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // Emergency freeze: halts create/challenge/resolve. withdraw() and
    // cancelClaim() stay open so users can always exit funds.
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    function _chKey(uint256 claimId, uint256 index) internal pure returns (uint256) {
        return claimId * MAX_CHALLENGERS + index;
    }

    function _transfer(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{value: amount, gas: PAYOUT_GAS_STIPEND}("");
        if (!ok) {
            // Failed push (recipient rejected funds) → park for pull-withdrawal
            // so a single uncooperative recipient can't revert the settlement.
            pendingWithdrawals[to] += amount;
            emit WithdrawalPending(to, amount);
        }
    }

    // ── Withdraw: pull a parked payout ──────────────────────────────────────────
    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Mimir: nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0; // effects before interaction (reentrancy-safe)
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Mimir: withdraw failed");
        emit Withdrawal(msg.sender, amount);
    }

    function _grossPayout(uint256 stake, uint256 bps) internal pure returns (uint256) {
        return (stake * bps) / 10_000;
    }

    // ── Write: create ─────────────────────────────────────────────────────────
    // Params bundled in a memory struct so both createClaim and createRematch
    // share one code path without a 17-argument internal call (stack too deep).
    struct CreateParams {
        address creator;
        string  question;
        string  creatorPosition;
        string  counterPosition;
        string  resolutionUrl;
        uint256 deadline;
        uint256 stakeAmount;
        string  category;
        uint256 parentId;
        string  marketType;
        string  oddsMode;
        uint256 challengerPayoutBps;
        string  handicapLine;
        string  settlementRule;
        uint256 maxChallengers;
        bool    isPrivate;
        string  inviteKey;
    }

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
        string  calldata inviteKey
    ) external payable whenNotPaused returns (uint256 id) {
        return _createClaim(CreateParams({
            creator:             msg.sender,
            question:            question,
            creatorPosition:     creatorPosition,
            counterPosition:     counterPosition,
            resolutionUrl:       resolutionUrl,
            deadline:            deadline,
            stakeAmount:         stakeAmount,
            category:            category,
            parentId:            parentId,
            marketType:          marketType,
            oddsMode:            oddsMode,
            challengerPayoutBps: challengerPayoutBps,
            handicapLine:        handicapLine,
            settlementRule:      settlementRule,
            maxChallengers:      maxChallengers,
            isPrivate:           isPrivate,
            inviteKey:           inviteKey
        }));
    }

    // Internal so createRematch can call it WITHOUT `this.` — an external
    // self-call would set msg.sender to the contract, making the contract the
    // claim creator and locking the real payer's funds.
    function _createClaim(CreateParams memory p) internal returns (uint256 id) {
        require(p.stakeAmount >= MIN_STAKE, "Mimir: stake too small");
        require(msg.value == p.stakeAmount, "Mimir: wrong USDC value");
        require(p.deadline > block.timestamp, "Mimir: deadline in past");
        require(bytes(p.question).length > 0, "Mimir: empty question");
        require(p.challengerPayoutBps <= MAX_PAYOUT_BPS, "Mimir: payout bps too high");

        // Normalise odds params
        bool isFixed = _strEq(p.oddsMode, "fixed");
        uint256 payoutBps = isFixed
            ? (p.challengerPayoutBps >= 10_000 ? p.challengerPayoutBps : DEFAULT_PAYOUT_BPS)
            : 0;

        uint256 maxCh = (p.maxChallengers == 0 || p.maxChallengers > MAX_CHALLENGERS)
            ? MAX_CHALLENGERS
            : p.maxChallengers;

        claimCount++;
        id = claimCount;

        // Field-by-field storage writes (not a Claim{...} memory literal) to
        // keep the stack shallow under viaIR. Zero-valued fields are left at
        // their storage default.
        Claim storage c = claims[id];
        c.creator             = p.creator;
        c.question            = p.question;
        c.creatorPosition     = p.creatorPosition;
        c.counterPosition     = p.counterPosition;
        c.resolutionUrl       = p.resolutionUrl;
        c.creatorStake        = p.stakeAmount;
        c.deadline            = p.deadline;
        c.state               = ST_OPEN;
        c.winnerSide          = SIDE_NONE;
        c.category            = bytes(p.category).length > 0 ? p.category : "custom";
        c.parentId            = p.parentId;
        c.createdAt           = block.timestamp;
        c.marketType          = bytes(p.marketType).length > 0 ? p.marketType : "binary";
        c.oddsMode            = isFixed ? "fixed" : "pool";
        c.challengerPayoutBps = payoutBps;
        c.handicapLine        = p.handicapLine;
        c.settlementRule      = p.settlementRule;
        c.maxChallengers      = maxCh;
        c.isPrivate           = p.isPrivate;
        if (bytes(p.inviteKey).length > 0) {
            c.inviteKeyHash = keccak256(bytes(p.inviteKey));
        }

        emit ClaimCreated(id, p.creator, p.category);
    }

    // Rematch: create a new claim inheriting fields from a parent
    function createRematch(
        uint256 parentId,
        uint256 deadline,
        uint256 stakeAmount,
        string  calldata inviteKey
    ) external payable whenNotPaused returns (uint256 id) {
        Claim storage parent = claims[parentId];
        require(parent.creator != address(0), "Mimir: parent not found");

        return _createClaim(CreateParams({
            creator:             msg.sender,
            question:            parent.question,
            creatorPosition:     parent.creatorPosition,
            counterPosition:     parent.counterPosition,
            resolutionUrl:       parent.resolutionUrl,
            deadline:            deadline,
            stakeAmount:         stakeAmount,
            category:            parent.category,
            parentId:            parentId,
            marketType:          parent.marketType,
            oddsMode:            parent.oddsMode,
            challengerPayoutBps: parent.challengerPayoutBps,
            handicapLine:        parent.handicapLine,
            settlementRule:      parent.settlementRule,
            maxChallengers:      parent.maxChallengers,
            isPrivate:           parent.isPrivate,
            inviteKey:           inviteKey
        }));
    }

    // ── Write: challenge ──────────────────────────────────────────────────────
    function challengeClaim(
        uint256 claimId,
        uint256 stakeAmount,
        string  calldata inviteKey
    ) external payable whenNotPaused {
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
    ) external onlyOracle whenNotPaused {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(claim.state == ST_ACTIVE, "Mimir: not active");
        require(block.timestamp >= claim.deadline, "Mimir: not yet expired");
        require(confidence <= 100, "Mimir: bad confidence");
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

        if (winnerSide == SIDE_CREATOR) {
            _transfer(claim.creator, claim.creatorStake + claim.totalChallengerStake);
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

                _transfer(ch, payout);
                wins[ch]++;
            }

            losses[claim.creator]++;
            if (isFixed && remainder > 0) {
                _transfer(claim.creator, remainder);
            }

        } else {
            // Draw / unresolvable: full refunds
            _transfer(claim.creator, claim.creatorStake);
            for (uint256 i = 0; i < claim.challengerCount; i++) {
                uint256 key = _chKey(claimId, i);
                _transfer(challengerAddresses[key], challengerStakes[key]);
            }
        }

        emit ClaimResolved(claimId, winnerSide, summary, confidence, evidenceHash);
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

    // Invite-key commitment for a private claim (bytes32(0) if none). Lets the
    // server enforce the invite gate by comparing keccak256(providedKey).
    function getInviteKeyHash(uint256 claimId) external view returns (bytes32) {
        return claims[claimId].inviteKeyHash;
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

    // ── Internal ──────────────────────────────────────────────────────────────
    function _strEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    // Fallback: reject accidental ETH/USDC sends without a function call
    receive() external payable {
        revert("Mimir: use createClaim or challengeClaim");
    }
}
