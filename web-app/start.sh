#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/home/haymaker/.nvm/versions/node/v22.22.1/bin:$PATH"
LOG_FILE="/tmp/web-app.log"

# 기존 프로세스 종료 (ss 사용 - lsof는 타 사용자 프로세스 조회 권한 없음)
PID=$(ss -tlnp | grep ':3000' | grep -oP 'pid=\K[0-9]+' | head -1 || true)
if [ -n "$PID" ]; then
  echo "기존 web-app(PID=$PID) 종료 중..."
  kill "$PID"
  sleep 2
fi

echo "web-app 빌드 중..."
npm run build

echo "web-app 시작 중 (port 3000)..."
nohup npm start -- -p 3000 > "$LOG_FILE" 2>&1 &
echo "PID: $!"

# 헬스체크
for i in {1..15}; do
  sleep 1
  if curl -sf http://localhost:3000/ > /dev/null 2>&1; then
    echo "web-app 정상 기동 완료"
    exit 0
  fi
done

echo "web-app 기동 실패. 로그: $LOG_FILE"
exit 1
