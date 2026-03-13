import { api } from "@/lib/api";
import type { Metadata } from "next";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const doc = await api.getDocument(params.id);
    return { title: doc.title, description: doc.summary_text.slice(0, 160) };
  } catch {
    return { title: "Document not found" };
  }
}

export default async function SharePage({ params }: Props) {
  let doc;
  try {
    doc = await api.getDocument(params.id);
  } catch {
    return (
      <div className="text-center py-20 text-gray-400">
        문서를 찾을 수 없습니다.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4 flex gap-2 items-center">
        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded font-medium">
          {doc.category}
        </span>
        <span className="text-xs text-gray-400">{doc.source_type}</span>
        {doc.summary_date && (
          <span className="text-xs text-gray-400">{doc.summary_date}</span>
        )}
      </div>

      <h1 className="text-xl font-bold mb-2">{doc.title}</h1>

      <a
        href={doc.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-blue-500 hover:underline break-all"
      >
        {doc.source_url}
      </a>

      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">요약</h2>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{doc.summary_text}</p>
      </div>
    </div>
  );
}
