import { appName } from "@/lib/shared";

type BrandLogoProps = {
  className?: string;
};

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span
      role="img"
      aria-label={appName}
      className={["brand-logo", className].filter(Boolean).join(" ")}
    >
      <img
        src="/brand/docture-horizontal-primary.svg"
        alt=""
        width={560}
        height={128}
        className="brand-logo-light"
      />
      <img
        src="/brand/docture-horizontal-on-dark.svg"
        alt=""
        width={560}
        height={128}
        className="brand-logo-dark"
      />
    </span>
  );
}
