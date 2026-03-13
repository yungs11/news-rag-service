# news-rag-db

AI Architect 지식베이스 - RAG 서비스 + 반응형 웹앱

## 구조

```
news-rag-db/
├── rag-service/    # FastAPI + Neo4j GraphRAG 백엔드
└── web-app/        # Next.js 반응형 웹앱
```

## rag-service

### 실행
```bash
cd rag-service
pip install -r requirements.txt
cp .env.example .env   # 환경변수 입력
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 주요 환경변수
- `NEO4J_URI` — Neo4j Bolt URI (AuraDB: `neo4j+s://...`)
- `NEO4J_USER` / `NEO4J_PASSWORD`
- `OPENAI_API_KEY` — 임베딩 생성 (text-embedding-3-small)
- `OPENROUTER_API_KEY` — RAG 답변 생성 LLM

### API 엔드포인트
| Method | Path | 설명 |
|--------|------|------|
| POST | `/ingest` | 요약 문서 저장 (카카오봇 → 호출) |
| POST | `/search` | 하이브리드 검색 (벡터 + FTS) |
| POST | `/ask` | RAG 질의응답 |
| GET | `/documents/recent` | 최근 문서 목록 |
| GET | `/documents/categories` | 카테고리별 문서 수 |
| GET | `/documents/{id}` | 문서 상세 (공유 페이지용) |
| GET | `/health` | 헬스체크 |

### 로컬 Neo4j (개발용)
```bash
cd rag-service
docker-compose up -d
# NEO4J_URI=bolt://localhost:7687
# NEO4J_PASSWORD=localpassword
```

## web-app

### 실행
```bash
cd web-app
npm install
cp .env.local.example .env.local   # RAG_SERVICE_URL 설정
npm run dev
```

### 페이지
- `/` — 문서 목록 + 키워드 검색 + 카테고리 필터
- `/chat` — 지식베이스 챗봇
- `/share/[id]` — 문서 공유 페이지 (SEO 가능)

## 데이터 흐름

```
카카오봇 (요약 완료)
    └─ POST /ingest ──→ rag-service
                             ├─ 청킹 + 임베딩 생성
                             └─ Neo4j 저장
                                  ├─ Document 노드
                                  ├─ Chunk 노드 (+ embedding)
                                  └─ HAS_CHUNK 관계

웹앱 (챗봇 질문)
    └─ POST /ask ──→ rag-service
                          ├─ 쿼리 임베딩
                          ├─ 벡터 검색 + FTS 검색 (RRF 병합)
                          └─ LLM 답변 생성
```
