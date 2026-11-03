import symbols from "../public/api-symbols.json";
import { ApiSymbolFilter } from "./api-symbol-filter";

export function ApiIndex() {
  return <ApiSymbolFilter symbols={symbols} />;
}
