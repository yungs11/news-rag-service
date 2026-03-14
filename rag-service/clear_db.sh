#!/usr/bin/env bash
# Neo4j 전체 데이터 초기화 스크립트
# .env 파일에서 접속 정보를 읽어옵니다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# .env 파일에서 Neo4j 접속 정보 로드
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | grep -E '^NEO4J_' | xargs)
fi

NEO4J_URI="${NEO4J_URI:-bolt://localhost:7687}"
NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-localpassword}"
CONTAINER="${NEO4J_CONTAINER:-rag-service-neo4j-1}"

echo "=== Neo4j 데이터 초기화 ==="
echo "컨테이너 : $CONTAINER"
echo "URI      : $NEO4J_URI"
echo "User     : $NEO4J_USER"
echo ""

# Docker 컨테이너 실행 확인
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
    echo "[ERROR] Neo4j 컨테이너가 실행 중이지 않습니다: $CONTAINER"
    exit 1
fi

read -r -p "⚠️  모든 노드와 관계를 삭제합니다. 계속하시겠습니까? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "취소되었습니다."
    exit 0
fi

echo ""
echo "삭제 중..."

docker exec "$CONTAINER" \
    cypher-shell \
        -u "$NEO4J_USER" \
        -p "$NEO4J_PASSWORD" \
        "MATCH (n) DETACH DELETE n"

# 남은 노드 수 확인
REMAINING=$(docker exec "$CONTAINER" \
    cypher-shell \
        -u "$NEO4J_USER" \
        -p "$NEO4J_PASSWORD" \
        --format plain \
        "MATCH (n) RETURN count(n) AS remaining" \
    | tail -1)

echo ""
echo "✅ 초기화 완료 — 남은 노드: ${REMAINING}"
