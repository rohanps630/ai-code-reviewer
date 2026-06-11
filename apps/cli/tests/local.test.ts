import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalCodeSource, LocalRetriever } from "../src/local/index.js";

describe("LocalRetriever", () => {
  it("prevents shell injection in search", async () => {
    const retriever = new LocalRetriever();
    const testFile = "/tmp/acr-injection-test-1";
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    // If execSync("git grep ... " + query) was used, this would execute `touch /tmp/acr-injection-test-1`
    await retriever.search('"; touch /tmp/acr-injection-test-1; echo "');

    expect(fs.existsSync(testFile)).toBe(false);
  });
});

describe("LocalCodeSource", () => {
  it("prevents shell injection in findReferences", async () => {
    const source = new LocalCodeSource();
    const testFile = "/tmp/acr-injection-test-2";
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    await source.findReferences('"; touch /tmp/acr-injection-test-2; echo "', 10);
    expect(fs.existsSync(testFile)).toBe(false);
  });
});
