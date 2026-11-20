import { describe, expect, it } from "vitest";
import { parseCommand } from "./parse";

describe("parseCommand", () => {
  it("French send in CFA francs", () => {
    expect(parseCommand("Envoie 1 000 francs à Awa")).toEqual({ kind: "send", amount: 1000, unit: "xof", to: "awa", lang: "fr" });
  });
  it("French send in sats with FCFA-style separators", () => {
    expect(parseCommand("payer 2.500 sats à Moussa svp")).toEqual({ kind: "send", amount: 2500, unit: "sats", to: "moussa", lang: "fr" });
  });
  it("English send to a lightning address", () => {
    expect(parseCommand("send 500 sats to awa@getalby.com")).toEqual({ kind: "send", amount: 500, unit: "sats", to: "awa@getalby.com", lang: "en" });
  });
  it("Wolof-style send, name before amount, accents stripped", () => {
    expect(parseCommand("Yónnee Awa 2000 FCFA")).toEqual({ kind: "send", amount: 2000, unit: "xof", to: "awa", lang: "wo" });
  });
  it("k shorthand", () => {
    expect(parseCommand("envoie 2k f a fatou")).toMatchObject({ kind: "send", amount: 2000, unit: "xof", to: "fatou" });
  });
  it("balance", () => {
    expect(parseCommand("Quel est mon solde ?")).toMatchObject({ kind: "balance", lang: "fr" });
    expect(parseCommand("what's my balance")).toMatchObject({ kind: "balance", lang: "en" });
  });
  it("receive", () => {
    expect(parseCommand("facture 1500 francs")).toEqual({ kind: "receive", amount: 1500, unit: "xof", lang: "fr" });
  });
  it("add contact", () => {
    expect(parseCommand("ajoute Fatou fatou@getalby.com")).toMatchObject({ kind: "add_contact", name: "fatou", address: "fatou@getalby.com" });
  });
  it("rejects send without amount or recipient", () => {
    expect(parseCommand("envoie à Awa").kind).toBe("unknown");
    expect(parseCommand("envoie 500").kind).toBe("unknown");
    expect(parseCommand("envoie 0 sats à Awa").kind).toBe("unknown");
  });
  it("caps input length", () => {
    expect(parseCommand("x".repeat(5000)).kind).toBe("unknown");
  });
});
