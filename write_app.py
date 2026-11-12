#!/usr/bin/env python3
"""Write a clean App.jsx by reading the current file and replacing corrupted sections."""
import re

src = r'c:\Users\carol\Desktop\AGRICONNECT\agriconnect\frontend\src\App.jsx'

with open(src, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# The top of the file (imports, config, context, App root, AuthScreen, icons, HeroHeader, ProfileModal)
# is structurally intact through roughly the ProfileModal end.
# We'll keep everything up to the start of TransporterView, then replace everything after.

# Find the cut point: just before // TRANSPORTER VIEW
cut_marker = '// ==========================================\n// TRANSPORTER VIEW'
cut_pos = content.find(cut_marker)
if cut_pos == -1:
    cut_marker = '// TRANSPORTER VIEW'
    cut_pos = content.find(cut_marker)
    # back up to the === line
    cut_pos = content.rfind('//', 0, cut_pos)
    cut_pos = content.rfind('\n', 0, cut_pos) + 1

print(f"Cut position: {cut_pos}, total length: {len(content)}")
top = content[:cut_pos]

# Count braces in top to understand depth
opens_top = top.count('{')
closes_top = top.count('}')
print(f"Top section: {opens_top} opens, {closes_top} closes, depth={opens_top-closes_top}")
print(f"Top ends with: {repr(top[-100:])}")
