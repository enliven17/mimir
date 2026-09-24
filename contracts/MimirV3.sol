// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * MimirV3 — AI-settled prediction market, with fees. Runs on any EVM chain.
 *
 * Two stake modes, fixed at deploy:
 *   - Native (usdc == address(0)): Arc, where USDC is the gas token. Stakes
 *     move through msg.value; there is no approval step.
 *   - ERC-20 (usdc != address(0)): Base, Arbitrum and anything else where
 *     USDC is a token. Stakes are pulled with transferFrom after an approve,
 *     and msg.value must be zero.
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
 *   - Settlement pushes carry a fixed gas stipend, so a recipient contract
 *     cannot burn the resolve transaction's gas; anything it refuses is parked.
 *   - An escape hatch: an ACTIVE claim the oracle has not resolved within
 *     RESOLUTION_GRACE_SECONDS of its deadline can be refunded by anyone.
 *   - Two-step ownership, a timelocked oracle change and a pause switch that
 *     stops new positions but never settlement, refunds or withdrawals.
 *
 * Known limit: invite keys travel in calldata, so a private claim hides its
 * link from the UI, not from someone reading the chain.
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
    /// 2 USDC in the stake asset's units: 2e18 native on Arc, 2e6 for ERC-20 USDC.
    uint256 public immutable MIN_STAKE;
    /// Stake asset. address(0) means the chain's native currency (Arc USDC).
    address public immutable usdc;
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
    /// An oracle change waits this long, so participants can react to a new settler.
    uint256 public constant ORACLE_TIMELOCK_SECONDS = 2 days;
    /// After deadline + this, an unresolved ACTIVE claim can be refunded by anyone.
    uint256 public constant RESOLUTION_GRACE_SECONDS = 7 days;
    /// Gas forwarded with each settlement push: enough for a plain receive or a
    /// USDC transfer, not enough for one recipient to starve the payout loop.
    uint256 public constant PUSH_GAS = 50_000;

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
    address public pendingOwner;
    address public oracle; // off-chain AI oracle agent
    address public pendingOracle;
    /// Timestamp from which pendingOracle may be installed. 0 = nothing queued.
    uint256 public pendingOracleEta;
    /// Stops new claims and challenges. Never stops settlement or withdrawals.
    bool public paused;

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
    event Withdrawal(address indexed account, address indexed to, uint256 amount);
    event AgentAttributed(uint256 indexed id, address indexed participant, address indexed agentOwner);
    event FeePolicyQueued(uint16 platformFeeBps, uint16 agentOwnerFeeBps, address platformRecipient, uint256 eta);
    event FeePolicyCancelled();
    event FeePolicyUpdated(uint16 platformFeeBps, uint16 agentOwnerFeeBps, address platformRecipient);
    event FeeAccrued(uint256 indexed id, address indexed recipient, uint256 amount);
    event FeeClaimed(address indexed recipient, address indexed to, uint256 amount);
    event MarketSettled(uint256 indexed id, uint256 totalPaid, uint256 totalFees);
    event ClaimExpiredRefund(uint256 indexed id, address indexed caller);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OracleChangeQueued(address indexed next, uint256 eta);
    event OracleChangeCancelled(address indexed next);
    event Paused(bool paused);

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
    constructor(
        address _oracle,
        uint16 _platformFeeBps,
        uint16 _agentOwnerFeeBps,
        address _platformRecipient,
        address _usdc
    ) {
        require(_oracle != address(0), "Mimir: zero oracle");
        owner  = msg.sender;
        oracle = _oracle;
        usdc   = _usdc;
        MIN_STAKE = _usdc == address(0)
            ? 2 * 10**18
            : 2 * 10**uint256(IERC20Like(_usdc).decimals());
        _validateFeePolicy(_platformFeeBps, _agentOwnerFeeBps, _platformRecipient);
        feePolicy = FeePolicy({
            platformFeeBps:    _platformFeeBps,
            agentOwnerFeeBps:  _agentOwnerFeeBps,
            platformRecipient: _platformRecipient
        });
        emit OwnershipTransferred(address(0), msg.sender);
        emit OracleChanged(address(0), _oracle);
        emit FeePolicyUpdated(_platformFeeBps, _agentOwnerFeeBps, _platformRecipient);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    /// Queue a new oracle, installable after ORACLE_TIMELOCK_SECONDS, so a
    /// compromised owner key cannot make itself the settler and resolve open
    /// markets before anyone notices.
    function queueOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Mimir: zero oracle");
        pendingOracle = _oracle;
        pendingOracleEta = block.timestamp + ORACLE_TIMELOCK_SECONDS;
        emit OracleChangeQueued(_oracle, pendingOracleEta);
    }

    function cancelOracle() external onlyOwner {
        require(pendingOracleEta != 0, "Mimir: nothing queued");
        emit OracleChangeCancelled(pendingOracle);
        pendingOracle = address(0);
        pendingOracleEta = 0;
    }

    /// Permissionless once the timelock has elapsed, like executeFeePolicy.
    function executeOracle() external {
        require(pendingOracleEta != 0, "Mimir: nothing queued");
        require(block.timestamp >= pendingOracleEta, "Mimir: timelocked");
        emit OracleChanged(oracle, pendingOracle);
        oracle = pendingOracle;
        pendingOracle = address(0);
        pendingOracleEta = 0;
    }

    /// Step one of two: the new owner must accept, so a typo cannot brick admin.
    function transferOwnership(address _owner) external onlyOwner {
        require(_owner != address(0), "Mimir: zero owner");
        pendingOwner = _owner;
        emit OwnershipTransferStarted(owner, _owner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Mimir: not pending owner");
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
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

    /// Take a stake from msg.sender in whichever asset this deployment uses.
    function _pullStake(uint256 amount) internal {
        if (usdc == address(0)) {
            require(msg.value == amount, "Mimir: wrong USDC value");
            return;
        }
        require(msg.value == 0, "Mimir: native value not accepted");
        uint256 before = IERC20Like(usdc).balanceOf(address(this));
        require(
            IERC20Like(usdc).transferFrom(msg.sender, address(this), amount),
            "Mimir: transferFrom failed"
        );
        // Exact accounting: a fee-on-transfer token would silently under-fund payouts.
        require(
            IERC20Like(usdc).balanceOf(address(this)) == before + amount,
            "Mimir: unsupported token"
        );
    }

    /// Send that reports failure instead of reverting. A blacklisted USDC
    /// recipient reverts rather than returning false, so both are caught.
    /// `gasLimit` 0 forwards all gas (withdrawals, where the caller pays for
    /// their own receiver); settlement pushes pass PUSH_GAS.
    function _trySend(address to, uint256 amount, uint256 gasLimit) internal returns (bool ok) {
        uint256 g = gasLimit == 0 ? gasleft() : gasLimit;
        if (usdc == address(0)) {
            // Assembly so no returndata is copied: a recipient cannot answer
            // with a huge revert payload and make the copy itself run out of gas.
            assembly ("memory-safe") {
                ok := call(g, to, amount, 0, 0, 0, 0)
            }
        } else {
            bytes memory data = abi.encodeWithSelector(IERC20Like.transfer.selector, to, amount);
            address token = usdc;
            uint256 retSize;
            uint256 retWord;
            assembly ("memory-safe") {
                ok := call(g, token, 0, add(data, 0x20), mload(data), 0, 0x20)
                retSize := returndatasize()
                retWord := mload(0)
            }
            // No return value, or a true one. Anything else is a failed send,
            // never a revert of the whole settlement.
            ok = ok && (retSize == 0 || (retSize >= 32 && retWord == 1));
        }
    }

    function _transfer(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!_trySend(to, amount, PUSH_GAS)) {
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
        _withdrawTo(msg.sender);
    }

    /// Pull a parked payout to another address. A USDC-blacklisted recipient
    /// can never receive at its own address, so without this it stays stuck.
    function withdrawTo(address to) external {
        require(to != address(0), "Mimir: zero recipient");
        _withdrawTo(to);
    }

    function _withdrawTo(address to) internal {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Mimir: nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0; // effects before interaction (reentrancy-safe)
        require(_trySend(to, amount, 0), "Mimir: withdraw failed");
        emit Withdrawal(msg.sender, to, amount);
    }

    // ── Claim accrued fees ────────────────────────────────────────────────────
    function claimFees() external {
        _claimFeesTo(msg.sender);
    }

    /// Claim to another address: a blocklisted fee recipient could never be paid otherwise.
    function claimFeesTo(address to) external {
        require(to != address(0), "Mimir: zero recipient");
        _claimFeesTo(to);
    }

    function _claimFeesTo(address to) internal {
        uint256 amount = accruedFees[msg.sender];
        require(amount > 0, "Mimir: no fees");
        accruedFees[msg.sender] = 0;
        lifetimeFeesClaimed += amount;
        require(_trySend(to, amount, 0), "Mimir: fee claim failed");
        emit FeeClaimed(msg.sender, to, amount);
    }

    function _grossPayout(uint256 stake, uint256 bps) internal pure returns (uint256) {
        return (stake * bps) / 10_000;
    }

    // ── Write: create ─────────────────────────────────────────────────────────
    struct CreateArgs {
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
        address agentOwnerRecipient;
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
        string  calldata inviteKey,
        address          agentOwnerRecipient
    ) external payable whenNotPaused returns (uint256 id) {
        return _createClaim(CreateArgs({
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
            inviteKey:           inviteKey,
            agentOwnerRecipient: agentOwnerRecipient
        }));
    }

    function _createClaim(CreateArgs memory a) internal returns (uint256 id) {
        require(a.stakeAmount >= MIN_STAKE, "Mimir: stake too small");
        require(a.deadline > block.timestamp, "Mimir: deadline in past");
        require(bytes(a.question).length > 0, "Mimir: empty question");
        // A private claim with no key would silently be public (a rematch of a
        // private parent included).
        require(!a.isPrivate || bytes(a.inviteKey).length > 0, "Mimir: private claim needs invite key");
        _pullStake(a.stakeAmount);

        // Normalise odds params
        bool isFixed = _strEq(a.oddsMode, "fixed");
        uint256 payoutBps = isFixed
            ? (a.challengerPayoutBps >= 10_000 ? a.challengerPayoutBps : DEFAULT_PAYOUT_BPS)
            : 0;

        uint256 maxCh = (a.maxChallengers == 0 || a.maxChallengers > MAX_CHALLENGERS)
            ? MAX_CHALLENGERS
            : a.maxChallengers;

        claimCount++;
        id = claimCount;

        claims[id] = Claim({
            creator:                  msg.sender,
            question:                 a.question,
            creatorPosition:          a.creatorPosition,
            counterPosition:          a.counterPosition,
            resolutionUrl:            a.resolutionUrl,
            creatorStake:             a.stakeAmount,
            totalChallengerStake:     0,
            reservedCreatorLiability: 0,
            deadline:                 a.deadline,
            state:                    ST_OPEN,
            winnerSide:               SIDE_NONE,
            resolutionSummary:        "",
            confidence:               0,
            category:                 bytes(a.category).length > 0 ? a.category : "custom",
            parentId:                 a.parentId,
            challengerCount:          0,
            createdAt:                block.timestamp,
            marketType:               bytes(a.marketType).length > 0 ? a.marketType : "binary",
            oddsMode:                 isFixed ? "fixed" : "pool",
            challengerPayoutBps:      payoutBps,
            handicapLine:             a.handicapLine,
            settlementRule:           a.settlementRule,
            maxChallengers:           maxCh,
            isPrivate:                a.isPrivate,
            inviteKeyHash:            bytes(a.inviteKey).length > 0
                                          ? keccak256(bytes(a.inviteKey))
                                          : bytes32(0),
            evidenceHash:             bytes32(0)
        });

        // Freeze the economics: whatever the policy becomes later, this market
        // settles on the terms its participants agreed to.
        claimFeePolicy[id] = feePolicy;

        if (a.agentOwnerRecipient != address(0)) {
            claimAgentOwner[id] = a.agentOwnerRecipient;
            emit AgentAttributed(id, msg.sender, a.agentOwnerRecipient);
        }

        emit ClaimCreated(id, msg.sender, claims[id].category);
    }

    // Rematch: a new claim inheriting fields from a parent. An internal call,
    // so the caller (not this contract) is the creator and pays the stake.
    function createRematch(
        uint256 parentId,
        uint256 deadline,
        uint256 stakeAmount,
        string  calldata inviteKey
    ) external payable whenNotPaused returns (uint256 id) {
        Claim storage parent = claims[parentId];
        require(parent.creator != address(0), "Mimir: parent not found");

        return _createClaim(CreateArgs({
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
            inviteKey:           inviteKey,
            // The parent's agent earned its attribution on the parent's creator;
            // a stranger rematching the claim does not inherit it.
            agentOwnerRecipient: msg.sender == parent.creator ? claimAgentOwner[parentId] : address(0)
        }));
    }

    // ── Write: challenge ──────────────────────────────────────────────────────
    function challengeClaim(
        uint256 claimId,
        uint256 stakeAmount,
        string  calldata inviteKey,
        address agentOwnerRecipient
    ) external payable whenNotPaused {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(claim.state == ST_OPEN || claim.state == ST_ACTIVE, "Mimir: not open");
        require(msg.sender != claim.creator, "Mimir: self-challenge");
        require(!hasChallenged[claimId][msg.sender], "Mimir: already challenged");
        require(claim.challengerCount < claim.maxChallengers, "Mimir: full");
        require(stakeAmount >= MIN_STAKE, "Mimir: stake too small");
        // Anti-sniping: challenges must arrive at least CHALLENGE_LOCK_SECONDS
        // before the deadline so the outcome isn't observable yet.
        require(
            block.timestamp + CHALLENGE_LOCK_SECONDS <= claim.deadline,
            "Mimir: challenge window closed"
        );
        _pullStake(stakeAmount);

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
        _settle(claimId, winnerSide, summary, confidence, evidenceHash);
    }

    /**
     * Escape hatch. If the oracle has not resolved an ACTIVE claim within
     * RESOLUTION_GRACE_SECONDS of its deadline (lost key, custody outage,
     * a settlement that keeps reverting), anyone can refund it: every
     * participant gets their stake back, exactly as an UNRESOLVABLE verdict
     * would pay, and no fee is taken. Without this, the oracle going away
     * would lock every open stake forever.
     */
    function refundExpired(uint256 claimId) external {
        Claim storage claim = claims[claimId];
        require(claim.creator != address(0), "Mimir: claim not found");
        require(claim.state == ST_ACTIVE, "Mimir: not active");
        require(block.timestamp >= claim.deadline + RESOLUTION_GRACE_SECONDS, "Mimir: oracle grace not over");
        emit ClaimExpiredRefund(claimId, msg.sender);
        _settle(claimId, SIDE_UNRESOLVABLE, "Refunded: not resolved within the grace period", 0, bytes32(0));
    }

    function _settle(
        uint256 claimId,
        uint8   winnerSide,
        string memory summary,
        uint8   confidence,
        bytes32 evidenceHash
    ) internal {
        Claim storage claim = claims[claimId];
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
        uint256 held = usdc == address(0)
            ? address(this).balance
            : IERC20Like(usdc).balanceOf(address(this));
        return (claimCount, totalResolved, held);
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
