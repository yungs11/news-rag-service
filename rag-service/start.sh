#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="/tmp/rag-service.log"

# 기존 프로세스 종료
PID=$(lsof -ti:8000 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "기존 rag-service(PID=$PID) 종료 중..."
  kill "$PID"
  sleep 1
fi

echo "rag-service 시작 중 (port 8000)..."
nohup .venv/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > "$LOG_FILE" 2>&1 &
echo "PID: $!"

# 헬스체크
for i in {1..10}; do
  sleep 1
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "rag-service 정상 기동 완료"
    exit 0
  fi
done

echo "rag-service 기동 실패. 로그: $LOG_FILE"
exit 1
