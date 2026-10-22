/** Address of the FlowForge server itself, used by the offline demo templates ("/mock/…" test endpoints).
 *  dev: http://localhost:4000 · built & served by the backend (deployed): the page's own address · split hosting: VITE_API_BASE. */
export const API_ORIGIN: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);
