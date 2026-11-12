#!/usr/bin/env python3
"""Find unclosed braces in App.jsx"""

path = r'c:\Users\carol\Desktop\AGRICONNECT\agriconnect\frontend\src\App.jsx'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

depth = 0
last_open_line = 0
for i, line in enumerate(lines, 1):
    # Skip JSX string content roughly - only count top-level braces
    for ch in line:
        if ch == '{':
            depth += 1
            last_open_line = i
        elif ch == '}':
            depth -= 1

print(f"Final depth: {depth}")
print(f"Last open brace on line: {last_open_line}")
print(f"Total lines: {len(lines)}")
print(f"Last 5 lines:")
for l in lines[-5:]:
    print(repr(l))
