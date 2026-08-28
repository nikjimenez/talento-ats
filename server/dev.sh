#!/usr/bin/env bash
# Arranca los dos servicios en desarrollo: Node y el extractor Python.
# Ctrl-C detiene ambos.

set -euo pipefail
cd "$(dirname "$0")"

limpiar() { kill 0 2>/dev/null || true; }
trap limpiar EXIT INT TERM

if [ ! -d extractor/.venv ]; then
  echo "→ creando entorno virtual del extractor"
  python3 -m venv extractor/.venv
  extractor/.venv/bin/pip install -q -r extractor/requirements.txt
fi

echo "→ extractor Python  http://127.0.0.1:8100"
extractor/.venv/bin/uvicorn extractor:app \
  --app-dir extractor --host 127.0.0.1 --port 8100 --log-level warning &

sleep 1
echo "→ servidor Node     http://localhost:3000"
node --watch index.js &

wait
