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
    const sectionMatch = line.match(/^-?\s*\[(.+?)\]\s*$/);
    if (sectionMatch) {
      if (current) sections.push(current);
      current = { name: sectionMatch[1], lines: [] };
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
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;

  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ol" | "ul" | null = null;

  const flushList = () => {
    if (listItems.length === 0) return;
    if (listType === "ol") {
      elements.push(
        <ol key={elements.length} className="list-decimal list-inside space-y-1.5 text-sm text-gray-700 leading-relaxed">
          {listItems.map((item, i) => <li key={i}>{item}</li>)}
        </ol>
      );
    } else {
      elements.push(
        <ul key={elements.length} className="space-y-1.5 text-sm text-gray-700 leading-relaxed">
          {listItems.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    }
    listItems = [];
    listType = null;
  };

  for (const line of trimmed) {
    const numberedMatch = line.match(/^\d+[\.\)]\s+(.+)/);
    const bulletMatch = line.match(/^[-•]\s+(.+)/);

    if (numberedMatch) {
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
        <p key={elements.length} className="text-sm text-gray-700 leading-relaxed">{line}</p>
      );
    }
  }
  flushList();
  return elements;
}

export default function SummaryRenderer({ text }: { text: string | null | undefined }) {
  if (!text) return null;

  const sections = parse(text);

  // 섹션 마커가 없는 legacy 텍스트는 그냥 표시
  if (sections.length === 0) {
    return <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{text}</p>;
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
