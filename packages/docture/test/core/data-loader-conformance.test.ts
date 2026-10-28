import { DocumentLoaderData } from "docture";
import { describeLoaderConformance, textFixtures } from "docture/testing/conformance";

describeLoaderConformance({ name: "DocumentLoaderData", create: () => new DocumentLoaderData(), fixtures: textFixtures });
