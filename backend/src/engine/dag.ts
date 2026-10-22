import { WorkflowGraph, WorkflowNode, ValidationIssue } from './types';

export function nodeMap(graph: WorkflowGraph): Map<string, WorkflowNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

export function incoming(graph: WorkflowGraph, nodeId: string) {
  return graph.edges.filter((e) => e.target === nodeId);
}

export function outgoing(graph: WorkflowGraph, nodeId: string) {
  return graph.edges.filter((e) => e.source === nodeId);
}

/** Detect a cycle using DFS coloring. Returns the node ids on a cycle, or null. */
export function findCycle(graph: WorkflowGraph): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  graph.nodes.forEach((n) => color.set(n.id, WHITE));
  const adj = new Map<string, string[]>();
  graph.nodes.forEach((n) => adj.set(n.id, []));
  graph.edges.forEach((e) => {
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
  });

  let cycle: string[] | null = null;
  const stack: { node: string; iter: number }[] = [];

  for (const start of graph.nodes.map((n) => n.id)) {
    if (color.get(start) !== WHITE) continue;
    parent.set(start, null);
    stack.push({ node: start, iter: 0 });
    color.set(start, GRAY);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const neighbors = adj.get(top.node)!;
      if (top.iter < neighbors.length) {
        const next = neighbors[top.iter++];
        const c = color.get(next);
        if (c === WHITE) {
          parent.set(next, top.node);
          color.set(next, GRAY);
          stack.push({ node: next, iter: 0 });
        } else if (c === GRAY) {
          // Found back-edge; reconstruct cycle.
          const path = [next];
          let cur: string | null = top.node;
          while (cur && cur !== next) {
            path.push(cur);
            cur = parent.get(cur) ?? null;
          }
          path.push(next);
          cycle = path.reverse();
          return cycle;
        }
      } else {
        color.set(top.node, BLACK);
        stack.pop();
      }
    }
  }
  return null;
}

/** Kahn topological order. Assumes acyclic (validate first). */
export function topoOrder(graph: WorkflowGraph): string[] {
  const indeg = new Map<string, number>();
  graph.nodes.forEach((n) => indeg.set(n.id, 0));
  graph.edges.forEach((e) => indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1));
  const queue = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const adj = new Map<string, string[]>();
  graph.nodes.forEach((n) => adj.set(n.id, []));
  graph.edges.forEach((e) => adj.get(e.source)?.push(e.target));
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nxt of adj.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 0) - 1);
      if (indeg.get(nxt) === 0) queue.push(nxt);
    }
  }
  return order;
}

/**
 * Validate a workflow before execution: structure, connectivity, and per-node config.
 * Returns a list of issues; errors block execution, warnings do not.
 */
export function validateWorkflow(graph: WorkflowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const map = nodeMap(graph);

  if (graph.nodes.length === 0) {
    issues.push({ level: 'error', message: 'Workflow has no nodes' });
    return issues;
  }

  for (const n of graph.nodes) {
    if (ids.has(n.id)) issues.push({ level: 'error', nodeId: n.id, message: `Duplicate node id ${n.id}` });
    ids.add(n.id);
  }

  // Edges must reference existing nodes.
  for (const e of graph.edges) {
    if (!map.has(e.source)) issues.push({ level: 'error', edgeId: e.id, message: `Edge source ${e.source} missing` });
    if (!map.has(e.target)) issues.push({ level: 'error', edgeId: e.id, message: `Edge target ${e.target} missing` });
  }

  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) issues.push({ level: 'error', message: 'Workflow needs a trigger node' });
  if (triggers.length > 1) issues.push({ level: 'error', message: 'Only one trigger node is allowed' });

  // Cycle check.
  const cyc = findCycle(graph);
  if (cyc) issues.push({ level: 'error', message: `Workflow has a cycle: ${cyc.join(' → ')}` });

  // Per-node config checks + orphan detection.
  for (const n of graph.nodes) {
    const hasIn = graph.edges.some((e) => e.target === n.id);
    const hasOut = graph.edges.some((e) => e.source === n.id);
    if (n.type !== 'trigger' && !hasIn) {
      issues.push({ level: 'error', nodeId: n.id, message: `Node "${n.label || n.id}" is not connected to any input` });
    }
    if (n.type === 'trigger' && !hasOut) {
      issues.push({ level: 'warning', nodeId: n.id, message: 'Trigger has no outgoing steps' });
    }

    // Starter templates ship with PASTE_... placeholders. Refuse to run until they are replaced, so a
    // half-configured workflow can never fire (or spam failing scheduled runs).
    const ph = JSON.stringify(n.config ?? {}).match(/PASTE_[A-Z0-9_]+/);
    if (ph) issues.push({ level: 'error', nodeId: n.id, message: `Fill in ${ph[0]} in "${n.label || n.id}" before running` });

    if (n.type === 'http') {
      if (!n.config?.url || typeof n.config.url !== 'string') {
        issues.push({ level: 'error', nodeId: n.id, message: 'HTTP node is missing a URL' });
      }
      const method0 = (n.config?.method || 'GET').toUpperCase();
      if (n.config?.bodyMode === 'message' && ['POST', 'PUT', 'PATCH'].includes(method0) && !String(n.config?.message ?? '').trim()) {
        issues.push({ level: 'error', nodeId: n.id, message: `"${n.label || n.id}": type the message to send (or switch the body to Fields / Custom JSON)` });
      }
      const method = (n.config?.method || 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
        issues.push({ level: 'error', nodeId: n.id, message: `Invalid HTTP method ${method}` });
      }
    }
    if (n.type === 'condition') {
      const hasExpr = typeof n.config?.expression === 'string' && n.config.expression.trim().length > 0;
      const hasStructured = n.config?.operator || n.config?.left !== undefined;
      if (!hasExpr && !hasStructured) {
        issues.push({ level: 'error', nodeId: n.id, message: 'Condition node needs an expression or left/operator/right' });
      }
      const branches = outgoing(graph, n.id).map((e) => e.sourceHandle);
      if (!branches.includes('true') && !branches.includes('false')) {
        issues.push({ level: 'warning', nodeId: n.id, message: 'Condition has no true/false branch connected' });
      }
    }
    if (n.type === 'watch') {
      if (n.config?.value === undefined || String(n.config.value).trim() === '') {
        issues.push({ level: 'error', nodeId: n.id, message: 'Watch node needs a value to watch, e.g. {{steps.http1.output.body.id}}' });
      }
      const branches = outgoing(graph, n.id).map((e) => e.sourceHandle);
      if (!branches.includes('true') && !branches.includes('false')) {
        issues.push({ level: 'warning', nodeId: n.id, message: 'Watch has no changed (green) / unchanged (red) branch connected' });
      }
    }
    if (n.type === 'transform') {
      if (!n.config?.mapping && !n.config?.expression) {
        issues.push({ level: 'warning', nodeId: n.id, message: 'Transform node has no mapping defined' });
      }
    }
    if (n.type === 'delay') {
      const ms = Number(n.config?.ms);
      if (!Number.isFinite(ms) || ms < 0) {
        issues.push({ level: 'error', nodeId: n.id, message: 'Delay node needs a non-negative duration (ms)' });
      } else if (ms > 120_000) {
        issues.push({ level: 'warning', nodeId: n.id, message: 'Delay waits at most 2 minutes. For longer waits use ⏰ Schedule → “Run once at a specific time”' });
      }
    }
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]) {
  return issues.some((i) => i.level === 'error');
}
