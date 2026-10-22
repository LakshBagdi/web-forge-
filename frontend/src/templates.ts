/** Ready-made workflows. "Mock" URLs hit FlowForge's built-in demo endpoints so every template runs offline. */
export interface Template { key: string; name: string; emoji: string; blurb: string; hint: string; graph: { nodes: any[]; edges: any[] }; }

const trig = (x = 60, y = 160) => ({ id: 'trigger', type: 'trigger', label: 'Start', position: { x, y }, config: {} });

export const TEMPLATES: Template[] = [
  {
    key: 'meet', name: 'Create a Google Meet at a set time', emoji: '📅',
    blurb: 'Add a one-time schedule (⏰ Schedule → Run once). At that moment it creates a calendar event with a Meet link and posts the link.',
    hint: 'Runs offline against the demo calendar. For real Google: change the URL to https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1 and pick an OAuth2 credential.',
    graph: {
      nodes: [
        trig(),
        { id: 'meet', type: 'http', label: 'Create Meet event', position: { x: 320, y: 160 }, config: {
          method: 'POST', url: 'http://localhost:4000/mock/calendar/events', headers: {}, bodyType: 'json', failOnErrorStatus: true,
          body: { summary: 'Team sync', start: '{{now.in5min}}', end: '{{now.in30min}}', conferenceData: { createRequest: { requestId: 'ff-{{now.epochMs}}', conferenceSolutionKey: { type: 'hangoutsMeet' } } } } },
          retry: { maxAttempts: 3, backoffMs: 1000 } },
        { id: 'share', type: 'http', label: 'Post the link', position: { x: 600, y: 160 }, config: {
          method: 'POST', url: 'http://localhost:4000/mock/notify', headers: {}, bodyType: 'json', failOnErrorStatus: true,
          body: { text: 'Meeting starts soon: {{steps.meet.output.body.hangoutLink}}' } } },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'meet' }, { id: 'e2', source: 'meet', target: 'share' }],
    },
  },
  {
    key: 'watch', name: 'New video → post it somewhere', emoji: '🎬',
    blurb: 'Checks a channel every few minutes (add a Repeat schedule). Only when a NEW video appears, it posts. Works the same for tweets, RSS, prices…',
    hint: 'Demo channel included: open /mock/latest-video/publish (POST) to simulate a new upload. For real YouTube: GET https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=…&order=date&maxResults=1&type=video with query param key=YOUR_KEY, watch items.0.id.videoId.',
    graph: {
      nodes: [
        trig(),
        { id: 'fetch', type: 'http', label: 'Latest video', position: { x: 300, y: 160 }, config: { method: 'GET', url: 'http://localhost:4000/mock/latest-video', query: { channel: 'demo' }, headers: {}, failOnErrorStatus: true } },
        { id: 'watch', type: 'watch', label: 'New video?', position: { x: 560, y: 160 }, config: { value: '{{steps.fetch.output.body.id}}', fireOnFirstRun: false } },
        { id: 'post', type: 'http', label: 'Post it', position: { x: 840, y: 90 }, config: {
          method: 'POST', url: 'http://localhost:4000/mock/notify', headers: {}, bodyType: 'json', failOnErrorStatus: true,
          body: { text: 'New video: {{steps.fetch.output.body.title}} {{steps.fetch.output.body.url}}' } }, retry: { maxAttempts: 3, backoffMs: 1000 } },
        { id: 'idle', type: 'transform', label: 'Nothing new', position: { x: 840, y: 250 }, config: { mapping: { note: 'no new video' } } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'fetch' }, { id: 'e2', source: 'fetch', target: 'watch' },
        { id: 'e3', source: 'watch', target: 'post', sourceHandle: 'true' }, { id: 'e4', source: 'watch', target: 'idle', sourceHandle: 'false' },
      ],
    },
  },
  {
    key: 'webhook', name: 'Webhook → alert on important events', emoji: '🪝',
    blurb: 'Any app can POST JSON to this workflow\'s webhook URL (see the Start node). If amount > 100, send a message; otherwise just log it.',
    hint: 'Open the Start node to copy the webhook URL and a curl example. Works for Stripe, GitHub, Zapier, your own code, anything that sends HTTP.',
    graph: {
      nodes: [
        trig(),
        { id: 'big', type: 'condition', label: 'Big amount?', position: { x: 320, y: 160 }, config: { left: '', operator: 'eq', right: '', expression: 'input.amount > 100' } },
        { id: 'alert', type: 'http', label: 'Send alert', position: { x: 620, y: 80 }, config: {
          method: 'POST', url: 'http://localhost:4000/mock/notify', headers: {}, bodyType: 'json', failOnErrorStatus: true,
          body: { text: 'Large payment of {{input.amount}} from {{input.customer}}' } } },
        { id: 'log', type: 'transform', label: 'Just record', position: { x: 620, y: 250 }, config: { mapping: { amount: '{{input.amount}}' } } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'big' },
        { id: 'e2', source: 'big', target: 'alert', sourceHandle: 'true' }, { id: 'e3', source: 'big', target: 'log', sourceHandle: 'false' },
      ],
    },
  },
];
