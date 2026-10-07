import { describe, expect, test } from "bun:test";
import { parseEnvFile } from "../src/env.ts";

describe("parseEnvFile", () => {
  test("reads KEY=value lines, trims, and strips matching quotes", () => {
    expect(parseEnvFile("A=1\n B = two \nC=\"quoted\"\nD='single'\n")).toEqual({ A: "1", B: "two", C: "quoted", D: "single" });
  });

  test("ignores comments, blank lines and lines without an identifier", () => {
    expect(parseEnvFile("# comment\n\n=nokey\n1BAD=x\nOK=y\n")).toEqual({ OK: "y" });
  });

  test("keeps CRLF files and empty values, the last assignment wins", () => {
    expect(parseEnvFile("A=1\r\nA=2\r\nEMPTY=\r\n")).toEqual({ A: "2", EMPTY: "" });
  });

  test("mismatched quotes are kept as they are", () => {
    expect(parseEnvFile('A="half\nB=\'x"')).toEqual({ A: '"half', B: "'x\"" });
  });
});
