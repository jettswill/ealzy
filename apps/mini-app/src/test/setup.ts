import * as matchers from "@testing-library/jest-dom/matchers";
import "fake-indexeddb/auto";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetMailSync } from "../mail-sync";
import { resetTaskSync } from "../task-sync";
import { resetNoteStore } from "../note-store";
import { resetNoteSyncState } from "../note-sync";

expect.extend(matchers);

afterEach(async () => {
  cleanup();
  sessionStorage.clear();
  resetTaskSync();
  resetMailSync();
  resetNoteSyncState();
  await resetNoteStore();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
