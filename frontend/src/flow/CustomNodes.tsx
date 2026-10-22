import { Handle, Position, NodeProps } from 'reactflow';
import { NODE_DEFS, NodeType, STATUS_STYLE } from '../constants';

export interface FlowNodeData {
  label?: string;
  nodeType: NodeType;
  config: Record<string, any>;
  status?: string;
  attempts?: number;
}

function Shell({ data, selected, children }: { data: FlowNodeData; selected: boolean; children?: React.ReactNode }) {
  const def = NODE_DEFS[data.nodeType];
  const st = data.status ? STATUS_STYLE[data.status] : null;
  const ring =
    data.status === 'running' ? 'ring-2 ring-blue-400 animate-pulse'
    : data.status === 'success' ? 'ring-2 ring-emerald-400'
    : data.status === 'failed' ? 'ring-2 ring-red-400'
    : data.status === 'skipped' ? 'opacity-50'
    : selected ? 'ring-2 ring-accent' : 'ring-1 ring-edge';
  return (
    <div className={`rounded-lg bg-panel ${ring} w-[230px] shadow-lg`}>
      <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg" style={{ background: def.color + '22' }}>
        <span className="text-base" style={{ color: def.color }}>{def.icon}</span>
        <span className="text-sm font-semibold flex-1 truncate">{data.label || def.label}</span>
        {st && <span className={`badge ${st.bg} ${st.text}`}>{st.label}{data.attempts && data.attempts > 1 ? ` ×${data.attempts}` : ''}</span>}
      </div>
      {children && <div className="px-3 py-2 text-xs text-slate-400 border-t border-edge">{children}</div>}
    </div>
  );
}

export function TriggerNode({ data, selected }: NodeProps<FlowNodeData>) {
  return (
    <Shell data={data} selected={selected}>
      <span>Run input</span>
      <Handle type="source" position={Position.Right} />
    </Shell>
  );
}

export function HttpNode({ data, selected }: NodeProps<FlowNodeData>) {
  return (
    <Shell data={data} selected={selected}>
      <div className="font-mono truncate" title={data.config.url || ''}><span className="text-accent">{(data.config.method || 'GET')}</span> {data.config.url || 'no URL yet'}</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </Shell>
  );
}

export function ConditionNode({ data, selected }: NodeProps<FlowNodeData>) {
  return (
    <Shell data={data} selected={selected}>
      <div className="font-mono truncate" title={data.config.expression || ''}>{data.config.expression || `${data.config.left || '?'} ${data.config.operator || 'eq'} ${String(data.config.right ?? '')}`}</div>
      <div className="flex justify-between mt-1 text-[10px]"><span className="text-emerald-400">true ↑</span><span className="text-red-400">false ↓</span></div>
      <Handle type="target" position={Position.Left} />
      <Handle id="true" type="source" position={Position.Right} style={{ top: '35%', background: '#10b981' }} />
      <Handle id="false" type="source" position={Position.Right} style={{ top: '70%', background: '#ef4444' }} />
    </Shell>
  );
}

export function TransformNode({ data, selected }: NodeProps<FlowNodeData>) {
  const keys = Object.keys(data.config.mapping || {});
  return (
    <Shell data={data} selected={selected}>
      <span>{keys.length ? `maps ${keys.length} field(s)` : 'passthrough'}</span>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </Shell>
  );
}

export function DelayNode({ data, selected }: NodeProps<FlowNodeData>) {
  return (
    <Shell data={data} selected={selected}>
      <span>wait {(() => { const ms = Number(data.config.ms ?? 0); return ms >= 60000 && ms % 60000 === 0 ? `${ms / 60000} min` : ms >= 1000 && ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`; })()}</span>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </Shell>
  );
}

export function WatchNode({ data, selected }: NodeProps<FlowNodeData>) {
  return (
    <Shell data={data} selected={selected}>
      <div className="font-mono truncate" title={data.config.value || ''}>{data.config.value || 'pick a value to watch'}</div>
      <div className="flex justify-between mt-1 text-[10px]"><span className="text-emerald-400">changed ↑</span><span className="text-red-400">same ↓</span></div>
      <Handle type="target" position={Position.Left} />
      <Handle id="true" type="source" position={Position.Right} style={{ top: '35%', background: '#10b981' }} />
      <Handle id="false" type="source" position={Position.Right} style={{ top: '70%', background: '#ef4444' }} />
    </Shell>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  http: HttpNode,
  condition: ConditionNode,
  transform: TransformNode,
  delay: DelayNode,
  watch: WatchNode,
};
