#!/bin/bash
# guard-main.sh
# PreToolUse hook — blocks git push, git merge into main, branch switches to
# main, and deploy commands. Claude must stop and ask the user explicitly.
#
# Exit 0  → allow
# Exit 2  → block (stdout is shown to Claude as the reason)

INPUT=$(cat)

# Extract the bash command from the JSON payload.
# Tries jq first, falls back to python3.
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
else
  COMMAND=$(echo "$INPUT" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" \
    2>/dev/null)
fi

# ── git push (any form) ──────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE '(^|[;&|] *)git push'; then
  echo "BLOCKED by guard-main hook: 'git push' requires explicit user approval."
  echo "Stop and ask the user: 'Do you want me to push? If yes, which branch?'"
  exit 2
fi

# ── git merge (any branch into main, or merging main) ───────────────────────
if echo "$COMMAND" | grep -qE '(^|[;&|] *)git merge'; then
  echo "BLOCKED by guard-main hook: 'git merge' requires explicit user approval."
  echo "Stop and ask the user before merging. Explain what would be merged and into which branch."
  exit 2
fi

# ── switching to main ────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE '(^|[;&|] *)(git checkout|git switch) (main|master)'; then
  echo "BLOCKED by guard-main hook: Switching to 'main' requires explicit user approval."
  echo "Stop and ask the user before checking out main."
  exit 2
fi

# ── direct commit to main (e.g. after accidental checkout) ──────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  if echo "$COMMAND" | grep -qE '(^|[;&|] *)git commit'; then
    echo "BLOCKED by guard-main hook: You are on '$CURRENT_BRANCH'. Committing directly to main is not allowed."
    echo "Stop and ask the user to confirm the intended branch before committing."
    exit 2
  fi
fi

# ── deploy commands ──────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qiE '(^|[;&|] *)(vercel( deploy| --prod)?|npm run deploy|yarn deploy|pnpm deploy)'; then
  echo "BLOCKED by guard-main hook: Deploy commands require explicit user approval."
  echo "Stop and ask the user: 'Do you want me to deploy? To which environment?'"
  exit 2
fi

exit 0
