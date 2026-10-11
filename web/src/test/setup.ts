import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { setUnauthorizedHandler } from "../api/client";
import { clearSession } from "../api/session";

afterEach(() => {
  cleanup();
  clearSession();
  setUnauthorizedHandler(() => {});
  vi.unstubAllGlobals();
});
