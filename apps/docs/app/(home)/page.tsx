import type { Metadata } from "next";
import { Features } from "@/components/home/features";
import { Hero } from "@/components/home/hero";
import { NextSteps } from "@/components/home/next-steps";
import { appName, appTagline } from "@/lib/shared";

export const metadata: Metadata = {
  title: { absolute: `${appName} - ${appTagline}` },
  description:
    "Extract structured data from documents in TypeScript. Choose the PDF or OCR library, choose the model, and get back data typed to your schema.",
};

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <Hero />
      <Features />
      <NextSteps />
    </div>
  );
}
