"use client";

const SECTION_STYLES: Record<string, { badge: string; border: string }> = {
  "핵심 요약":   { badge: "bg-blue-100 text-blue-700",   border: "border-blue-100" },
  "핵심 기술":   { badge: "bg-purple-100 text-purple-700", border: "border-purple-100" },
  "주요 포인트": { badge: "bg-indigo-100 text-indigo-700", border: "border-indigo-100" },
};

const DEFAULT_STYLE = { badge: "bg-gray-100 text-gray-600", border: "border-gray-100" };

function getStyle(name: string) {
  return SECTION_STYLES[name] ?? DEFAULT_STYLE;
}

interface Section {
  name: string;
  lines: string[];
}

function parse(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    // "- [섹션명]" 또는 "- [섹션명]: 인라인내용" 모두 섹션 헤더로 인식
    const sectionMatch = line.match(/^-?\s*\[(.+?)\](?:\s*[：:]\s*(.+))?$/);
    if (sectionMatch) {
      if (current) sections.push(current);
      current = { name: sectionMatch[1], lines: [] };
      // 콜론 뒤 인라인 내용이 있으면 섹션 첫 줄로 추가
      if (sectionMatch[2]) current.lines.push(sectionMatch[2]);
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function renderLines(lines: string[]) {
  if (lines.every((l) => !l.trim())) return null;

  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ol" | "ul" | null = null;

  const flushList = () => {
    if (listItems.length === 0) return;
    if (listType === "ol") {
      elements.push(
        <ol key={elements.length} className="list-decimal list-inside space-y-1.5 text-sm text-gray-700 leading-relaxed break-words">
          {listItems.map((item, i) => <li key={i}>{item}</li>)}
        </ol>
      );
    } else {
      elements.push(
        <ul key={elements.length} className="space-y-1.5 text-sm text-gray-700 leading-relaxed break-words">
          {listItems.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      );
    }
    listItems = [];
    listType = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const numberedMatch = trimmed.match(/^\d+[\.\)]\s+(.+)/);
    const bulletMatch = trimmed.match(/^[-•]\s+(.+)/);

    if (!trimmed) {
      // 빈 줄: 현재 목록 flush, 단락 구분
      flushList();
    } else if (numberedMatch) {
      if (listType === "ul") flushList();
      listType = "ol";
      listItems.push(numberedMatch[1]);
    } else if (bulletMatch) {
      if (listType === "ol") flushList();
      listType = "ul";
      listItems.push(bulletMatch[1]);
    } else {
      flushList();
      elements.push(
        <p key={elements.length} className="text-sm text-gray-700 leading-relaxed break-words">{trimmed}</p>
      );
    }
  }
  flushList();
  return elements.length > 0 ? elements : null;
}

export default function SummaryRenderer({ text }: { text: string | null | undefined }) {
  if (!text) return null;

  const sections = parse(text);

  // 섹션 마커가 없는 legacy 텍스트는 그냥 표시
  if (sections.length === 0) {
    return <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">{text}</p>;
  }

  return (
    <div className="space-y-4">
      {sections.map((section, i) => {
        const style = getStyle(section.name);
        const content = renderLines(section.lines);
        return (
          <div key={i} className={`rounded-xl border p-4 space-y-2 ${style.border} bg-white`}>
            <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${style.badge}`}>
              {section.name}
            </span>
            <div className="space-y-2">{content}</div>
          </div>
        );
      })}
    </div>
  );
}
