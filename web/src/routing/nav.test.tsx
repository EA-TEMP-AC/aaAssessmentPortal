import { screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { setSession } from "../api/session";
import type { Role } from "./access";
import { renderApp } from "../test/render";
import { sessionFor } from "../test/fixtures";

const VISIBLE: Record<Role, readonly string[]> = {
  aa_admin: ["Home", "Batches", "Users", "Registry", "Master data", "Recognition", "Results", "Audit log", "Working days"],
  mis: ["Home", "Batches", "Users", "Registry", "Master data", "Recognition", "Results", "Audit log", "Working days"],
  sme: ["Home"],
  assessor: ["Home", "Batches", "Registry", "Results"],
  proctor: ["Home", "Batches", "Registry"],
  candidate: ["Home", "Batches", "Master data", "Results"],
  tp: ["Home", "Batches", "Master data", "Results"],
  ab_reviewer: ["Home", "Batches", "Registry", "Master data", "Results", "Audit log"],
  ncvet_viewer: ["Home", "Batches", "Registry", "Master data", "Recognition", "Results", "Audit log"],
};

it.each(Object.entries(VISIBLE) as [Role, readonly string[]][])(
  "shows %s navigation and hides the rest",
  (role, labels) => {
    setSession(sessionFor(role));
    renderApp("/home");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(labels);
  },
);
