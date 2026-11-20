#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
langgraph_dir="$project_dir/langgraph-acp"

if [ ! -d "$langgraph_dir/node_modules" ]; then
  echo "langgraph-acp dependencies are not installed; run npm install in langgraph-acp" >&2
  exit 1
fi

(cd "$langgraph_dir" && npm run typecheck && npm test)

if [ -f "$project_dir/pipecat-edge/function/bot.py" ]; then
  python3 -m py_compile "$project_dir/pipecat-edge/function/bot.py"
  echo "Pipecat function/bot.py compiles without modification."
else
  echo "Pipecat source is not present; LangGraph checks passed, Pipecat checks skipped." >&2
fi

