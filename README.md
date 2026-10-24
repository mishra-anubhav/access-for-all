# AccessForAll

**Every voice understood. Every opportunity accessible.**

AccessForAll is a live accessibility companion for conferences, lectures, and meetings. It turns spoken information into captions, translations, plain-language explanations, contextual answers, and notes attendees can save when they choose.

## Architecture

- **Next.js App Router + TypeScript** provides the responsive web interface and server routes.
- **OpenAI Realtime transcription** captures microphone audio in the browser over WebRTC. The server creates a short-lived client secret; the permanent OpenAI key stays on the server. Finalized transcript segments are not persisted by default, and raw audio is not stored by AccessForAll.
- **TrueForge 0.180.0** runs the reasoning agent using the OpenAI model already configured in TrueForge. The app discovers configured models and prefers `openai/gpt-6.1-sol` at medium reasoning effort when present.
- **AccessForAll MCP tools** retrieve temporary transcript context, search the clearly labeled sample agenda, prepare accommodation drafts, and record an explicitly approved action in a local demo inbox. TrueForge holds the agent turn at `submit_approved_request` until the attendee approves it.
- **Local browser storage** holds accessibility preferences and notes only after the attendee saves them.

## Features in this MVP

- Live microphone transcription with partial and finalized caption states, connection and permission status, elapsed time, and an activity indicator.
- English, Hindi, Spanish, French, and Mandarin Chinese caption translation. Translation runs after a caption finalizes and can lag behind the original.
- TrueForge workflows for simplification, transcript-grounded questions, structured notes, session recommendations, and accommodation requests.
- Visible TrueForge tool activity and a human approval checkpoint before the demo submission tool runs.
- Adjustable caption size and line spacing, high contrast, dark appearance, reduced motion, keyboard focus, and responsive layouts.
- Notes can be searched, copied, downloaded as Markdown, and saved locally.
- Agenda recommendations use sample data clearly identified as unverified. Text and CSV uploads are accepted; PDF extraction is not included.

## Requirements

- Node.js 22.14 or later (required by the installed TrueForge 0.180.0 package).
- A local TrueForge instance, normally `http://localhost:8790`, with an OpenAI model configured under **Settings → Models**. TrueForge 0.180.0 exposes its HTTP API and OpenAPI docs at `/api/v1/docs`.
- An OpenAI API project key for live transcription. The TrueForge provider credential is separate from the Next.js server credential.
- A modern browser with microphone access. Microphone capture works on localhost or HTTPS.

## Local setup

```bash
npm install
cp .env.example .env.local
```

Set `OPENAI_API_KEY` in `.env.local`. Do not commit `.env.local` or any real key. Then start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Keep the TrueForge service running separately at its configured base URL.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Server-only key used to mint short-lived Realtime transcription credentials. |
| `TRUEFORGE_BASE_URL` | TrueForge HTTP API base URL; defaults to `http://localhost:8790`. |
| `TRUEFORGE_TOKEN` | Optional TrueForge bearer token if login is enabled. |
| `TRUEFORGE_MODEL` | Optional model FQN override. Otherwise, AccessForAll discovers configured models and prefers `openai/gpt-6.1-sol`. |
| `TRUEFORGE_MCP_SERVER` | MCP connector name; defaults to `accessforall-tools`. The app registers it in TrueForge settings on first tool workflow if it is missing. |
| `TRUEFORGE_MCP_URL` | MCP endpoint URL TrueForge should call; defaults to `http://localhost:3000/api/mcp`. |
| `MCP_SERVER_TOKEN` | Optional bearer token for the MCP endpoint. Set this in public deployments and keep it server-side. |
| `NEXT_PUBLIC_APP_URL` | App base URL used when registering the local MCP connector. Set it to the deployed HTTPS origin for a hosted MCP endpoint. |

The first tool-backed action registers a named remote MCP connector through TrueForge's settings API if none exists. If the configured name already points somewhere else, setup stops with an error rather than replacing it.

TrueForge's outbound network guard may block a connector targeting `localhost` or another private address. For a local-only demo, review the access this permits and start TrueForge with `OUTBOUND_URL_ALLOWED_HOSTS=["localhost"]`; restart the TrueForge process after changing its environment. Keep TrueForge bound to loopback. The app reports this condition when the tool bridge is blocked. For a hosted deployment, use a reachable HTTPS MCP URL and keep TrueForge's network guard enabled.

## TrueForge configuration

The agent uses the installed TrueForge HTTP/SSE API and TypeScript SDK. It does not call OpenAI chat directly. Configure an OpenAI model in TrueForge first; the app automatically selects the configured `openai/gpt-6.1-sol` model if it is present, otherwise the first configured OpenAI model. `TRUEFORGE_MODEL` can override that choice with a model FQN shown in TrueForge.

The AccessForAll MCP connector is created lazily at the first transcript question, recommendation, or accommodation workflow. It exposes:

- `get_transcript_segments` and `get_session_context` for temporary context retrieval.
- `search_conference_schedule` for sample, unverified schedule data.
- `prepare_accommodation_request` to prepare a draft without submitting it.
- `submit_approved_request`, which is configured to require TrueForge's human approval event. It writes only to the local demo inbox and does not send email or contact a real organizer.

For a hosted deployment, the TrueForge server must be able to reach the app's HTTPS `TRUEFORGE_MCP_URL`. Configure `MCP_SERVER_TOKEN` and ensure the connector is registered with that same bearer token. This MVP has no attendee accounts or cross-device sync.

## Demo walkthrough

1. Open **Accessibility settings** and choose Hindi (or another supported language) and an explanation level.
2. Open **Live session** and press **Start listening**. Grant microphone access and speak the demo sentence or another short talk excerpt.
3. Watch partial captions update and finalized segments settle. Translations arrive asynchronously.
4. Choose **Simplify this** or ask a question in the side panel. The question workflow retrieves transcript segments through TrueForge MCP tools.
5. Generate session notes and save or download them. Saved notes are stored in this browser only.
6. Request an accommodation. Review the request and the TrueForge approval panel; allow it to record a clearly labeled demo confirmation, or decline it. No email is sent.

## Privacy and limitations

- Microphone access is requested only after the attendee starts listening. The app stops tracks and closes the WebRTC session when listening ends or the 60-minute session cap is reached.
- Audio is streamed to OpenAI for transcription. OpenAI processing is subject to the configured account's policies; AccessForAll does not retain the raw audio.
- Finalized transcript context is held temporarily in server memory for up to 30 minutes and is sent to TrueForge when the attendee asks for AI help. It is not written to a database.
- Notes and preferences are kept in browser `localStorage` until the attendee clears browser data. There is no user authentication, database, backup, or cross-device sync.
- The sample agenda and demo organizer inbox are not real event information or a real submission integration.
- This MVP does not parse PDF agendas, produce a downloadable PDF, or include a production organizer/email connection.
- Live captions and AI-generated output may contain errors; users should confirm important details with the speaker or event team.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

The microphone and WebRTC workflow also needs a browser check with microphone permission. To confirm the real TrueForge workflow, run a transcript question with the local TrueForge instance and configured OpenAI provider available.
