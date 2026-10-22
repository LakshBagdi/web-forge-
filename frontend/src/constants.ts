export type NodeType = 'trigger' | 'http' | 'condition' | 'transform' | 'delay';

export interface NodeDef {
  type: NodeType;
  label: string;
  color: string;
  icon: string;
  description: string;
  defaultConfig: Record<string, any>;
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  trigger: {
    type: 'trigger', label: 'Trigger', color: '#8b5cf6', icon: '▶',
    description: 'Entry point. Receives the run input.',
    defaultConfig: {},
  },
  http: {
    type: 'http', label: 'HTTP Request', color: '#5b8cff', icon: '🌐',
    description: 'Call an external API.',
    defaultConfig: { method: 'GET', url: '', headers: {}, failOnErrorStatus: true },
  },
  condition: {
    type: 'condition', label: 'Condition', color: '#f59e0b', icon: '◇',
    description: 'Branch true/false on a comparison.',
    defaultConfig: { left: '', operator: 'eq', right: '' },
  },
  transform: {
    type: 'transform', label: 'Transform', color: '#10b981', icon: '⚙',
    description: 'Reshape data with templates.',
    defaultConfig: { mapping: {} },
  },
  delay: {
    type: 'delay', label: 'Delay', color: '#64748b', icon: '⏱',
    description: 'Wait before continuing.',
    defaultConfig: { ms: 1000 },
  },
};

export const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-slate-600/30', text: 'text-slate-300', label: 'Pending' },
  queued: { bg: 'bg-slate-600/30', text: 'text-slate-300', label: 'Queued' },
  running: { bg: 'bg-blue-500/20', text: 'text-blue-300', label: 'Running' },
  success: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', label: 'Success' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-300', label: 'Failed' },
  skipped: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Skipped' },
  cancelled: { bg: 'bg-amber-500/20', text: 'text-amber-300', label: 'Cancelled' },
};

export const OPERATORS = [
  { value: 'eq', label: '= equals' },
  { value: 'ne', label: '≠ not equals' },
  { value: 'gt', label: '> greater' },
  { value: 'gte', label: '≥ greater/equal' },
  { value: 'lt', label: '< less' },
  { value: 'lte', label: '≤ less/equal' },
  { value: 'contains', label: 'contains' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'exists', label: 'exists' },
  { value: 'truthy', label: 'is truthy' },
];
