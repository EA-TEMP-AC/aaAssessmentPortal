import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { setSession } from "../api/session";
import { renderApp } from "../test/render";
import { sessionFor } from "../test/fixtures";

it("sends an anonymous visitor to sign in", async () => {
  renderApp("/batches");
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
});

it("sends a candidate away from user administration", async () => {
  setSession(sessionFor("candidate"));
  renderApp("/users");
  expect(await screen.findByRole("heading", { name: "Candidate" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Users" })).not.toBeInTheDocument();
});

it("sends a proctor away from results", async () => {
  setSession(sessionFor("proctor"));
  renderApp("/results");
  expect(await screen.findByRole("heading", { name: "Proctor" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Results" })).not.toBeInTheDocument();
});

it("lets an AA admin open user administration", async () => {
  setSession(sessionFor("aa_admin"));
  renderApp("/users");
  expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
});

it("sends a signed-in user who must change their password away from the shell", async () => {
  setSession(sessionFor("mis", { mustChangePassword: true }));
  renderApp("/home");
  expect(await screen.findByRole("heading", { name: "Password change required" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
});

it("shows a not-found page for an unknown address", async () => {
  renderApp("/not-a-page");
  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
});
