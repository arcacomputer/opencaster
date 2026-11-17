#!/bin/bash
# Compact UI-test failure summary for CI logs and artifacts.
# Usage: ui-test-summary.sh <path-to.xcresult>
set -u

XCRESULT="${1:?usage: ui-test-summary.sh <path-to.xcresult>}"

if [ ! -d "$XCRESULT" ]; then
    echo "No xcresult at $XCRESULT — the test run did not produce results."
    exit 0
fi

TMPJSON=$(mktemp /tmp/ui-test-summary.XXXXXX.json)
trap 'rm -f "$TMPJSON"' EXIT

# Xcode 16+ supports `get test-results tests`; older xcresulttool needs the
# legacy ActionsInvocationRecord JSON. Try the new API first, then legacy.
if xcrun xcresulttool get test-results tests --path "$XCRESULT" > "$TMPJSON" 2>/dev/null; then
    MODE=tests
elif xcrun xcresulttool get --format json --path "$XCRESULT" --legacy > "$TMPJSON" 2>/dev/null \
  || xcrun xcresulttool get --format json --path "$XCRESULT" > "$TMPJSON" 2>/dev/null; then
    MODE=legacy
else
    echo "xcresulttool could not read $XCRESULT."
    exit 0
fi

MODE="$MODE" python3 - "$TMPJSON" <<'PY'
import json, os, sys

try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception as e:
    print(f"Could not parse xcresult JSON: {e}")
    sys.exit(0)

failures = []
counts = {"Failed": 0, "Passed": 0, "Skipped": 0}

if os.environ.get("MODE") == "tests":
    def walk(node):
        result = node.get("result")
        if result in counts and node.get("nodeType") in ("Test Case", "Test"):
            counts[result] += 1
        if result == "Failed":
            name = node.get("name", "?")
            details = node.get("details") or node.get("resultDetails") or ""
            failures.append((name, details))
        for child in node.get("children") or []:
            walk(child)
    for node in data.get("testNodes", []):
        walk(node)
    print(f"macOS UI tests: {counts['Passed']} passed, {counts['Failed']} failed, {counts['Skipped']} skipped")
    for name, details in failures:
        print(f"FAILED {name}")
        if details:
            print("  " + details.replace("\n", "\n  "))
else:
    issues = data.get("issues") or {}
    for t in issues.get("testFailureSummaries") or []:
        failures.append((t.get("testCaseName", "?"), t.get("message", "")))
    if failures:
        print(f"macOS UI tests: {len(failures)} failing test(s)")
        for name, msg in failures:
            print(f"FAILED {name}")
            if msg:
                print("  " + str(msg).replace("\n", "\n  "))
    else:
        print("macOS UI tests: no test failures recorded in xcresult.")

if not failures:
    print("If the run still failed, the build itself may have failed — check the xcodebuild log.")
PY
