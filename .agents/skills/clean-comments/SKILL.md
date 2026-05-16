---
name: clean-comments
description: Use when cleaning up, reviewing, or rewriting Python comments and docstrings. Focus on removing stale or redundant comments and keeping the remaining ones accurate and useful.
---

# Clean Comments

## In This Repo

- Use this skill for focused comment or docstring cleanup in Python files.
- Prefer improving code clarity before adding explanatory comments.
- Keep comments accurate when touching contract or test behavior.

## C1: No Inappropriate Information

Comments should not hold metadata. Use Git for author names, change history, ticket numbers, and dates.

## C2: Delete Obsolete Comments

If a comment describes code that no longer exists or no longer behaves that way, delete it immediately.

Stale comments become floating islands of irrelevance and misdirection.

## C3: No Redundant Comments

```python
# Bad - the code already says this
i += 1  # increment i
user.save()  # save the user

# Good - explains why, not what
i += 1  # compensate for zero-indexing in display
```

## C4: Write Comments Well

If a comment is worth writing:

- choose words carefully
- use correct grammar
- do not ramble
- do not restate the obvious
- keep it brief

## C5: Never Commit Commented-Out Code

```python
# Delete this instead of keeping it around:
# def old_calculate_tax(income):
#     return income * 0.15
```

Git remembers everything. The file does not need to.

## The Goal

The best comment is often better code. If a comment is only explaining what the code does, refactor first and comment last.
