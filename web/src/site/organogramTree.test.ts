import { expect, it } from "vitest";
import { buildOrgTree, type OrgTreeNode } from "./organogramTree";

const node = (id: string, parentId?: string | null) => ({ id, name: id, title: "T", parentId });

it("nests children under their parent", () => {
  const tree = buildOrgTree([node("a"), node("b", "a"), node("c", "b")]);
  expect(tree).toHaveLength(1);
  expect(tree[0]!.children[0]!.children[0]!.id).toBe("c");
});

it("puts a node with a missing parent at the top", () => {
  const tree = buildOrgTree([node("a"), node("b", "gone")]);
  expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
});

it("cuts a loop so each node appears once", () => {
  const tree = buildOrgTree([node("a", "b"), node("b", "a"), node("c", "c")]);
  const seen: string[] = [];
  const walk = (nodes: OrgTreeNode[]) => {
    for (const n of nodes) {
      seen.push(n.id);
      walk(n.children);
    }
  };
  walk(tree);
  expect(seen.sort()).toEqual(["a", "b", "c"]);
});
