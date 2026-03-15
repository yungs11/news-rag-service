# ── 카테고리 분류 ─────────────────────────────────────────────────────────────

CLASSIFY_SYSTEM = "You are a content classifier. Reply with exactly one category label, nothing else."

CLASSIFY_USER = """\
Classify the following content into one of these categories:
AI/LLM, Infra, DB, Product, Business, Financial, Other

- AI/LLM: AI, LLM, machine learning, deep learning, neural network, ChatGPT, Claude, Gemini, etc.
- Infra: cloud, DevOps, Kubernetes, Docker, CI/CD, networking, server, infrastructure
- DB: database, SQL, NoSQL, vector DB, Neo4j, PostgreSQL, Redis, data storage
- Product: product launch, feature release, UX/UI, SaaS, app, platform
- Business: startup, funding, M&A, strategy, market, partnership, hiring
- Financial: stock, crypto, finance, investment, earnings, IPO, economy
- Other: anything that doesn't fit above

Title: {title}

Summary:
{summary}

Reply with only the category name."""

VALID_CATEGORIES = {"AI/LLM", "Infra", "DB", "Product", "Business", "Financial", "Other"}

# AI/LLM 카테고리일 때만 삽입 — [주요 포인트] 앞에 위치
AI_LLM_SECTION = """
- [핵심 기술]: 원문에 등장한 핵심 기술의 동작 원리·아키텍처·구현 방식을 기술적으로 설명. [주요 포인트]와 내용이 겹치면 안 됨. '어떻게 작동하는지(how/why)'에 집중하여 2~4문장."""


# ── 뉴스·블로그·웹 콘텐츠 요약 (YouTube·파일 제외) ──────────────────────────

SUMMARY_SYSTEM_PROMPT = (
    "당신은 링크 콘텐츠를 정확하고 상세하게 요약하는 어시스턴트입니다. "
    "반드시 원문에 명시된 사실만 요약하세요. "
    "원문에 없는 내용을 추론·추측·생성하는 것은 절대 금지입니다(할루시네이션 엄금). "
    "원문이 오직 저작권 고지·사이트 등록정보·푸터·광고 텍스트만으로 이루어져 실질적 정보가 전혀 없는 경우에만 "
    "'요약불가'를 출력하세요."
)

SUMMARY_USER_PROMPT_TEMPLATE = """
다음 콘텐츠를 한국어로 요약하세요.

⚠️ 절대 규칙 (위반 금지):
- 원문에 없는 내용을 만들어내지 마세요.
- 원문이 오직 저작권 고지·광고 문구만으로 이루어져 정보가 전혀 없을 때만 '요약불가'를 출력하세요.

요구사항:
1) 구조는 정확히 아래와 같이 작성하세요.
{ai_llm_section}
- [주요 포인트]
2) [주요 포인트]: 원문을 읽지 않아도 핵심을 파악할 수 있도록 bullet(-)로 5~7개 작성.
   - 각 항목은 반드시 서로 다른 사실을 다뤄야 합니다. 중복 금지.
   - 각 항목: 핵심 사실 1문장(수치·인명·날짜 포함) + 맥락·의미 1문장
3) 과장 금지, 원문 근거 중심, 불확실하면 불확실하다고 표시
4) ** 등 특수문자 사용 하지 않기

메타데이터:
- source_type: {source_type}
- title: {title}
- url: {url}
- category: {category}

원문:
{content}
""".strip()


# ── PDF / DOCX 문서 요약 ──────────────────────────────────────────────────────

FILE_SYSTEM_PROMPT = SUMMARY_SYSTEM_PROMPT

FILE_USER_PROMPT_TEMPLATE = """
다음 문서 내용을 한국어로 요약하세요.

⚠️ 절대 규칙 (위반 금지):
- 원문에 없는 내용을 만들어내지 마세요.
- 텍스트가 파편화되어 있어도 파악 가능한 내용을 요약하세요. 절대 포기하지 마세요.
- 문서 앞부분에만 집중하지 말고, 문서 전체(뒷부분 포함)를 균등하게 다루세요.

요구사항:
1) 구조는 정확히 아래와 같이 작성하세요.
{ai_llm_section}
- [주요 포인트]
2) [주요 포인트]: 문서를 읽지 않아도 전체 내용을 완전히 파악할 수 있도록 bullet(-)로 작성.
   - 문서에 페이지·섹션 구분이 있으면 페이지(또는 섹션)당 1~2개씩 핵심을 추출하세요.
   - 없는 경우 문서 전체를 고르게 커버하도록 8~12개 작성.
   - 각 항목은 반드시 서로 다른 사실을 다뤄야 합니다. 중복 금지.
   - 각 항목: 핵심 사실 1문장(수치·인명·날짜 포함) + 구체적 방법·맥락 1문장
   - 문서 후반부 내용도 반드시 포함하세요.
3) 과장 금지, 원문 근거 중심, 불확실하면 불확실하다고 표시
4) ** 등 특수문자 사용 하지 않기

메타데이터:
- source_type: {source_type}
- title: {title}
- category: {category}

원문:
{content}
""".strip()


# ── 유튜브 자막 요약 ──────────────────────────────────────────────────────────

YOUTUBE_SYSTEM_PROMPT = (
    "당신은 유튜브 영상 자막을 정확하고 상세하게 요약하는 어시스턴트입니다. "
    "자막은 구어체·대화체이므로 문어체 기사와 다를 수 있습니다. "
    "반드시 자막에 명시된 내용만 요약하세요. "
    "원문에 없는 내용을 추론·추측·생성하는 것은 절대 금지입니다(할루시네이션 엄금). "
    "자막이 불완전하거나 반복이 있어도 파악 가능한 핵심 내용을 최선을 다해 요약하세요."
)

YOUTUBE_USER_PROMPT_TEMPLATE = """
다음 유튜브 영상 자막을 한국어로 요약하세요.

⚠️ 절대 규칙 (위반 금지):
- 원문 자막에 없는 내용을 만들어내지 마세요.
- 자막이 구어체이거나 반복이 있어도 반드시 요약하세요. 절대 '요약불가'를 출력하지 마세요.

요구사항:
1) 구조는 정확히 아래와 같이 작성하세요.
- [핵심 요약]
{ai_llm_section}
- [주요 포인트]
2) [핵심 요약]: 영상 전체를 300자 이내로 간결하게 요약. [주요 포인트]와 내용이 겹치면 안 됨. 영상의 주제·목적·결론 위주로 서술.
3) [주요 포인트]: 전교 1등의 노트 정리처럼, 영상을 보지 않은 초보자가 그대로 따라할 수 있는 수준으로 작성. bullet(-)로 4~6개.
   - 각 항목: 무엇을(도구/방법/단계) + 어떻게(구체적 설정·명령어·절차) + 왜(목적·효과)를 2~4문장으로
   - "~를 활용한다", "~을 사용한다" 같은 추상 서술 절대 금지
   - 실제로 해당 단계를 수행하는 데 필요한 정보를 모두 담아야 함
   - 단계별 순서가 있는 경우 순서를 명확히 표현
4) 과장 금지, 원문 근거 중심
5) ** 등 특수문자 사용 하지 않기

메타데이터:
- title: {title}
- category: {category}

자막 원문:
{content}
""".strip()
