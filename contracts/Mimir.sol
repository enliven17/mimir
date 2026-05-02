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

    uint256 public claimCount;
    uint256 public totalResolved;

    address public owner;
    address public oracle; // off-chain AI oracle agent

    // ── Events ────────────────────────────────────────────────────────────────
    event ClaimCreated(uint256 indexed id, address indexed creator, string category);
    event ClaimChallenged(uint256 indexed id, address indexed challenger, uint256 stake);
    event ClaimResolved(uint256 indexed id, uint8 winnerSide, string summary, uint8 confidence, bytes32 evidenceHash);
    event ClaimCancelled(uint256 indexed id);
    event OracleChanged(address indexed previous, address indexed next);

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
    constructor(address _oracle) {
        owner  = msg.sender;
        oracle = _oracle;
        emit OracleChanged(address(0), _oracle);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function setOracle(address _oracle) external onlyOwner {
        emit OracleChanged(oracle, _oracle);
        oracle = _oracle;
    }

    function transferOwnership(address _owner) external onlyOwner {
        owner = _owner;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    function _chKey(uint256 claimId, uint256 index) internal pure returns (uint256) {
        return claimId * MAX_CHALLENGERS + index;
    }

    function _transfer(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "Mimir: transfer failed");
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
        string  calldata inviteKey
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
                                          : bytes32(0)
        });

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
            inviteKey
        );
    }

    // ── Write: challenge ──────────────────────────────────────────────────────
    function challengeClaim(
        uint256 claimId,
        uint256 stakeAmount,
        string  calldata inviteKey
    ) external payable {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(claim.state == ST_OPEN || claim.state == ST_ACTIVE, "Mimir: not open");
        require(msg.sender != claim.creator, "Mimir: self-challenge");
        require(!hasChallenged[claimId][msg.sender], "Mimir: already challenged");
        require(claim.challengerCount < claim.maxChallengers, "Mimir: full");
        require(stakeAmount >= MIN_STAKE, "Mimir: stake too small");
        require(msg.value == stakeAmount, "Mimir: wrong USDC value");

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
