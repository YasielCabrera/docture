import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { appName, appTagline, gitConfig } from "@/lib/shared";

const repositoryUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const footerLinks = [
  {
    title: "Documentation",
    links: [
      { label: "Quick start", href: "/docs/quick-start" },
      { label: "How it works", href: "/docs/how-it-works" },
      { label: "Scanned documents", href: "/docs/guides/scanned-documents" },
      { label: "Package reference", href: "/docs/reference/packages" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source on GitHub", href: repositoryUrl, external: true },
      { label: "npm package", href: "https://www.npmjs.com/package/docture", external: true },
      { label: "Examples", href: `${repositoryUrl}/tree/${gitConfig.branch}/apps/examples`, external: true },
      { label: "Report an issue", href: `${repositoryUrl}/issues`, external: true },
    ],
  },
] as const;

const linkClassName =
  "w-fit text-sm leading-6 text-fd-foreground/70 underline-offset-4 transition-colors duration-200 hover:text-fd-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-fd-border bg-fd-background">
      <div className="site-container py-12 lg:py-14">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.8fr)] md:gap-16">
          <div>
            <Link
              href="/"
              className="inline-flex rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              <BrandLogo className="brand-logo-footer" />
            </Link>
            <p className="mt-4 max-w-[38ch] text-base leading-relaxed text-fd-foreground/70">
              {appTagline}
            </p>
            <p className="mt-4 text-sm text-fd-muted-foreground">
              Built by{" "}
              <a href="https://www.powerhouse.io/" className={linkClassName}>
                Powerhouse
              </a>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 sm:gap-10">
            {footerLinks.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <h2 className="text-sm font-semibold text-fd-foreground">{group.title}</h2>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {group.links.map((link) => (
                    <li key={link.label} className="flex">
                      {"external" in link && link.external ? (
                        <a href={link.href} className={linkClassName}>
                          {link.label}
                        </a>
                      ) : (
                        <Link href={link.href} className={linkClassName}>
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-fd-border pt-5 text-xs leading-5 text-fd-foreground/70 sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {appName}
          </p>
          <p>Open source under the MIT License.</p>
        </div>
      </div>
    </footer>
  );
}
