"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { resolveLinkItems } from "fumadocs-ui/layouts/shared";
import { FullSearchTrigger, SearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { BrandLogo } from "@/components/brand-logo";
import { primaryNavigation, repositoryUrl } from "@/lib/shared";

type SiteHeaderProps = ComponentProps<"header"> & {
  mobileNavigation?: ReactNode;
};

export function SiteHeader({ mobileNavigation, className, ...props }: SiteHeaderProps) {
  return (
    <header {...props} className={["site-header", className].filter(Boolean).join(" ")}>
      <div className="site-container site-header-body">
        <Link href="/" aria-label="docture home" className="site-header-brand">
          <BrandLogo />
        </Link>
        <nav aria-label="Main navigation" className="site-header-links">
          {primaryNavigation.map((link) => (
            <Link key={link.href} href={link.href}>{link.label}</Link>
          ))}
        </nav>
        <div className="site-header-actions">
          <FullSearchTrigger hideIfDisabled className="site-search-full" />
          <SearchTrigger hideIfDisabled className="site-search-compact" />
          <ThemeSwitch />
          <a href={repositoryUrl} aria-label="GitHub" className="site-header-action site-header-github">
            {resolveLinkItems({ githubUrl: repositoryUrl }).map((item) => item.type === "icon" ? (
              <span key={item.url} aria-hidden="true" className="[&_svg]:size-5">{item.icon}</span>
            ) : null)}
          </a>
          <div className="site-header-mobile-navigation">
            {mobileNavigation ?? (
              <Popover>
                <PopoverTrigger aria-label="Open navigation" className="site-header-action">
                  <Menu aria-hidden="true" className="size-5" />
                </PopoverTrigger>
                <PopoverContent align="end" className="flex min-w-52 flex-col gap-1 p-2">
                  {primaryNavigation.map((link) => (
                    <Link key={link.href} href={link.href} className="rounded-control px-3 py-2 text-sm hover:bg-fd-accent">
                      {link.label}
                    </Link>
                  ))}
                  <a href={repositoryUrl} className="rounded-control px-3 py-2 text-sm hover:bg-fd-accent">GitHub</a>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
