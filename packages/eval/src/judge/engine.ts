/** Load the optional `ai` peer. Its own module, so a test can stand in for an install without it. */
export function loadAi(): Promise<typeof import("ai")> {
  return import("ai");
}
