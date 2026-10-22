/** "Quick setup" choices for the HTTP node: one click fills method, URL and body style. */
export interface Preset { id: string; label: string; help: string; patch: Record<string, any>; }

const CLEAR = { query: {}, body: undefined, bodyType: undefined, bodyMode: undefined, message: undefined, messageFormat: undefined, fields: undefined };

export const PRESETS: Preset[] = [
  { id: 'discord', label: '💬 Send a Discord message', help: 'Paste your Discord webhook URL as the URL (Channel ⚙ → Integrations → Webhooks → New Webhook → Copy URL), then type your message.',
    patch: { ...CLEAR, method: 'POST', url: '', bodyMode: 'message', messageFormat: 'discord', message: 'Hello from FlowForge! 👋' } },
  { id: 'slack', label: '💬 Send a Slack message', help: 'Paste your Slack Incoming Webhook URL as the URL, then type your message.',
    patch: { ...CLEAR, method: 'POST', url: '', bodyMode: 'message', messageFormat: 'slack', message: 'Hello from FlowForge! 👋' } },
  { id: 'x', label: '🐦 Post on X (Twitter)', help: 'Choose your X credential in “Authentication” below, then type the post (max 280 characters).',
    patch: { ...CLEAR, method: 'POST', url: 'https://api.twitter.com/2/tweets', bodyMode: 'message', messageFormat: 'x', message: 'Hello from FlowForge! {{now.iso}}' } },
  { id: 'youtube', label: '🎬 Get a channel’s latest YouTube video', help: 'Replace playlistId with the channel’s uploads id (channel id with UC changed to UU) and key with your YouTube API key.',
    patch: { ...CLEAR, method: 'GET', url: 'https://www.googleapis.com/youtube/v3/playlistItems', query: { part: 'snippet', maxResults: '1', playlistId: 'PASTE_UPLOADS_PLAYLIST_ID', key: 'PASTE_YOUTUBE_API_KEY' } } },
  { id: 'meet', label: '📅 Create a Google Meet event', help: 'Choose your Google credential in “Authentication” below. The Meet link comes back as hangoutLink.',
    patch: { ...CLEAR, method: 'POST', url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', bodyMode: 'json', bodyType: 'json',
      body: { summary: 'Team sync', start: { dateTime: '{{now.in5min}}' }, end: { dateTime: '{{now.in30min}}' }, conferenceData: { createRequest: { requestId: 'ff-{{now.epochMs}}', conferenceSolutionKey: { type: 'hangoutsMeet' } } } } } },
  { id: 'get', label: '⬇ Fetch data from any API (GET)', help: 'Type the API address as the URL. Add extra info under “Query parameters”.', patch: { ...CLEAR, method: 'GET', url: '' } },
  { id: 'post', label: '⬆ Send data to any API (POST)', help: 'Type the API address as the URL, then choose Message, Fields or Custom JSON for what to send.', patch: { ...CLEAR, method: 'POST', url: '', bodyMode: 'fields', fields: {} } },
];
