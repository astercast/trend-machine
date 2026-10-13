#!/usr/bin/env bash
# Launcher for the Resolution Night detached executor (rotation 17).
# setsid pattern: the runner survives this shell and any exec session.
# Writes the PID file, then the CALLER must verify kill -0 <pid>.
STATE="/home/hatch/workspace/fleet-ops/trend-resolution"
mkdir -p "$STATE/runs"
if [ -f "$STATE/executor.pid" ] && kill -0 "$(cat "$STATE/executor.pid")" 2>/dev/null; then
  echo "already running pid=$(cat "$STATE/executor.pid")"; exit 0
fi
setsid nohup bash /home/hatch/workspace/trend-machine/hidden_files/resolution_executor/runner.sh \
  >> "$STATE/launcher.log" 2>&1 < /dev/null &
echo $! > "$STATE/executor.pid"
echo "launched pid=$!"
