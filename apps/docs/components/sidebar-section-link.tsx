"use client";

import Link from "next/link";
import { useFolder } from "fumadocs-ui/components/sidebar/base";
import type { ComponentProps } from "react";

export function SidebarSectionLink({ active, ...props }: ComponentProps<typeof Link> & { active: boolean }) {
  const folder = useFolder();

  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (active && folder?.collapsible) {
          event.preventDefault();
          folder.setOpen((open) => !open);
        }
      }}
    />
  );
}
