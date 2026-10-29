import migration from "./docs-migration.json";
import type { LegacyDoc } from "./legacy-destination";

export const legacyDocs = new Map<string, LegacyDoc>(Object.entries(migration));
