export type NodeType =
  | 'trigger'
  | 'http'
  | 'condition'
  | 'transform'
  | 'delay'
  | 'watch';

export interface RetryPolicy {
  maxAttempts: number; // total attempts including the first (1 = no retry)
  backoffMs: number; // base backoff, grows exponentially
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label?: string;
  position?: { x: number; y: number };
  config: Record<string, any>;
  retry?: RetryPolicy;
  timeoutMs?: number;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  // For condition nodes: 'true' | 'false'. Empty/undefined = unconditional.
  sourceHandle?: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface NodeRunState {
  status: NodeStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  output?: any;
  error?: string;
  // For condition nodes, which branch was taken.
  branch?: 'true' | 'false';
}

export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface ValidationIssue {
  level: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  message: string;
}
