import { InvalidOptionError } from "./errors.js";

export function positiveInteger(option: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new InvalidOptionError(option, "a positive integer", value);
  return value;
}

export function nonNegativeInteger(option: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new InvalidOptionError(option, "a non-negative integer", value);
  return value;
}

export function positiveNumber(option: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new InvalidOptionError(option, "a finite positive number", value);
  return value;
}

export function nonNegativeNumber(option: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new InvalidOptionError(option, "a finite non-negative number", value);
  return value;
}

export function oneOf<const T extends string>(option: string, value: unknown, accepted: readonly T[]): T {
  if (!accepted.includes(value as T)) {
    throw new InvalidOptionError(option, accepted.map((item) => JSON.stringify(item)).join(" or "), value);
  }
  return value as T;
}
