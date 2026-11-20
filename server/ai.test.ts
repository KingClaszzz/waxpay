import { describe, expect, it } from "vitest";
import { validate } from "./ai";

const contacts = ["awa", "moussa"];

describe("AI output validation", () => {
  it("accepts a send to a known contact", () => {
    expect(validate({ kind: "send", amount: 1500, unit: "xof", to: "Awa", lang: "fr", note: "ok" }, "paie awa", contacts))
      .toEqual({ kind: "send", amount: 1500, unit: "xof", to: "awa", lang: "fr", note: "ok" });
  });
  it("rejects an invented recipient", () => {
    expect(validate({ kind: "send", amount: 100, unit: "xof", to: "ibrahima" }, "paie ibrahima 100", contacts).kind).toBe("unknown");
    expect(validate({ kind: "send", amount: 100, unit: "sats", to: "x@evil.com" }, "paie awa 100", contacts).kind).toBe("unknown");
  });
  it("accepts a Lightning address only when the user typed it", () => {
    expect(validate({ kind: "send", amount: 100, unit: "sats", to: "fatou@getalby.com" }, "send 100 sats to fatou@getalby.com", contacts).kind).toBe("send");
  });
  it("rejects bad amounts", () => {
    for (const amount of [0, -5, 1.5, "abc", 1e12, null]) {
      expect(validate({ kind: "send", amount, unit: "xof", to: "awa" }, "x", contacts).kind).toBe("unknown");
    }
  });
  it("defaults unknown fields safely", () => {
    expect(validate("garbage", "x", contacts)).toEqual({ kind: "unknown", lang: "fr", note: "" });
    expect(validate({ kind: "delete_everything" }, "x", contacts).kind).toBe("unknown");
    expect(validate({ kind: "receive", amount: 500, unit: "weird" }, "x", contacts)).toMatchObject({ kind: "receive", unit: "xof" });
  });
});
