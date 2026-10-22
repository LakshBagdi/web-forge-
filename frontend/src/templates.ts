import { API_ORIGIN } from './apiOrigin';
/** Ready-made workflows. "Mock" URLs hit FlowForge's built-in demo endpoints so every template runs offline. */
export interface Template { key: string; group: 'real' | 'demo'; name: string; emoji: string; blurb: string; needs?: string; hint: string; graph: { nodes: any[]; edges: any[] }; }

const trig = (x = 60, y = 160) => ({ id: 'trigger', type: 'trigger', label: 'Start', position: { x, y }, config: {} });

const SETTINGS_LABEL = '⚙ Settings (fill in)';
const H = (id: string, label: string, x: number, y: number, config: any, extra: any = {}) => ({ id, type: 'http', label, position: { x, y }, config: { headers: {}, bodyType: 'json', failOnErrorStatus: true, ...config }, ...extra });
const T = (id: string, label: string, x: number, y: number, mapping: any) => ({ id, type: 'transform', label, position: { x, y }, config: { mapping } });
const DISCORD_NEEDS = 'Discord webhook URL (Channel ⚙ → Integrations → Webhooks → New Webhook → Copy URL)';
const YT_NEEDS = 'YouTube API key + the channel\'s uploads playlist id (channel id with UC changed to UU)';

/** New YouTube video -> post to Discord or X. Everything you must fill in lives in the ⚙ Settings node. */
function youtubeTemplate(target: 'discord' | 'x'): Template {
  const post = target === 'discord'
    ? H('post', 'Post to Discord', 870, 140, { method: 'POST', url: '{{steps.settings.output.discordUrl}}',
        bodyMode: 'message', messageFormat: 'discord', message: '🎬 New video: {{steps.fetch.output.body.items.0.snippet.title}} https://youtu.be/{{steps.fetch.output.body.items.0.snippet.resourceId.videoId}}' },
        { retry: { maxAttempts: 3, backoffMs: 1500 } })
    : H('post', 'Post to X (pick your X credential)', 870, 140, { method: 'POST', url: 'https://api.twitter.com/2/tweets',
        bodyMode: 'message', messageFormat: 'x', message: '🎬 New video: {{steps.fetch.output.body.items.0.snippet.title}} https://youtu.be/{{steps.fetch.output.body.items.0.snippet.resourceId.videoId}}' },
        { retry: { maxAttempts: 2, backoffMs: 2000 } });
  const settings = target === 'discord'
    ? { playlistId: 'PASTE_UPLOADS_PLAYLIST_ID', youtubeApiKey: 'PASTE_YOUTUBE_API_KEY', discordUrl: 'PASTE_DISCORD_WEBHOOK_URL' }
    : { playlistId: 'PASTE_UPLOADS_PLAYLIST_ID', youtubeApiKey: 'PASTE_YOUTUBE_API_KEY' };
  return {
    key: target === 'discord' ? 'yt-discord' : 'yt-x', group: 'real', emoji: '🎬',
    name: target === 'discord' ? 'New YouTube video → Discord message' : 'New YouTube video → post on X',
    blurb: 'Checks a channel for a new upload and posts it. Open ⚙ Settings, paste your values, Save, Run. Then add a repeating schedule (every 5–15 min).',
    needs: target === 'discord' ? `${YT_NEEDS}; ${DISCORD_NEEDS}` : `${YT_NEEDS}; an oauth2 credential for X (Credentials page) chosen on the post node`,
    hint: 'Fill the PASTE_ values in the ⚙ Settings node. "Run on first check" is on so your first Run posts the latest video once; untick it on the "New video?" node afterwards if you only want future videos. Then ⏰ Schedule → Repeat.',
    graph: {
      nodes: [
        trig(60, 40),
        T('settings', SETTINGS_LABEL, 330, 40, settings),
        H('fetch', 'Latest video', 600, 40, { method: 'GET', url: 'https://www.googleapis.com/youtube/v3/playlistItems',
          query: { part: 'snippet', maxResults: '1', playlistId: '{{steps.settings.output.playlistId}}', key: '{{steps.settings.output.youtubeApiKey}}' } }),
        { id: 'watch', type: 'watch', label: 'New video?', position: { x: 600, y: 200 }, config: { value: '{{steps.fetch.output.body.items.0.snippet.resourceId.videoId}}', fireOnFirstRun: true } },
        post,
        T('idle', 'Nothing new', 870, 300, { note: 'no new video' }),
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'settings' }, { id: 'e2', source: 'settings', target: 'fetch' }, { id: 'e3', source: 'fetch', target: 'watch' },
        { id: 'e4', source: 'watch', target: 'post', sourceHandle: 'true' }, { id: 'e5', source: 'watch', target: 'idle', sourceHandle: 'false' },
      ],
    },
  };
}

export const TEMPLATES: Template[] = [
  youtubeTemplate('discord'),
  youtubeTemplate('x'),
  {
    key: 'meet-real', group: 'real', emoji: '📅', name: 'Create a real Google Meet (at a set time)',
    blurb: 'Creates a Google Calendar event with a Meet link and posts the link to Discord. Pick your Google credential on the Meet node, add ⏰ Schedule → Run once.',
    needs: `an oauth2 credential for Google (Credentials page); ${DISCORD_NEEDS}`,
    hint: 'Fill ⚙ Settings, choose your Google oauth2 credential in the "Authentication" box of the Meet node, Save, Run to test. For an exact time: ⏰ Schedule → 📌 Run once. The meeting starts 5 minutes after the run (change {{now.in5min}} in the Meet node for another offset).',
    graph: {
      nodes: [
        trig(),
        T('settings', SETTINGS_LABEL, 300, 160, { title: 'Team sync', discordUrl: 'PASTE_DISCORD_WEBHOOK_URL' }),
        H('meet', 'Create Meet (pick Google credential)', 580, 160, { method: 'POST', url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
          body: { summary: '{{steps.settings.output.title}}', start: { dateTime: '{{now.in5min}}' }, end: { dateTime: '{{now.in30min}}' },
            conferenceData: { createRequest: { requestId: 'ff-{{now.epochMs}}', conferenceSolutionKey: { type: 'hangoutsMeet' } } } } },
          { retry: { maxAttempts: 2, backoffMs: 1500 } }),
        H('share', 'Post link to Discord', 880, 160, { method: 'POST', url: '{{steps.settings.output.discordUrl}}',
          bodyMode: 'message', messageFormat: 'discord', message: '📅 {{steps.settings.output.title}} — join: {{steps.meet.output.body.hangoutLink}}' }),
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'settings' }, { id: 'e2', source: 'settings', target: 'meet' }, { id: 'e3', source: 'meet', target: 'share' }],
    },
  },
  {
    key: 'tweet', group: 'real', emoji: '🐦', name: 'Post a tweet on X',
    blurb: 'The simplest X automation: one post. Edit the text in ⚙ Settings, pick your X credential, Run. Add a schedule or webhook to automate it.',
    needs: 'an oauth2 credential for X (Credentials page → X link; get the refresh token with scripts/x-get-refresh-token.mjs)',
    hint: 'Choose your X oauth2 credential in the Authentication box of the Post node. X rejects an identical tweet twice, so the default text ends with the run time.',
    graph: {
      nodes: [
        trig(),
        T('settings', SETTINGS_LABEL, 300, 160, { tweetText: 'Hello from FlowForge! {{now.iso}}' }),
        H('tweet', 'Post to X (pick X credential)', 580, 160, { method: 'POST', url: 'https://api.twitter.com/2/tweets', bodyMode: 'message', messageFormat: 'x', message: '{{steps.settings.output.tweetText}}' }),
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'settings' }, { id: 'e2', source: 'settings', target: 'tweet' }],
    },
  },
  {
    key: 'hook-discord', group: 'real', emoji: '🪝', name: 'Webhook → Discord message',
    blurb: 'Give any app the Start node\'s secret URL; whatever it sends as {"message":"..."} appears in your Discord channel.',
    needs: DISCORD_NEEDS,
    hint: 'Fill ⚙ Settings, Save, click the Start node and copy the Webhook URL, then: curl -X POST <url> -H "content-type: application/json" -d \'{"message":"hello"}\'',
    graph: {
      nodes: [
        trig(),
        T('settings', SETTINGS_LABEL, 300, 160, { discordUrl: 'PASTE_DISCORD_WEBHOOK_URL' }),
        H('post', 'Post to Discord', 580, 160, { method: 'POST', url: '{{steps.settings.output.discordUrl}}', bodyMode: 'message', messageFormat: 'discord', message: '{{input.message}}' }),
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'settings' }, { id: 'e2', source: 'settings', target: 'post' }],
    },
  },
  {
    key: 'meet', group: 'demo', name: 'Meet at a set time (offline demo)', emoji: '📅',
    blurb: 'Add a one-time schedule (⏰ Schedule → Run once). At that moment it creates a calendar event with a Meet link and posts the link.',
    hint: 'Runs offline against the demo calendar. For real Google: change the URL to https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1 and pick an OAuth2 credential.',
    graph: {
      nodes: [
        trig(),
        { id: 'meet', type: 'http', label: 'Create Meet event', position: { x: 320, y: 160 }, config: {
          method: 'POST', url: `${API_ORIGIN}/mock/calendar/events`, headers: {}, bodyType: 'json', failOnErrorStatus: true,
          body: { summary: 'Team sync', start: '{{now.in5min}}', end: '{{now.in30min}}', conferenceData: { createRequest: { requestId: 'ff-{{now.epochMs}}', conferenceSolutionKey: { type: 'hangoutsMeet' } } } } },
          retry: { maxAttempts: 3, backoffMs: 1000 } },
        { id: 'share', type: 'http', label: 'Post the link', position: { x: 600, y: 160 }, config: {
          method: 'POST', url: `${API_ORIGIN}/mock/notify`, headers: {}, bodyType: 'json', failOnErrorStatus: true,
          body: { text: 'Meeting starts soon: {{steps.meet.output.body.hangoutLink}}' } } },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'meet' }, { id: 'e2', source: 'meet', target: 'share' }],
    },
  },
  {
    key: 'watch', group: 'demo', name: 'New video → post it somewhere', emoji: '🎬',
    blurb: 'Checks a channel every few minutes (add a Repeat schedule). Only when a NEW video appears, it posts. Works the same for tweets, RSS, prices…',
    hint: 'Demo channel included: open /mock/latest-video/publish (POST) to simulate a new upload. For real YouTube: GET https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=…&order=date&maxResults=1&type=video with query param key=YOUR_KEY, watch items.0.id.videoId.',
    graph: {
      nodes: [
        trig(),
        { id: 'fetch', type: 'http', label: 'Latest video', position: { x: 300, y: 160 }, config: { method: 'GET', url: `${API_ORIGIN}/mock/latest-video`, query: { channel: 'demo' }, headers: {}, failOnErrorStatus: true } },
        { id: 'watch', type: 'watch', label: 'New video?', position: { x: 560, y: 160 }, config: { value: '{{steps.fetch.output.body.id}}', fireOnFirstRun: false } },
        { id: 'post', type: 'http', label: 'Post it', position: { x: 840, y: 90 }, config: {
          method: 'POST', url: `${API_ORIGIN}/mock/notify`, headers: {}, bodyType: 'json', failOnErrorStatus: true,
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
    key: 'webhook', group: 'demo', name: 'Webhook → alert (offline demo)', emoji: '🪝',
    blurb: 'Any app can POST JSON to this workflow\'s webhook URL (see the Start node). If amount > 100, send a message; otherwise just log it.',
    hint: 'Open the Start node to copy the webhook URL and a curl example. Works for Stripe, GitHub, Zapier, your own code, anything that sends HTTP.',
    graph: {
      nodes: [
        trig(),
        { id: 'big', type: 'condition', label: 'Big amount?', position: { x: 320, y: 160 }, config: { left: '', operator: 'eq', right: '', expression: 'input.amount > 100' } },
        { id: 'alert', type: 'http', label: 'Send alert', position: { x: 620, y: 80 }, config: {
          method: 'POST', url: `${API_ORIGIN}/mock/notify`, headers: {}, bodyType: 'json', failOnErrorStatus: true,
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
