import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import ReactFlow, { Background, Controls, Node, Edge, MarkerType, ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';
import { api, streamUrl } from '../api';
import { nodeTypes, FlowNodeData } from '../flow/CustomNodes';
import { NodeType, STATUS_STYLE } from '../constants';

interface LogLine { id: number; nodeId: string | null; level: string; message: string; ts: string; }

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
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    api.get(`/runs/${id}`).then((d) => {
      setGraph(d.run.graph);
      setState(d.run.node_state || {});
      setStatus(d.run.status);
    });
    api.get(`/runs/${id}/logs`).then((d) => setLogs(d.logs));

    es = new EventSource(streamUrl(id!));
    es.addEventListener('node.status', (e: any) => {
      const { nodeId, state: st } = JSON.parse(e.data);
      setState((s) => ({ ...s, [nodeId]: st }));
    });
    es.addEventListener('run.status', (e: any) => {
      const { status } = JSON.parse(e.data);
      setStatus(status);
      if (['success', 'failed', 'cancelled'].includes(status)) { es?.close(); }
    });
    es.addEventListener('log', (e: any) => {
      const l = JSON.parse(e.data);
      setLogs((prev) => [...prev, l]);
    });
    es.addEventListener('done', () => es?.close());
    es.onerror = () => { /* SSE auto-reconnects; snapshot already loaded */ };
    return () => es?.close();
  }, [id]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs]);

  const { nodes, edges } = buildFlow(graph, state);
  const st = STATUS_STYLE[status] || STATUS_STYLE.pending;

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
        <div className="ml-auto flex gap-2">
          {['queued', 'running'].includes(status) && <button className="btn" onClick={cancel}>Cancel</button>}
          {status === 'failed' && <button className="btn btn-primary" onClick={retry}>↻ Retry from failed</button>}
        </div>
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView
            nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            proOptions={{ hideAttribution: true }}>
            <Background color="#1e2636" gap={18} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="w-96 border-l border-edge bg-panel flex flex-col">
          <div className="px-4 py-2 border-b border-edge text-sm font-semibold">Execution log</div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
            {logs.map((l) => (
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
      </div>
    </div>
  );
}

export default function RunView() {
  return <ReactFlowProvider><Inner /></ReactFlowProvider>;
}
