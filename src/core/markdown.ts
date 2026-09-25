import { Marked } from 'marked';

const renderer = new Marked({
  gfm: true,
  breaks: false,
  pedantic: false,
});

/** Deterministic Markdown to HTML used by the generated projection. */
export function renderMarkdown(source: string): string {
  return renderer.parse(source, { async: false });
}
