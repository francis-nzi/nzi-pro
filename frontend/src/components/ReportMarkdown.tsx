import ReactMarkdown from "react-markdown";

type ReportMarkdownProps = {
  content: string;
  className?: string;
};

export function ReportMarkdown({ content, className }: ReportMarkdownProps) {
  return (
    <div className={`report-markdown text-sm text-gray-700 leading-relaxed ${className ?? ""}`}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
