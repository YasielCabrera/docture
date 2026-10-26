import { withRasterizer, type ImageLoader } from "docture";
import { DocumentLoaderPdfJs } from "docture/loaders/pdfjs";
import { NapiCanvasRasterizer } from "docture/raster/canvas";

const loader: ImageLoader = withRasterizer(
  new DocumentLoaderPdfJs(),
  new NapiCanvasRasterizer(),
);
void loader;
