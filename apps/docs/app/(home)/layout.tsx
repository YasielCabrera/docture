import { HomeLayout } from "fumadocs-ui/layouts/home";
import { SiteHeader } from "@/components/site-header";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/">) {
  return <HomeLayout {...baseOptions()} slots={{ header: SiteHeader }}>{children}</HomeLayout>;
}
