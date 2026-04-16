#!/bin/bash
# guard-main.sh
# PreToolUse hook — blocks git push, git merge, branch switches to main,
# commits on main, and deploy commands by default.
#
# Bypass: prefix the command with the appropriate approval env var.
# Approval flags (must appear before the guarded command in the string):
#
#   CLAUDE_APPROVED_PUSH=1    → allows: git push
#   CLAUDE_APPROVED_MERGE=1   → allows: git merge, git checkout main, git switch main
#   CLAUDE_APPROVED_DEPLOY=1  → allows: vercel deploy, npm/yarn/pnpm run deploy
#
# Commits on main are NEVER bypassable — always an error.
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

# ── git push ─────────────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE '(^|[;&|] *)git push'; then
  # Allow only when the approval flag precedes git push in the command
  if echo "$COMMAND" | grep -qE 'CLAUDE_APPROVED_PUSH=1.*git push'; then
    exit 0
  fi
  echo "BLOCKED by guard-main hook: 'git push' requires explicit user approval in chat."
  echo "Once the user approves, run: CLAUDE_APPROVED_PUSH=1 git push ..."
  exit 2
fi

# ── git merge ─────────────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE '(^|[;&|] *)git merge'; then
  # Allow only when the approval flag precedes git merge in the command
  if echo "$COMMAND" | grep -qE 'CLAUDE_APPROVED_MERGE=1.*git merge'; then
    exit 0
  fi
  echo "BLOCKED by guard-main hook: 'git merge' requires explicit user approval in chat."
  echo "Once the user approves, run: CLAUDE_APPROVED_MERGE=1 git merge ..."
  exit 2
fi

# ── switching to main ─────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qE '(^|[;&|] *)(git checkout|git switch) (main|master)'; then
  # Allow only when the merge approval flag precedes the checkout in the command
  if echo "$COMMAND" | grep -qE 'CLAUDE_APPROVED_MERGE=1.*(git checkout|git switch) (main|master)'; then
    exit 0
  fi
  echo "BLOCKED by guard-main hook: Switching to 'main' requires explicit user approval in chat."
  echo "Once the user approves, run: CLAUDE_APPROVED_MERGE=1 git checkout main"
  exit 2
fi

# ── direct commit to main (never bypassable) ──────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  if echo "$COMMAND" | grep -qE '(^|[;&|] *)git commit'; then
    echo "BLOCKED by guard-main hook: You are on '$CURRENT_BRANCH'. Committing directly to main is not allowed."
    echo "Switch to a feature branch before committing. This block cannot be bypassed."
    exit 2
  fi
fi

# ── deploy commands ───────────────────────────────────────────────────────────
if echo "$COMMAND" | grep -qiE '(^|[;&|] *)(vercel( deploy| --prod)?|npm run deploy|yarn deploy|pnpm deploy)'; then
  # Allow only when the approval flag precedes the deploy command
  if echo "$COMMAND" | grep -qiE 'CLAUDE_APPROVED_DEPLOY=1.*(vercel( deploy| --prod)?|npm run deploy|yarn deploy|pnpm deploy)'; then
    exit 0
  fi
  echo "BLOCKED by guard-main hook: Deploy commands require explicit user approval in chat."
  echo "Once the user approves, run: CLAUDE_APPROVED_DEPLOY=1 vercel deploy ..."
  exit 2
fi

exit 0
