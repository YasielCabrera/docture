import { CodeBlock, Pre, type CodeBlockProps } from "fumadocs-ui/components/codeblock";

interface CodeExampleProps extends CodeBlockProps {
  readonly "data-example-label"?: string;
}

export function CodeExample({ "data-example-label": label, ...props }: CodeExampleProps) {
  return (
    <CodeBlock {...props} title={props.title ?? label} viewportProps={{ ...props.viewportProps, "aria-label": label ?? (typeof props.title === "string" ? props.title : "Code example") }}>
      <Pre>{props.children}</Pre>
    </CodeBlock>
  );
}
