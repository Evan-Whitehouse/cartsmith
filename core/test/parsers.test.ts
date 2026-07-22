import { describe, expect, it } from "vitest";
import { parseDeck } from "../src/parsers/index.js";

describe("deck parser", () => {
  it("parses a Riftbound list: hyphens, apostrophes, headers, comments, duplicates", () => {
    const text = `// my deck
Legend:
3 Fiora - Peerless

Main Deck:
3 Void Seeker
1 Emperor's Dais
3 Void Seeker`;
    const { lines, warnings } = parseDeck(text);
    expect(warnings).toEqual([]);
    const fiora = lines.find((l) => l.name === "Fiora - Peerless")!;
    expect(fiora.qty).toBe(3);
    const seeker = lines.find((l) => l.name === "Void Seeker")!;
    expect(seeker.qty).toBe(6); // duplicate lines summed
    const dais = lines.find((l) => l.name === "Emperor's Dais")!;
    expect(dais.qty).toBe(1);
    expect(lines).toHaveLength(3); // headers, blanks, comments ignored
  });

  it("handles plain '<qty> <name>' lists and 'x' quantities", () => {
    const { lines } = parseDeck("3 Charm\n2x First Mate\n1 Emperor's Dais");
    expect(lines.map((l) => [l.qty, l.name])).toEqual([
      [3, "Charm"],
      [2, "First Mate"],
      [1, "Emperor's Dais"],
    ]);
  });

  it("parses an optional trailing set code + collector number", () => {
    const { lines } = parseDeck("2 Alpha Strike (OGN) 012");
    expect(lines[0]).toMatchObject({ qty: 2, name: "Alpha Strike", set: "OGN", number: "12" });
  });

  it("warns when nothing is recognized", () => {
    const { lines, warnings } = parseDeck("this is not a deck list");
    expect(lines).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});
