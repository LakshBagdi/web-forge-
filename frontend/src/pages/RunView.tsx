import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import ReactFlow, { Background, Controls, Node, Edge, MarkerType, ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';
import { api, streamUrl } from '../api';
import { nodeTypes, FlowNodeData } from '../flow/CustomNodes';
import { NodeType, STATUS_STYLE, triggerInfo } from '../constants';
import { explainError } from '../friendlyError';
import NotFound from '../components/NotFound';
import Panel from '../components/Panel';

interface LogLine { id: number; nodeId: string | null; level: string; message: string; ts: string; }

// Progress only moves forward. This stops a slow, older response from overwriting
// a newer live update (e.g. showing "Running" after the run already finished).
const RANK: Record<string, number> = { '': 0, pending: 0, queued: 0, running: 1, success: 2, failed: 2, skipped: 2, cancelled: 2 };
const TERMINAL = ['success', 'failed', 'cancelled'];
const forward = (prev: string, next: string) => ((RANK[next] ?? 0) >= (RANK[prev] ?? 0) ? next : prev);

function mergeNodeState(prev: Record<string, any>, next: Record<string, any>) {
  const out = { ...prev };
  for (const [id, st] of Object.entries(next || {})) {
    const old = out[id];
    if (!old || (RANK[st.status] ?? 0) >= (RANK[old.status] ?? 0)) out[id] = st;
  }
  return out;
}

function mergeLogs(prev: LogLine[], incoming: LogLine[]) {
  if (!incoming.length) return prev;
  const seen = new Set(prev.map((l) => String(l.id)));
  const add = incoming.filter((l) => !seen.has(String(l.id)));
  if (!add.length) return prev;
  return [...prev, ...add].sort((a, b) => Number(a.id) - Number(b.id));
}

function buildFlow(graph: any, state: Record<string, any>): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes = (graph.nodes || []).map((n: any) => ({
    id: n.id, type: n.type, position: n.position || { x: 0, y: 0 }, draggable: false,
    data: { label: n.label, nodeType: n.type as NodeType, config: n.config || {}, status: state[n.id]?.status, attempts: state[n.id]?.attempts } as any,
  }));
  const edges = (graph.edges || []).map((e: any) => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: state[e.source]?.status === 'running',
    style: e.sourceHandle === 'true' ? { stroke: '#10b981' } : e.sourceHandle === 'false' ? { stroke: '#ef4444' } : undefined,
  }));
  return { nodes, edges };
}

function Inner() {
  const { id } = useParams();
  const nav = useNavigate();
  const [graph, setGraph] = useState<any>({ nodes: [], edges: [] });
  const [state, setState] = useState<Record<string, any>>({});
  const [status, setStatus] = useState('');
  const [wfId, setWfId] = useState('');
  const [trig, setTrig] = useState('');
  const [missing, setMissing] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [onlyStep, setOnlyStep] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const lastLogId = useRef(0);
  const statusRef = useRef('');

  const applyRun = (run: any) => {
    setGraph(run.graph);
    setWfId(run.workflow_id);
    setTrig(run.trigger);
    setState((s) => mergeNodeState(s, run.node_state || {}));
    setStatus((s) => forward(s, run.status));
  };
  const addLogs = (incoming: LogLine[]) => {
    setLogs((prev) => mergeLogs(prev, incoming));
    for (const l of incoming) lastLogId.current = Math.max(lastLogId.current, Number(l.id) || 0);
  };
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const refresh = async () => {
      try {
        const [r, l] = await Promise.all([
          api.get(`/runs/${id}`),
          api.get(`/runs/${id}/logs?after=${lastLogId.current}`),
        ]);
        if (cancelled) return;
        applyRun(r.run);
        addLogs(l.logs);
        if (TERMINAL.includes(r.run.status) && poll) { clearInterval(poll); poll = null; }
      } catch (e: any) {
        if (e?.status === 404 || e?.status === 400) { if (!cancelled) setMissing(true); if (poll) { clearInterval(poll); poll = null; } }
        /* otherwise transient; next tick retries */
      }
    };

    refresh();
    // Safety net: poll while the run is active, in case a live event is missed.
    poll = setInterval(() => { if (!TERMINAL.includes(statusRef.current)) refresh(); }, 1500);

    es = new EventSource(streamUrl(id!));
    es.addEventListener('snapshot', (e: any) => applyRun(JSON.parse(e.data).run));
    es.addEventListener('node.status', (e: any) => {
      const { nodeId, state: st } = JSON.parse(e.data);
      setState((s) => mergeNodeState(s, { [nodeId]: st }));
    });
    es.addEventListener('run.status', (e: any) => {
      const { status } = JSON.parse(e.data);
      setStatus((s) => forward(s, status));
      if (TERMINAL.includes(status)) { es?.close(); setTimeout(refresh, 300); } // final consistent read
    });
    es.addEventListener('log', (e: any) => addLogs([JSON.parse(e.data)]));
    es.addEventListener('done', () => es?.close());
    es.onerror = () => { /* EventSource reconnects on its own; polling covers the gap */ };

    return () => { cancelled = true; es?.close(); if (poll) clearInterval(poll); };
  }, [id]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs]);

  const { nodes, edges } = buildFlow(graph, state);
  const selNode = sel ? (graph.nodes || []).find((n: any) => n.id === sel) : null;
  const selState = sel ? state[sel] : null;
  const st = STATUS_STYLE[status] || STATUS_STYLE.pending;

  if (missing) return <NotFound what="run" />;

  const retry = async () => {
    const { run } = await api.post(`/runs/${id}/retry`);
    nav(`/runs/${run.id}`);
  };
  const cancel = async () => { await api.post(`/runs/${id}/cancel`); };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-edge bg-panel">
        <Link to="/" className="btn">← Workflows</Link>
        <span className="font-semibold">Run</span>
        <span className={`badge ${st.bg} ${st.text}`}>{st.label}</span>
        {trig && <span className={`badge ${triggerInfo(trig).cls}`} data-testid="run-trigger">{triggerInfo(trig).icon} {triggerInfo(trig).label}</span>}
        {wfId && <Link to={`/editor/${wfId}`} className="btn">Edit workflow</Link>}
        {wfId && <Link to={`/workflows/${wfId}/runs`} className="btn">Run history</Link>}
        <div className="ml-auto flex gap-2">
          {['queued', 'running'].includes(status) && <button className="btn" onClick={cancel}>Cancel</button>}
          {status === 'failed' && <button className="btn btn-primary" onClick={retry}>↻ Retry from failed</button>}
        </div>
      </div>
      {(() => {
        const list = (graph.nodes || []) as any[];
        const total = list.length;
        const okN = list.filter((n) => state[n.id]?.status === 'success').length;
        const skipN = list.filter((n) => state[n.id]?.status === 'skipped').length;
        const failed = list.find((n) => state[n.id]?.status === 'failed');
        const nameOf = (n: any) => n.label || n.id;
        if (status === 'success') return (
          <div className="px-4 py-2 text-sm border-b border-emerald-500/30 bg-emerald-500/10 text-emerald-200" data-testid="run-summary">
            ✓ It worked. {okN} of {total} step{total === 1 ? '' : 's'} ran{skipN ? `, ${skipN} skipped because their path was not taken (that is normal)` : ''}. Click any step to see what it returned.
          </div>);
        if (status === 'failed') {
          const ex = failed ? explainError(state[failed.id]?.error) : null;
          return (
            <div className="px-4 py-2 text-sm border-b border-red-500/30 bg-red-500/10 text-red-100 space-y-0.5" data-testid="run-summary">
              <div>✗ Stopped at “{failed ? nameOf(failed) : 'a step'}”. {ex ? ex.what : (failed ? state[failed.id]?.error : '')}</div>
              {ex && <div className="text-red-200/80">What to do: {ex.fix}</div>}
              <div className="text-red-200/60 text-xs">Click the failed step for details · fix it in <b>Edit workflow</b> · then press <b>↻ Retry from failed</b> (steps that worked are not repeated).</div>
            </div>);
        }
        if (status === 'cancelled') return <div className="px-4 py-2 text-sm border-b border-edge bg-edge/40 text-slate-300" data-testid="run-summary">This run was stopped before it finished.</div>;
        if (status) return <div className="px-4 py-2 text-sm border-b border-edge bg-sky-500/10 text-sky-200" data-testid="run-summary">⏳ Running… {okN} of {total} steps done.</div>;
        return null;
      })()}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView
            nodesDraggable={false} nodesConnectable={false} elementsSelectable
            onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)}
            proOptions={{ hideAttribution: true }}>
            <Background color="#1e2636" gap={18} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <Panel side="right" storageKey="runlog" defaultWidth={400} min={280} max={900} title="Run details" noScroll>
        <div className="flex flex-col flex-1 min-h-0">
          {selNode && (
            <div className="border-b border-edge p-3 text-xs space-y-2 max-h-[50%] overflow-y-auto">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{selNode.label || selNode.id}</span>
                <span className="badge bg-edge text-slate-300">{selNode.type}</span>
                {selState && <span className={`badge ${(STATUS_STYLE[selState.status] || STATUS_STYLE.pending).bg} ${(STATUS_STYLE[selState.status] || STATUS_STYLE.pending).text}`}>{(STATUS_STYLE[selState.status] || STATUS_STYLE.pending).label}</span>}
              </div>
              {selState ? (
                <>
                  <div className="text-slate-400">
                    attempts: {selState.attempts ?? 0}
                    {selState.branch ? ` · branch taken: ${selState.branch}` : ''}
                    {selState.startedAt && selState.finishedAt ? ` · ${new Date(selState.finishedAt).getTime() - new Date(selState.startedAt).getTime()} ms` : ''}
                  </div>
                  {selState.error && (() => { const ex = explainError(selState.error); return (
                    <div><div className="text-red-400 font-semibold">Error</div>
                      {ex && <div className="text-red-200 mb-1">{ex.what} <span className="text-red-200/70">{ex.fix}</span></div>}
                      <pre className="text-red-300 whitespace-pre-wrap">{selState.error}</pre></div>); })()}
                  {selState.output !== undefined && (
                    <div><div className="text-slate-400 font-semibold">Output</div>
                      <pre className="bg-ink rounded p-2 overflow-x-auto max-h-48">{JSON.stringify(selState.output, null, 2)}</pre>
                    </div>
                  )}
                  {selState.status === 'skipped' && <div className="text-slate-500">Not run: the branch leading here was not taken.</div>}
                </>
              ) : <div className="text-slate-500">Not reached yet.</div>}
            </div>
          )}
          <div className="px-4 py-2 border-b border-edge text-sm font-semibold flex items-center gap-2">
            Execution log
            {selNode && (
              <label className="ml-auto flex items-center gap-1 text-xs font-normal text-slate-400">
                <input type="checkbox" checked={onlyStep} onChange={(e) => setOnlyStep(e.target.checked)} /> only this step
              </label>
            )}
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
            {logs.filter((l) => !onlyStep || !sel || l.nodeId === sel).map((l) => (
              <div key={l.id} className="flex gap-2">
                <span className="text-slate-600">{new Date(l.ts).toLocaleTimeString()}</span>
                <span className={
                  l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400'
                  : l.level === 'debug' ? 'text-slate-500' : 'text-slate-300'
                }>{l.nodeId ? `[${l.nodeId}] ` : ''}{l.message}</span>
              </div>
            ))}
            {logs.length === 0 && <div className="text-slate-500">Waiting for logs…</div>}
          </div>
        </div>
        </Panel>
      </div>
    </div>
  );
}

export default function RunView() {
  const { id } = useParams();
  // Key by run id so navigating run -> retry run remounts with fresh state
  // (otherwise the monotonic status merge would keep the old run's final status).
  return <ReactFlowProvider><Inner key={id} /></ReactFlowProvider>;
}
