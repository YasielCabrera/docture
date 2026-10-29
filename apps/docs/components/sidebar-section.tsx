"use client";

import { SidebarSectionLink } from "./sidebar-section-link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useTreePath } from "fumadocs-ui/contexts/tree";
import { SidebarFolder, SidebarFolderContent, useFolderDepth } from "fumadocs-ui/components/sidebar/base";
import { CollapsibleTrigger } from "fumadocs-ui/components/ui/collapsible";
import type { SidebarPageTreeComponents } from "fumadocs-ui/components/sidebar/page-tree";
import type { ComponentProps } from "react";

export function SidebarSection({ item, children }: ComponentProps<SidebarPageTreeComponents["Folder"]>) {
  const depth = useFolderDepth();
  const paddingInlineStart = `calc(${2 + 3 * depth} * var(--spacing))`;
  const path = useTreePath();
  const pathname = usePathname();
  const active = item.index?.url === pathname;

  return (
    <SidebarFolder active={path.includes(item)} defaultOpen={item.defaultOpen} collapsible={item.collapsible}>
      <div className="flex items-start gap-0.5">
        {item.index ? (
          <SidebarSectionLink
            active={active}
            data-sidebar-section=""
            style={{ paddingInlineStart }}
            href={item.index.url}
            aria-current={active ? "page" : undefined}
            data-active={active}
            className="min-w-0 flex-1 rounded-lg px-2 py-2 text-sm font-semibold text-fd-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground data-[active=true]:bg-fd-primary/10 data-[active=true]:text-fd-primary"
          >
            {item.name}
          </SidebarSectionLink>
        ) : <span style={{ paddingInlineStart }} className="min-w-0 flex-1 px-2 py-2 text-sm font-semibold text-fd-foreground">{item.name}</span>}
        {item.collapsible !== false && (
          <CollapsibleTrigger className="group flex size-9 shrink-0 items-center justify-center rounded-lg text-fd-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground">
            <span className="sr-only">Toggle {item.name}</span>
            <ChevronDown aria-hidden="true" className="size-4 -rotate-90 group-data-[state=open]:rotate-0" />
          </CollapsibleTrigger>
        )}
      </div>
      <SidebarFolderContent className="relative">
        <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
      </SidebarFolderContent>
    </SidebarFolder>
  );
}
