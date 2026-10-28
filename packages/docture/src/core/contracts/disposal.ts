/** A resource whose children can share the caller's disposal scope. */
export interface ScopedDisposable {
  dispose?(scope?: DisposalScope): Promise<void>;
}

/** Structural ownership shared by composed resources, including installed copies. */
export interface DisposalScope {
  dispose(...components: readonly ScopedDisposable[]): Promise<void>;
}

/** Dispose every resource once within this ownership scope without mutating it. */
export function createDisposalScope(): DisposalScope {
  const disposed = new WeakMap<ScopedDisposable, Promise<void>>();
  const scope: DisposalScope = {
    async dispose(...components) {
      const pending = components.map((component) => {
        let result = disposed.get(component);
        if (result === undefined) {
          result = Promise.resolve().then(() => component.dispose?.(scope));
          disposed.set(component, result);
        }
        return result;
      });
      const results = await Promise.allSettled(pending);
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, `${failures.length} component(s) failed to dispose.`);
    },
  };
  return scope;
}
