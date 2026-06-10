import { expect, test } from "@playwright/test";

/**
 * Lightweight smoke tests — no LLM calls, no database writes.
 * These verify that the main routes render without crashing.
 */

test.describe("Smoke tests", () => {
  test("Marketing page renders", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();
    // Page should contain the brand name somewhere
    await expect(page.locator("body")).toContainText("AI Code Reviewer");
  });

  test("/reviews/new renders with submit button disabled for empty diff", async ({ page }) => {
    await page.goto("/reviews/new");
    await expect(page.locator("h1")).toContainText("New Review");

    // Submit button should be disabled when diff is empty
    const submitButton = page.getByRole("button", { name: /Run Review/i });
    await expect(submitButton).toBeDisabled();
  });

  test("/reviews renders", async ({ page }) => {
    await page.goto("/reviews");
    await expect(page.locator("h1")).toContainText("Reviews");
  });
});
