import { Link } from 'react-router-dom';

/** Friendly dead-end for a workflow/run that is gone or never existed. */
export default function NotFound({ what, detail }: { what: string; detail?: string }) {
  return (
    <div className="max-w-md mx-auto mt-24 card p-6 text-center space-y-3" data-testid="not-found">
      <div className="text-3xl">🔍</div>
      <div className="font-semibold">This {what} could not be found</div>
      <div className="text-sm text-slate-400">It may have been deleted, or the link is wrong{detail ? ` (${detail})` : ''}.</div>
      <Link to="/" className="btn btn-primary inline-flex">← Back to your workflows</Link>
    </div>
  );
}
