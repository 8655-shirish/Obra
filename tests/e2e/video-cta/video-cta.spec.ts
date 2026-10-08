import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";

test("workbench Add Video UI is retired", async () => {
  expect(existsSync("src/components/workspace/AddVideoCta.tsx")).toBe(false);
  expect(existsSync("src/components/workspace/JobProgressPanel.tsx")).toBe(false);
  expect(existsSync("src/components/workspace/WorkspaceShell.tsx")).toBe(false);
});
