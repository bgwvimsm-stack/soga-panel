import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function renderMarkdown(content?: string | null): string {
  if (!content) {
    return "";
  }
  const html = marked.parse(content);
  return DOMPurify.sanitize(typeof html === "string" ? html : String(html));
}
