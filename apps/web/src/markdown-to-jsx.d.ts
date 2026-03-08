declare module "markdown-to-jsx" {
  import type { ComponentType, ReactElement } from "react";

  interface MarkdownProps {
    children: string;
    options?: Record<string, unknown>;
    [key: string]: unknown;
  }

  const Markdown: ComponentType<MarkdownProps>;
  export default Markdown;
}
