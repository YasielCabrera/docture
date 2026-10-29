"use client";

import { useEffect } from "react";
import { legacyDestination, type LegacyDoc } from "@/lib/legacy-destination";

export function LegacyDocRedirect({ entry }: { entry: LegacyDoc }) {
  useEffect(() => {
    window.location.replace(legacyDestination(entry, window.location.hash, window.location.search));
  }, [entry]);

  return <p>This page moved. <a href={entry.to}>Open the current documentation.</a></p>;
}
