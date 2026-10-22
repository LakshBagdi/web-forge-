import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactFlow, {
  Background, Controls, MiniMap, addEdge, applyNodeChanges, applyEdgeChanges,
  Node, Edge, Connection, NodeChange, EdgeChange, ReactFlowProvider, MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import { nodeTypes, FlowNodeData } from '../flow/CustomNodes';
import Inspector from '../components/Inspector';
import VersionsPanel from '../components/VersionsPanel';
import SchedulePanel from '../components/SchedulePanel';
import { NODE_DEFS, NodeType } from '../constants';

let idSeq = 1;
const newId = (t: string) => `${t}_${Date.now().toString(36)}_${idSeq++}`;

function toFlow(graph: any): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes = (graph.nodes || []).map((n: any) => ({
    id: n.id,
    type: n.type,
    position: n.position || { x: 0, y: 0 },
    data: { label: n.label, nodeType: n.type as NodeType, config: n.config || {}, retry: n.retry, timeoutMs: n.timeoutMs } as any,
  }));
  const edges = (graph.edges || []).map((e: any) => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null,
    markerEnd: { type: MarkerType.ArrowClosed },
    label: e.sourceHandle || undefined,
    style: e.sourceHandle === 'true' ? { stroke: '#10b981' } : e.sourceHandle === 'false' ? { stroke: '#ef4444' } : undefined,
  }));
  return { nodes, edges };
}

function toGraph(nodes: Node<FlowNodeData>[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id, type: (n.data as any).nodeType, label: (n.data as any).label,
      position: n.position, config: (n.data as any).config || {},
      retry: (n.data as any).retry, timeoutMs: (n.data as any).timeoutMs,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
  };
}

function EditorInner() {
  const { id } = useParams();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [panel, setPanel] = useState<null | 'versions' | 'schedule'>(null);
  const dirty = useRef(false);
  // JSON handed to the run as {{input.*}}; remembered per workflow in this browser (optional convenience).
  const inputKey = `ff_input_${id}`;
  const [runInput, setRunInput] = useState('{}');
  const [showInput, setShowInput] = useState(false);
  useEffect(() => {
    try { setRunInput(localStorage.getItem(inputKey) || '{}'); } catch { setRunInput('{}'); }
  }, [inputKey]);
  const changeInput = (v: string) => {
    setRunInput(v);
    try { localStorage.setItem(inputKey, v); } catch { /* storage unavailable */ }
  };
  let inputError = '';
  try { const parsed = JSON.parse(runInput || '{}'); if (parsed === null || typeof parsed !== 'object') inputError = 'Must be a JSON object, e.g. {"id": 4}'; }
  catch { inputError = 'Not valid JSON'; }

  const load = useCallback(() => api.get(`/workflows/${id}`).then((d) => {
    setName(d.workflow.name);
    const f = toFlow(d.workflow.graph);
    setNodes(f.nodes); setEdges(f.edges);
    setIssues(d.validation || []);
    setSelected(null);
    dirty.current = false;
  }), [id]);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  // The Start (trigger) node is mandatory and cannot be re-added from the palette, so never let a
  // keyboard delete remove it.
  const onNodesChange = useCallback((c: NodeChange[]) => {
    setNodes((n) => {
      const keep = c.filter((ch) => !(ch.type === 'remove' && (n.find((x) => x.id === ch.id)?.data as any)?.nodeType === 'trigger'));
      return applyNodeChanges(keep, n);
    });
    dirty.current = true;
  }, []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => { setEdges((e) => applyEdgeChanges(c, e)); dirty.current = true; }, []);
  const onConnect = useCallback((c: Connection) => {
    setEdges((e) => addEdge({
      ...c, id: newId('e'),
      markerEnd: { type: MarkerType.ArrowClosed },
      label: c.sourceHandle || undefined,
      style: c.sourceHandle === 'true' ? { stroke: '#10b981' } : c.sourceHandle === 'false' ? { stroke: '#ef4444' } : undefined,
    }, e));
    dirty.current = true;
  }, []);

  // Readable, unique ids (http1, http2, condition1...) because users type them in {{steps.<id>...}}.
  const nextNodeId = (type: NodeType) => {
    const used = new Set(nodes.map((n) => n.id));
    let i = 1;
    while (used.has(`${type}${i}`)) i++;
    return `${type}${i}`;
  };

  const addNode = (type: NodeType) => {
    const nid = nextNodeId(type);
    setNodes((n) => [...n, {
      id: nid, type, position: { x: 200 + Math.random() * 300, y: 120 + Math.random() * 200 },
      data: { label: NODE_DEFS[type].label, nodeType: type, config: { ...NODE_DEFS[type].defaultConfig } } as any,
    }]);
    setSelected(nid);
    dirty.current = true;
  };

  const patchSelected = (patch: any) => {
    setNodes((ns) => ns.map((n) => n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n));
    dirty.current = true;
  };
  const deleteSelected = () => {
    setNodes((ns) => ns.filter((n) => n.id !== selected));
    setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
    setSelected(null);
  };

  const save = async (newVersion: boolean) => {
    setSaving(true);
    try {
      const graph = toGraph(nodes, edges);
      const d = await api.put(`/workflows/${id}`, { name, graph, newVersion, note: newVersion ? `Snapshot ${new Date().toLocaleTimeString()}` : '' });
      setIssues(d.validation || []);
      dirty.current = false;
      flash(newVersion ? 'Saved as new version' : 'Saved');
    } catch (e: any) { flash(e.message); } finally { setSaving(false); }
  };

  const run = async () => {
    if (inputError) { setShowInput(true); flash(`Run input: ${inputError}`); return; }
    await save(false);
    try {
      const { run } = await api.post(`/runs/workflow/${id}`, { input: JSON.parse(runInput || '{}') });
      nav(`/runs/${run.id}`);
    } catch (e: any) { flash(e.message); }
  };

  const duplicate = async () => {
    await save(false); // copy what's on screen, including unsaved edits
    const { workflow } = await api.post(`/workflows/${id}/duplicate`);
    nav(`/editor/${workflow.id}`);
  };

  const selNode = useMemo(() => {
    const n = nodes.find((x) => x.id === selected);
    if (!n) return null;
    return { id: n.id, type: (n.data as any).nodeType, label: (n.data as any).label, config: (n.data as any).config, retry: (n.data as any).retry, timeoutMs: (n.data as any).timeoutMs };
  }, [nodes, selected]);

  // Every node that can reach the selected node: those are the ones whose output it may reference.
  const upstream = useMemo(() => {
    if (!selected) return [];
    const seen = new Set<string>();
    const stack = [selected];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of edges) if (e.target === cur && !seen.has(e.source)) { seen.add(e.source); stack.push(e.source); }
    }
    return nodes.filter((n) => seen.has(n.id))
      .map((n) => ({ id: n.id, label: (n.data as any).label as string, type: (n.data as any).nodeType as NodeType }));
  }, [selected, nodes, edges]);

  const errors = issues.filter((i) => i.level === 'error');

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-edge bg-panel">
        <Link to="/" className="btn">← Back</Link>
        <input className="input max-w-xs" value={name} onChange={(e) => { setName(e.target.value); dirty.current = true; }} />
        {errors.length > 0 && <span className="badge bg-red-500/20 text-red-300">{errors.length} error(s)</span>}
        {dirty.current && <span className="text-xs text-amber-400">unsaved</span>}
        <div className="ml-auto flex gap-2">
          <Link to={`/workflows/${id}/runs`} className="btn">Run history</Link>
          <button className="btn" onClick={() => setPanel(panel === 'schedule' ? null : 'schedule')}>⏰ Schedule</button>
          <button className="btn" onClick={() => setPanel(panel === 'versions' ? null : 'versions')}>🕘 Versions</button>
          <button className="btn" onClick={duplicate}>Duplicate</button>
          <button className="btn" onClick={() => save(true)} disabled={saving}>Save version</button>
          <button className="btn" onClick={() => save(false)} disabled={saving}>Save</button>
          <div className="relative">
            <button className="btn" onClick={() => setShowInput((v) => !v)} title="JSON input available to the run as {{input.field}}">
              {'{ } Input'}{runInput.trim() !== '{}' && runInput.trim() !== '' ? ' •' : ''}
            </button>
            {showInput && (
              <div className="absolute right-0 top-11 z-30 w-80 card p-3 space-y-2 shadow-2xl">
                <div className="text-xs font-semibold text-slate-400">Run input (JSON object)</div>
                <textarea className="input font-mono h-28" value={runInput} onChange={(e) => changeInput(e.target.value)} spellCheck={false}
                  placeholder='{"id": 4, "city": "Bhopal"}' />
                {inputError
                  ? <div className="text-xs text-red-400">{inputError}</div>
                  : <div className="text-xs text-slate-500">Read it in any field as <span className="font-mono">{'{{input.id}}'}</span>. Applies to manual runs.</div>}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={run} disabled={errors.length > 0}>▶ Run</button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* palette */}
        <div className="w-44 border-r border-edge bg-panel p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-400 uppercase">Add node</div>
          {(Object.keys(NODE_DEFS) as NodeType[]).filter((t) => t !== 'trigger').map((t) => (
            <button key={t} className="btn w-full justify-start" onClick={() => addNode(t)}>
              <span style={{ color: NODE_DEFS[t].color }}>{NODE_DEFS[t].icon}</span> {NODE_DEFS[t].label}
            </button>
          ))}
          {errors.length > 0 && (
            <div className="mt-4 text-xs space-y-1">
              <div className="font-semibold text-red-400">Validation</div>
              {issues.map((i, k) => (
                <div key={k} className={i.level === 'error' ? 'text-red-300' : 'text-amber-300'}>• {i.message}</div>
              ))}
            </div>
          )}
        </div>

        {/* canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes} edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            fitView proOptions={{ hideAttribution: true }}
          >
            <Background color="#1e2636" gap={18} />
            <Controls />
            <MiniMap pannable zoomable maskColor="#0b0e14cc" nodeColor={(n) => NODE_DEFS[(n.data as any).nodeType as NodeType]?.color || '#888'} />
          </ReactFlow>
          {toast && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-edge px-4 py-2 rounded-md text-sm z-20">{toast}</div>}
          {panel && (
            <div className="absolute top-0 right-0 bottom-0 w-80 bg-panel border-l border-edge z-10 overflow-y-auto shadow-2xl">
              {panel === 'versions' && (
                <VersionsPanel workflowId={id!} onClose={() => setPanel(null)}
                  onRestored={() => { load(); flash('Version restored'); setPanel(null); }} />
              )}
              {panel === 'schedule' && <SchedulePanel workflowId={id!} onClose={() => setPanel(null)} />}
            </div>
          )}
        </div>

        {/* inspector */}
        <div className="w-80 border-l border-edge bg-panel flex flex-col">
          <Inspector node={selNode as any} onChange={patchSelected} onDelete={deleteSelected} upstream={upstream} workflowId={id} />
        </div>
      </div>
    </div>
  );
}

export default function Editor() {
  return <ReactFlowProvider><EditorInner /></ReactFlowProvider>;
}
