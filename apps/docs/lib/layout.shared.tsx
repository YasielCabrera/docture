import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BrandLogo } from "@/components/brand-logo";
import { repositoryUrl } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <BrandLogo />,
    },
    githubUrl: repositoryUrl,
  };
}
