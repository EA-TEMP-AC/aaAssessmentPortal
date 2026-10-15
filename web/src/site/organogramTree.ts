import type { OrgNode } from "./publicApi";

export type OrgTreeNode = OrgNode & { children: OrgTreeNode[] };

/**
 * Builds a forest from parent links. A node whose parent is missing from the list
 * (hidden or unpublished) becomes a top-level node, and a loop is cut so every node shows once.
 */
export function buildOrgTree(nodes: OrgNode[]): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  for (const node of nodes) byId.set(node.id, { ...node, children: [] });

  const roots: OrgTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent !== node && !isAncestor(node, parent, byId)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function isAncestor(candidate: OrgTreeNode, start: OrgTreeNode, byId: Map<string, OrgTreeNode>): boolean {
  const seen = new Set<string>();
  let current: OrgTreeNode | undefined = start;
  while (current && !seen.has(current.id)) {
    if (current === candidate) return true;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}
