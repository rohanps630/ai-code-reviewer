import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalRetriever, LocalSqlExecutor } from "../src/local/index.js";

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

describe("LocalSqlExecutor", () => {
  it("prevents shell injection in find_references", async () => {
    const executor = new LocalSqlExecutor();
    const testFile = "/tmp/acr-injection-test-2";
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    const injectionPayload = {
      queryChunks: [
        {
          queryChunks: [
            "select d.path from chunks c join documents d on d.id = c.document_id where c.content_tsv @@ ",
          ],
        },
        {
          queryChunks: [
            "to_tsquery('english', ",
            '"; touch /tmp/acr-injection-test-2; echo "',
            ")",
          ],
        },
      ],
    };

    await executor.execute(injectionPayload);
    expect(fs.existsSync(testFile)).toBe(false);
  });

  it("throws on unrecognized shapes", async () => {
    const executor = new LocalSqlExecutor();
    await expect(executor.execute({ queryChunks: ["select * from fake"] })).rejects.toThrow(
      "LocalSqlExecutor encountered an unrecognized query shape",
    );
  });

  it("throws if queryChunks is missing", async () => {
    const executor = new LocalSqlExecutor();
    await expect(executor.execute({})).rejects.toThrow(
      "LocalSqlExecutor expected a Drizzle SQL object with queryChunks",
    );
  });
});
