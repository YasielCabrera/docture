import { describe, expect, it } from "vitest";
import { preferredInstallSpec, supportedInstallCommands } from "../scripts/install-specs";

describe("supported installation commands", () => {
  it("uses a major when the supported range covers the whole major", () => {
    expect(preferredInstallSpec("ai", "^7.0.0")).toBe("ai@7");
    expect(preferredInstallSpec("react", ">=18.3.1 <20.0.0")).toBe("react@19");
    expect(preferredInstallSpec("vitest", ">=3")).toBe("vitest");
  });

  it("retains lower floors, minor caps and exact-only engines", () => {
    expect(preferredInstallSpec("pdfjs-dist", "^6.2.108")).toBe("pdfjs-dist@^6.2.108");
    expect(preferredInstallSpec("mupdf", "~1.28.0")).toBe("mupdf@~1.28.0");
    expect(preferredInstallSpec("ppu-paddle-ocr", "6.3.0")).toBe("ppu-paddle-ocr@6.3.0");
    expect(preferredInstallSpec("zod", "^3.25.76 || ^4.1.8")).toBe("zod@^4.1.8");
  });

  it("rewrites copyable commands without changing library releases or prose", () => {
    const source = "Use npm install docture for core.\n\n```sh\nnpm install docture ai pdfjs-dist\nnpm install --save-dev @docture/cli tsx\n```\n";
    expect(supportedInstallCommands(source)).toBe("Use npm install docture for core.\n\n```sh\nnpm install docture ai@7 pdfjs-dist@^6.2.108\nnpm install --save-dev @docture/cli tsx\n```\n");
  });

  it("quotes supported windows and converges when run again", () => {
    const updated = supportedInstallCommands("npm install docture pdfkit\n");
    expect(updated).toBe("npm install docture 'pdfkit@>=0.17.2 <0.21.0'\n");
    expect(supportedInstallCommands(updated)).toBe(updated);
  });

  it("requires Standard Schema JSON output for synthetic model recipes", () => {
    expect(supportedInstallCommands("npm install @docture/synthetic docture zod\n"))
      .toBe("npm install @docture/synthetic docture zod@^4.2.0\n");
    expect(supportedInstallCommands("npm install docture zod\n"))
      .toBe("npm install docture zod@^4.1.8\n");
  });
});
