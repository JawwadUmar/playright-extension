"""Check copied expressions without requiring the Python Playwright package."""
import ast
import json
import sys

expressions = json.load(sys.stdin)
for expression in expressions:
    ast.parse(expression, mode="eval")
print(f"{len(expressions)} Python locator expressions parsed successfully.")
