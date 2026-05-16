---
name: clean-names
description: Use when renaming or reviewing Python variables, functions, classes, or modules for clarity. Focus on descriptive, unambiguous names during refactors and code review.
---

# Clean Names

## In This Repo

- Use this skill when naming is the main readability problem in a Python change.
- Prefer safe renames with clear intent over speculative terminology churn.
- Keep names aligned with the domain language already used in the surrounding code.

## N1: Choose Descriptive Names

Names should reveal intent. If a name needs a comment, it usually does not reveal enough.

```python
# Bad
d = 86400

# Good
SECONDS_PER_DAY = 86400

# Bad
def proc(lst):
    return [x for x in lst if x > 0]

# Good
def filter_positive_numbers(numbers):
    return [n for n in numbers if n > 0]
```

## N2: Choose Names At The Right Level Of Abstraction

```python
# Bad
def get_dict_of_user_ids_to_names():
    ...

# Good
def get_user_directory():
    ...
```

## N3: Use Standard Nomenclature

Use domain terms, design-pattern names, and conventional vocabulary where they fit.

```python
class UserFactory:
    def create(self, data):
        ...

def calculate_amortization(principal, rate, term):
    ...
```

## N4: Prefer Unambiguous Names

```python
# Bad
def rename(old, new):
    ...

# Good
def rename_file(old_path: Path, new_path: Path):
    ...
```

## N5: Match Name Length To Scope

Short names are acceptable in tiny scopes. Larger scopes need more descriptive names.

```python
total = sum(x for x in numbers)
MAX_RETRY_ATTEMPTS_BEFORE_FAILURE = 5
```

## N6: Avoid Encodings

```python
# Bad
str_name = "Alice"
lst_users = []
i_count = 0

# Good
name = "Alice"
users = []
count = 0
```

## N7: Names Should Describe Side Effects

```python
# Bad
def get_config():
    if not config_path.exists():
        config_path.write_text("{}")
    return json.loads(config_path.read_text())

# Good
def get_or_create_config():
    if not config_path.exists():
        config_path.write_text("{}")
    return json.loads(config_path.read_text())
```
