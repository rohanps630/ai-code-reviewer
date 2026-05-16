// Small fixture for the TypeScript chunker.

export const API_VERSION = "v1";

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export class Calculator {
  value: number;

  constructor(initial = 0) {
    this.value = initial;
  }

  square(): number {
    return this.value * this.value;
  }
}
