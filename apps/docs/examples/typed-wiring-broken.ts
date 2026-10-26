import type { ImageLoader } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";

// @ts-expect-error PDF.js reads text and geometry without rendering images.
const loader: ImageLoader = new DocumentLoaderPdfJs();
void loader;
