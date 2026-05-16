---
name: clean-tests
description: Use when improving or reviewing Python tests around an existing feature or bug. Focus on speed, boundary coverage, and clear test structure rather than test workflow orchestration.
---

# Clean Tests

## In This Repo

- Use this skill to improve the shape and quality of Python tests.
- Use `direct-tests` for fast GenLayer contract tests and `integration-tests` for environment-sensitive flows.
- This skill complements those workflows by improving coverage, clarity, and failure isolation.

## T1: Test Everything That Could Break

Use coverage as a guide, not a goal, and do not stop at the happy path.

```python
# Bad
def test_divide():
    assert divide(10, 2) == 5

# Good
def test_divide_normal():
    assert divide(10, 2) == 5

def test_divide_by_zero():
    with pytest.raises(ZeroDivisionError):
        divide(10, 0)

def test_divide_negative():
    assert divide(-10, 2) == -5
```

## T2: Use Coverage Tools

```bash
pytest --cov=myproject --cov-report=term-missing
```

Aim for meaningful coverage, not vanity metrics.

## T3: Do Not Skip Trivial Tests

Trivial tests often document expected behavior and catch regressions cheaply.

## T4: An Ignored Test Signals Ambiguity

Do not hide real problems behind casual skips.

```python
# Bad
@pytest.mark.skip(reason="flaky, fix later")
def test_async_operation():
    ...
```

## T5: Test Boundary Conditions

Bugs congregate at edges. Test the first, last, empty, invalid, and off-by-one cases.

```python
def test_pagination_boundaries():
    items = list(range(100))

    assert paginate(items, page=1, size=10) == items[0:10]
    assert paginate(items, page=10, size=10) == items[90:100]
    assert paginate(items, page=11, size=10) == []

    with pytest.raises(ValueError):
        paginate(items, page=0, size=10)

    assert paginate([], page=1, size=10) == []
```

## T6: Test Near The Bug

When you fix a bug, add tests for nearby cases. Bugs cluster.

## T7: Failure Patterns Matter

If a whole class of tests fails in similar ways, the deeper design may be the issue.

## T8: Coverage Patterns Matter

Untested code paths often point to awkward design or missing seams.

## T9: Tests Should Be Fast

Slow tests get skipped. Keep unit tests cheap and deterministic when possible.

```python
# Bad
def test_user_creation():
    db = connect_to_database()
    user = db.create_user("Alice")
    assert user.name == "Alice"

# Good
def test_user_creation():
    db = InMemoryDatabase()
    user = db.create_user("Alice")
    assert user.name == "Alice"
```

## Organization Rules

- Fast
- Independent
- Repeatable
- Self-validating
- Timely

Prefer one concept per test unless a compact table-driven shape is clearly better.
