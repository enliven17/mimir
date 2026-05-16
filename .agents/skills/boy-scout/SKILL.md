---
name: boy-scout
description: Use when making small or medium Python edits and you want proportional cleanup while touching existing code. Focus on low-risk refactors, naming, comments, and dead code cleanup during existing work.
---

# The Boy Scout Rule

> "Always leave the campground cleaner than you found it."
> - Robert Baden-Powell

> "Always check a module in cleaner than when you checked it out."
> - Robert C. Martin, *Clean Code*

## In This Repo

- Keep cleanup proportional to the task at hand.
- Respect the dirty worktree. Do not revert or rewrite unrelated user changes.
- Use this skill for incremental hygiene while touching existing Python files, not for broad rewrites.
- If the task is new GenLayer contract design or a major contract refactor, let `write-contract` lead.

## The Philosophy

You do not have to make every module perfect. You simply have to make it a little better than when you found it.

When touching existing Python code, look for at least one cleanup that is low-risk and clearly beneficial.

## Quick Wins

- Rename a poorly named variable or helper -> use `clean-names`
- Delete a redundant or stale comment -> use `clean-comments`
- Remove dead code or unused imports
- Replace a magic number with a named constant
- Extract a deeply nested block into a well-named function -> use `clean-functions`

## Deeper Improvements

- Split a function that is doing more than one thing
- Remove obvious duplication -> use `clean-general`
- Add missing boundary checks
- Improve Python test quality around the touched behavior -> use `clean-tests`

## The Rule In Practice

```python
# You are asked to fix a bug in this function.
def proc(d, x, flag=False):
    # process data
    for i in d:
        if i > 0:
            if flag:
                x.append(i * 1.0825)  # tax
            else:
                x.append(i)
    return x

# Do not just fix the bug and leave.
TAX_RATE = 0.0825

def process_positive_values(values: list[float], apply_tax: bool = False) -> list[float]:
    """Filter positive values and optionally apply tax."""
    rate = 1 + TAX_RATE if apply_tax else 1
    return [value * rate for value in values if value > 0]
```

## What Changed

- Descriptive function name
- Clearer parameter names
- Named constant for the magic number
- A docstring that adds value

## Skill Coordination

This skill is an orchestrator for small improvements:

- `python-clean-code` for broader Python refactors or clean-code review
- `clean-names` for naming and renaming
- `clean-comments` for comments and docstrings
- `clean-functions` for function structure
- `clean-general` for DRY, intent, and abstraction issues
- `clean-tests` for Python test quality

## AI Behavior

When using this skill:

1. Complete the requested task first.
2. Identify at least one proportional cleanup opportunity.
3. Prefer focused improvements over unrelated rewrites.
4. Mention the extra cleanup briefly in the final summary.

Every piece of code you touch should leave a little cleaner than before.
