export function portableBasename(path: string): string {
  return path.replace(/\\/g, "/").split("/").at(-1) ?? "";
}

export function portableExtension(path: string): string {
  const name = portableBasename(path);
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index);
}
