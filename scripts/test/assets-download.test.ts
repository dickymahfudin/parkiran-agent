import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOWNLOAD_ATTEMPTS, download, hasExpectedMd5, md5File, requireFileRef } from "../assets/download.ts";

const dir = mkdtempSync(join(tmpdir(), "parkiran-dl-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

function fakeFetch(bodies: string[]): { fetchImpl: typeof fetch; calls: { url: string; signal: AbortSignal | null | undefined }[] } {
  const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), signal: init?.signal });
    const body = bodies.shift();
    if (body === undefined) throw new Error("no more bodies");
    return new Response(body);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("download hash check", () => {
  test("md5File and hasExpectedMd5 on a temp file", () => {
    const p = join(dir, "hash.bin");
    writeFileSync(p, "hello");
    expect(md5File(p)).toBe("5d41402abc4b2a76b9719d911017c592");
    expect(hasExpectedMd5(p, "5D41402ABC4B2A76B9719D911017C592")).toBe(true);
    expect(hasExpectedMd5(p, md5("other"))).toBe(false);
    expect(hasExpectedMd5(join(dir, "missing.bin"), md5("hello"))).toBe(false);
  });

  test("an existing file is skipped only when its hash matches", async () => {
    const p = join(dir, "skip.bin");
    writeFileSync(p, "stale");
    const same = fakeFetch([]);
    expect(await download({ url: "https://x/skip", md5: md5("stale") }, p, { fetchImpl: same.fetchImpl })).toBe(0);
    expect(same.calls).toHaveLength(0);

    const fresh = fakeFetch(["fresh"]);
    expect(await download({ url: "https://x/skip", md5: md5("fresh") }, p, { fetchImpl: fresh.fetchImpl })).toBe(5);
    expect(readFileSync(p, "utf8")).toBe("fresh");
    expect(fresh.calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  test("a corrupt download is deleted and retried once", async () => {
    const p = join(dir, "retry", "file.bin");
    const f = fakeFetch(["corrupt", "intact"]);
    expect(await download({ url: "https://x/retry", md5: md5("intact") }, p, { fetchImpl: f.fetchImpl })).toBe(6);
    expect(f.calls).toHaveLength(2);
    expect(readFileSync(p, "utf8")).toBe("intact");
  });

  test("two mismatches fail loudly and leave no file behind", async () => {
    const p = join(dir, "fail.bin");
    const f = fakeFetch(["bad", "still bad"]);
    await expect(download({ url: "https://x/fail", md5: md5("good") }, p, { fetchImpl: f.fetchImpl })).rejects.toThrow(/md5/);
    expect(f.calls).toHaveLength(DOWNLOAD_ATTEMPTS);
    expect(existsSync(p)).toBe(false);
  });

  test("a non-2xx response fails", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(download({ url: "https://x/404", md5: md5("x") }, join(dir, "404.bin"), { fetchImpl })).rejects.toThrow(/404/);
  });

  test("requireFileRef demands url and md5", () => {
    expect(requireFileRef({ url: "https://x", size: 1, md5: md5("x") }, "t").md5).toBe(md5("x"));
    expect(() => requireFileRef({ url: "https://x", size: 1 }, "t")).toThrow(/no url\/md5/);
    expect(() => requireFileRef(undefined, "t")).toThrow(/no url\/md5/);
    expect(() => requireFileRef({ url: "https://x", md5: "zz" }, "t")).toThrow(/no url\/md5/);
  });
});
