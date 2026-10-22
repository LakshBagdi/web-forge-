import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactFlow, {
  Background, Controls, MiniMap, addEdge, applyNodeChanges, applyEdgeChanges,
  Node, Edge, Connection, NodeChange, EdgeChange, ReactFlowProvider, MarkerType, useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import { nodeTypes, FlowNodeData } from '../flow/CustomNodes';
import Inspector from '../components/Inspector';
import VersionsPanel from '../components/VersionsPanel';
import SchedulePanel from '../components/SchedulePanel';
import Panel from '../components/Panel';
import NotFound from '../components/NotFound';
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
  const rf = useReactFlow();
  const dirty = useRef(false);
  const tickRef = useRef(0);
  const nodesRef = useRef<Node<FlowNodeData>[]>([]);
  const [loadError, setLoadError] = useState<{ status?: number; message: string } | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [dirtyTick, setDirtyTick] = useState(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  // Stable: every edit goes through here so the header can show "Saving… / Saved" and autosave can kick in.
  const markDirty = useCallback(() => { dirty.current = true; tickRef.current += 1; setSaveState('dirty'); setDirtyTick((t) => t + 1); }, []);
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
    dirty.current = false; setSaveState('saved'); setLoadError(null);
  }).catch((e: any) => setLoadError({ status: e?.status, message: e?.message || 'Could not load' })), [id]);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  // The Start (trigger) node is mandatory and cannot be re-added from the palette, so never let a
  // keyboard delete remove it.
  const onNodesChange = useCallback((c: NodeChange[]) => {
    setNodes((n) => {
      const keep = c.filter((ch) => !(ch.type === 'remove' && (n.find((x) => x.id === ch.id)?.data as any)?.nodeType === 'trigger'));
      return applyNodeChanges(keep, n);
    });
    // clicking/selecting a step or the canvas measuring its size is not an edit
    const moved = (ch: NodeChange) => ch.type === 'position' && ch.dragging === false && !!ch.position &&
      (() => { const old = nodesRef.current.find((x) => x.id === ch.id); return !old || old.position.x !== ch.position!.x || old.position.y !== ch.position!.y; })();
    if (c.some((ch) => ch.type === 'remove' || ch.type === 'add' || ch.type === 'reset' || moved(ch))) markDirty();
  }, [markDirty]);
  const onEdgesChange = useCallback((c: EdgeChange[]) => {
    setEdges((e) => applyEdgeChanges(c, e));
    if (c.some((ch) => ch.type === 'remove' || ch.type === 'add' || ch.type === 'reset')) markDirty();
  }, [markDirty]);
  const onConnect = useCallback((c: Connection) => {
    setEdges((e) => addEdge({
      ...c, id: newId('e'),
      markerEnd: { type: MarkerType.ArrowClosed },
      label: c.sourceHandle || undefined,
      style: c.sourceHandle === 'true' ? { stroke: '#10b981' } : c.sourceHandle === 'false' ? { stroke: '#ef4444' } : undefined,
    }, e));
    markDirty();
  }, [markDirty]);

  // Readable, unique ids (http1, http2, condition1...) because users type them in {{steps.<id>...}}.
  const nextNodeId = (type: NodeType) => {
    const used = new Set(nodes.map((n) => n.id));
    let i = 1;
    while (used.has(`${type}${i}`)) i++;
    return `${type}${i}`;
  };

  // Adding a step joins it to the chain automatically (after the selected step, else after the last one),
  // places it to the right and scrolls it into view, so beginners never have to wire arrows by hand.
  const addNode = (type: NodeType) => {
    const nid = nextNodeId(type);
    const hasOut = new Set(edges.map((e) => e.source));
    let src: Node<FlowNodeData> | undefined = nodes.find((n) => n.id === selected);
    if (!src) {
      const leaves = nodes.filter((n) => !hasOut.has(n.id)).sort((a, b) => b.position.x - a.position.x);
      src = leaves[0] || nodes.find((n) => (n.data as any).nodeType === 'trigger');
    }
    const srcType = src ? ((src.data as any).nodeType as NodeType) : null;
    const branching = srcType === 'condition' || srcType === 'watch';
    let handle: string | null = null;
    if (src && branching) {
      const used = new Set(edges.filter((e) => e.source === src!.id).map((e) => e.sourceHandle));
      handle = !used.has('true') ? 'true' : !used.has('false') ? 'false' : null;
    }
    let pos = src ? { x: src.position.x + 290, y: src.position.y + (handle === 'false' ? 130 : handle === 'true' ? -10 : 0) } : { x: 200, y: 150 };
    let guard = 0;
    while (guard++ < 20 && nodes.some((n) => Math.abs(n.position.x - pos.x) < 250 && Math.abs(n.position.y - pos.y) < 100)) pos = { ...pos, y: pos.y + 130 };
    setNodes((n) => [...n, {
      id: nid, type, position: pos,
      data: { label: NODE_DEFS[type].label, nodeType: type, config: { ...NODE_DEFS[type].defaultConfig } } as any,
    }]);
    if (src && !(branching && handle === null)) {
      const from = src.id;
      setEdges((es) => addEdge({
        id: newId('e'), source: from, target: nid, sourceHandle: handle,
        markerEnd: { type: MarkerType.ArrowClosed }, label: handle || undefined,
        style: handle === 'true' ? { stroke: '#10b981' } : handle === 'false' ? { stroke: '#ef4444' } : undefined,
      }, es));
    }
    setSelected(nid);
    markDirty();
    setTimeout(() => { try { rf.fitView({ padding: 0.25, maxZoom: 1, duration: 300 }); } catch { /* not ready */ } }, 60);
  };

  const patchSelected = (patch: any) => {
    setNodes((ns) => ns.map((n) => n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n));
    markDirty();
  };
  const deleteSelected = () => {
    setNodes((ns) => ns.filter((n) => n.id !== selected));
    setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
    setSelected(null);
    markDirty();
  };

  // Saves are queued one after another so autosave, Save and Run can never overwrite each other.
  const save = (newVersion: boolean, silent = false): Promise<boolean> => {
    const job = saveChain.current.then(async () => {
      const startTick = tickRef.current;
      setSaving(true); setSaveState('saving');
      try {
        const graph = toGraph(nodes, edges);
        const d = await api.put(`/workflows/${id}`, { name, graph, newVersion, note: newVersion ? `Snapshot ${new Date().toLocaleTimeString()}` : '' });
        setIssues(d.validation || []);
        if (tickRef.current === startTick) { dirty.current = false; setSaveState('saved'); } else setSaveState('dirty');
        if (!silent) flash(newVersion ? 'Saved as a new version' : 'Saved');
        return true;
      } catch (e: any) {
        setSaveState('error');
        flash(`Could not save: ${e.message}`);
        return false;
      } finally { setSaving(false); }
    });
    saveChain.current = job.then(() => undefined, () => undefined);
    return job;
  };

  nodesRef.current = nodes;

  // Live check (no saving): the left panel's "Finish setup / Needs fixing" list follows every edit within a blink.
  useEffect(() => {
    if (dirtyTick === 0) return;
    const t = setTimeout(() => {
      api.post(`/workflows/${id}/validate`, { graph: toGraph(nodes, edges) }).then((d) => setIssues(d.validation || [])).catch(() => { /* offline: the save will report it */ });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyTick]);

  // Autosave 1.5s after the last edit, so the saved copy (which schedules and webhooks run) is always current.
  useEffect(() => {
    if (dirtyTick === 0) return;
    const t = setTimeout(() => { save(false, true); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyTick]);

  // Leaving the editor within the autosave delay must not lose the last edit: flush it on the way out.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => { if (dirty.current) saveRef.current(false, true); }, []);

  // Warn before closing the tab with edits that are not saved yet.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // Links that leave the editor first wait for any pending edit to be saved, so the next page never shows stale data.
  const leave = (to: string) => async (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (dirty.current) await save(false, true);
    nav(to);
  };

  const run = async () => {
    if (inputError) { setShowInput(true); flash(`Run input: ${inputError}`); return; }
    if (!(await save(false, true))) return;
    try {
      const { run } = await api.post(`/runs/workflow/${id}`, { input: JSON.parse(runInput || '{}') });
      nav(`/runs/${run.id}`);
    } catch (e: any) { flash(e.message); }
  };

  const duplicate = async () => {
    if (!(await save(false, true))) return; // copy what's on screen, including unsaved edits
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
  // "Fill in PASTE_…" is not a mistake, just setup still to do: show it as a friendly checklist, not red errors.
  const setupIssues = errors.filter((i) => /^Fill in PASTE_/.test(i.message));
  const otherErrors = errors.filter((i) => !/^Fill in PASTE_/.test(i.message));

  if (loadError) {
    return loadError.status === 404 || loadError.status === 400
      ? <NotFound what="workflow" />
      : <div className="max-w-md mx-auto mt-24 card p-6 text-center space-y-3"><div className="font-semibold">Could not open this workflow</div><div className="text-sm text-slate-400">{loadError.message}</div><button className="btn btn-primary" onClick={() => { setLoadError(null); load(); }}>Try again</button></div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 min-h-14 border-b border-edge bg-panel">
        <Link to="/" className="btn" onClick={leave('/')}>← Back</Link>
        <input className="input max-w-xs" value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} />
        {otherErrors.length > 0 && <span className="badge bg-red-500/20 text-red-300">{otherErrors.length} error(s)</span>}
        {setupIssues.length > 0 && <span className="badge bg-amber-500/20 text-amber-300" title="Open the ⚙ Settings step and fill in the PASTE_ values">⚙ Setup needed</span>}
        <span className={`text-xs whitespace-nowrap ${saveState === 'error' ? 'text-red-400' : saveState === 'saved' ? 'text-slate-500' : 'text-amber-400'}`} data-testid="save-state" aria-live="polite">
          {saveState === 'saved' ? '✓ All changes saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? '⚠ Not saved — press Save' : 'Unsaved changes…'}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link to={`/workflows/${id}/runs`} className="btn" onClick={leave(`/workflows/${id}/runs`)}>Run history</Link>
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
          <button className="btn btn-primary" onClick={run} disabled={errors.length > 0}
            title={setupIssues.length ? 'Finish the setup first (see the left panel)' : errors.length ? 'Fix the problems listed on the left first' : 'Run the workflow now (a test run)'}>▶ Run</button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* palette */}
        <Panel side="left" storageKey="palette" defaultWidth={window.innerWidth < 1200 ? 160 : 190} defaultCollapsed={window.innerWidth < 1050} min={150} max={420} title="Add steps">
        <div className="p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-400 uppercase">Add node</div>
          {(Object.keys(NODE_DEFS) as NodeType[]).filter((t) => t !== 'trigger').map((t) => (
            <button key={t} className="btn w-full justify-start" onClick={() => addNode(t)} title={NODE_DEFS[t].description}>
              <span style={{ color: NODE_DEFS[t].color }}>{NODE_DEFS[t].icon}</span> {NODE_DEFS[t].label}
            </button>
          ))}
          {setupIssues.length > 0 && (
            <div className="mt-4 text-xs space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2" data-testid="setup-needed">
              <div className="font-semibold text-amber-300">⚙ Finish setup ({setupIssues.length})</div>
              <div className="text-amber-200/80">Click an item to open that step, then replace the PASTE_… text with your own value.</div>
              {setupIssues.map((i, k) => (
                <button key={k} className="block w-full text-left text-amber-100 hover:underline break-words [overflow-wrap:anywhere]" onClick={() => i.nodeId && setSelected(i.nodeId)}>• {i.message}</button>
              ))}
            </div>
          )}
          {otherErrors.length > 0 && (
            <div className="mt-4 text-xs space-y-1">
              <div className="font-semibold text-red-400">Needs fixing</div>
              {otherErrors.map((i, k) => (
                <button key={k} className="block w-full text-left text-red-300 hover:underline" onClick={() => i.nodeId && setSelected(i.nodeId)}>• {i.message}</button>
              ))}
            </div>
          )}
          {issues.filter((i) => i.level !== 'error').length > 0 && (
            <div className="mt-4 text-xs space-y-1">
              <div className="font-semibold text-amber-400">Tips</div>
              {issues.filter((i) => i.level !== 'error').map((i, k) => <div key={k} className="text-amber-300">• {i.message}</div>)}
            </div>
          )}
        </div>
        </Panel>

        {/* canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes} edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            fitView fitViewOptions={{ maxZoom: 1, padding: 0.15 }} minZoom={0.2} maxZoom={1.6} proOptions={{ hideAttribution: true }}
          >
            <Background color="#1e2636" gap={18} />
            <Controls />
            <MiniMap pannable zoomable maskColor="#0b0e14cc" style={{ background: '#111826' }} nodeColor={(n) => NODE_DEFS[(n.data as any).nodeType as NodeType]?.color || '#888'} />
          </ReactFlow>
          {nodes.length <= 1 && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 w-[min(520px,90%)] card p-4 text-sm pointer-events-none" data-testid="empty-hint">
              <div className="font-semibold mb-1">👋 Start building</div>
              <div className="text-slate-300">Click a step in the <b>left bar</b> (try <b>HTTP Request</b>). It joins the chain automatically — then fill it in on the right and press <b>▶ Run</b>.</div>
              <div className="text-slate-500 text-xs mt-1">Changes save by themselves. Want it ready-made? Go back and pick a template.</div>
            </div>
          )}
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
        <Panel side="right" storageKey="inspector" defaultWidth={window.innerWidth < 1200 ? 300 : 340} min={280} max={760} title="Step settings">
          <Inspector node={selNode as any} onChange={patchSelected} onDelete={deleteSelected} upstream={upstream} workflowId={id} />
        </Panel>
      </div>
    </div>
  );
}

export default function Editor() {
  return <ReactFlowProvider><EditorInner /></ReactFlowProvider>;
}
