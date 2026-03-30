#!/bin/bash
# keep-alive.sh — Ping HomeBrain backend every 15 seconds to prevent cold starts
# Usage: nohup ./keep-alive.sh &

URL="https://homebrain.onrender.com/healthz"

while true; do
  curl -s -o /dev/null -w "%{http_code}" "$URL" | xargs -I {} echo "$(date '+%H:%M:%S') → {}"
  sleep 15
done
