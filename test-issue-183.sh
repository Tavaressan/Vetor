#!/bin/bash
set -e
FAIL_COUNT=0
echo "Test 1: Checking for AI disclaimer in code-review.md template..."
if grep -q "🤖\|Gerado por" agents/code-review.md; then
    echo "✓ AI disclaimer found"
else
    echo "✗ FAIL: AI disclaimer not found"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo "Test 2: Checking for mandatory command citation..."
if grep -q "comando.*exato\|command.*exact" skills/backlog-ideator/SKILL.md; then
    echo "✓ Mandatory command citation found"
else
    echo "✗ FAIL: Mandatory command citation not found"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi
exit $FAIL_COUNT
