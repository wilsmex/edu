#!/bin/bash

# Simple HTTP server script for macOS/Linux
# Usage: ./start-server.sh

PORT=${1:-8000}

echo "Starting local web server on port $PORT..."
echo "Open http://localhost:$PORT in your browser"
echo "Press Ctrl+C to stop the server"
echo ""

python3 -m http.server $PORT 2>/dev/null || python -m http.server $PORT

