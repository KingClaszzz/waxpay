import { describe, expect, it } from "vitest";
import { rateFromBtcEur, satsToXof, xofToSats } from "./rates";

describe("XOF conversion", () => {
  // At 1 BTC = 50,000 EUR: 1 sat = 0.0005 EUR = 0.3279785 XOF
  const r = rateFromBtcEur(50_000);
  it("uses the fixed EUR peg", () => {
    expect(r.xofPerSat).toBeCloseTo(0.3279785, 6);
  });
  it("round-trips within rounding", () => {
    const sats = xofToSats(1000, r);
    expect(sats).toBe(3049);
    expect(Math.abs(satsToXof(sats, r) - 1000)).toBeLessThanOrEqual(1);
  });
  it("never returns zero sats for a positive amount", () => {
    expect(xofToSats(0.01, r)).toBe(1);
  });
});
