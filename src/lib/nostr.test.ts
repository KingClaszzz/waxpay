import { describe, expect, it } from "vitest";
import { contactKey } from "./nostr";

describe("contactKey", () => {
  it("uses the first meaningful word, lowercased, without accents", () => {
    expect(contactKey("Awa Ndiaye")).toBe("awa");
    expect(contactKey("The Fishcake (nostr.build)")).toBe("fishcake");
    expect(contactKey("Not Tinkerbell")).toBe("tinkerbell");
    expect(contactKey("Fatou Sène")).toBe("fatou");
    expect(contactKey("🌞")).toBe("nostr");
  });
});
