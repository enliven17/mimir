---
name: clean-general
description: Use when reviewing or refactoring Python code for duplication, obscured intent, magic numbers, abstraction problems, or avoidable conditionals. Keep the focus on core code-quality issues.
---

# General Clean Code Principles

## In This Repo

- Use this skill for focused Python cleanup and review work.
- Prefer small, high-signal improvements over sweeping rewrites.
- Apply these principles inside the current repo style instead of forcing a brand-new architecture.

## Critical Rules

### G5: DRY

Every piece of knowledge should have one authoritative representation.

```python
# Bad
tax_rate = 0.0825
ca_total = subtotal * 1.0825
ny_total = subtotal * 1.07

# Good
TAX_RATES = {"CA": 0.0825, "NY": 0.07}

def calculate_total(subtotal: float, state: str) -> float:
    return subtotal * (1 + TAX_RATES[state])
```

### G16: No Obscured Intent

Do not be clever when clarity will do.

```python
# Bad
return (x & 0x0F) << 4 | (y & 0x0F)

# Good
return pack_coordinates(x, y)
```

### G23: Prefer Polymorphism To If/Else

```python
# Bad
def calculate_pay(employee):
    if employee.type == "SALARIED":
        return employee.salary
    elif employee.type == "HOURLY":
        return employee.hours * employee.rate
    elif employee.type == "COMMISSIONED":
        return employee.base + employee.commission

# Good
class SalariedEmployee:
    def calculate_pay(self):
        return self.salary

class HourlyEmployee:
    def calculate_pay(self):
        return self.hours * self.rate

class CommissionedEmployee:
    def calculate_pay(self):
        return self.base + self.commission
```

### G25: Replace Magic Numbers With Named Constants

```python
# Bad
if elapsed_time > 86400:
    ...

# Good
SECONDS_PER_DAY = 86400
if elapsed_time > SECONDS_PER_DAY:
    ...
```

### G30: Functions Should Do One Thing

If you can extract another coherent function, the current function may be doing too much.

### G36: Avoid Train Wrecks

```python
# Bad
output_dir = context.options.scratch_dir.absolute_path

# Good
output_dir = context.get_scratch_dir()
```

## Review Checklist

When reviewing Python code, check for:

- obvious duplication
- obscured intent
- magic numbers
- conditionals that want a better shape
- functions mixing multiple responsibilities
- Law of Demeter violations
- missing boundary handling
- dead code or clutter
