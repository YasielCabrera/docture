"use client";

import { Menu } from "lucide-react";
import { SidebarTrigger } from "fumadocs-ui/layouts/notebook/slots/sidebar";
import { SiteHeader } from "@/components/site-header";

export function DocsHeader() {
  return (
    <SiteHeader
      mobileNavigation={
        <SidebarTrigger className="site-header-action">
          <Menu aria-hidden="true" className="size-5" />
        </SidebarTrigger>
      }
    />
  );
}
