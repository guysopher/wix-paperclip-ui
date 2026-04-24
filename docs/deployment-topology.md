# Deployment Topology

`wix-paperclip-ui` now supports two independent topology switches:

- `PAPERCLIP_DEPLOYMENT_MODE=remote|local`
- `SITE_AUTOMATION_MODE=bridge|embedded`

## Recommended combinations

### `remote + bridge`

Current split-host setup.

```env
PAPERCLIP_DEPLOYMENT_MODE=remote
PAPERCLIP_API_URL=https://your-paperclip-host/api

SITE_AUTOMATION_MODE=bridge
PICASSO_BRIDGE_URL=https://your-picasso-bridge-host
PICASSO_BRIDGE_TOKEN=...
```

Both remote URLs must be set explicitly in this mode. `PAPERCLIP_DEPLOYMENT_MODE=remote` no longer silently falls back to localhost.

### `local + bridge`

Paperclip runs on the same machine as the browser automation bridge.

```env
PAPERCLIP_DEPLOYMENT_MODE=local
PAPERCLIP_API_URL=http://127.0.0.1:3100/api
PAPERCLIP_RESTART_URL=http://127.0.0.1:3099/restart

SITE_AUTOMATION_MODE=bridge
PICASSO_BRIDGE_URL=http://127.0.0.1:3401
PICASSO_BRIDGE_TOKEN=...
```

Start local Paperclip with:

```bash
paperclipai run
```

### `local + embedded`

Target topology. Paperclip and site automation live behind the same backend.

```env
PAPERCLIP_DEPLOYMENT_MODE=local
PAPERCLIP_API_URL=http://127.0.0.1:3100/api

SITE_AUTOMATION_MODE=embedded
# Required explicit opt-in for embedded mode.
SITE_AUTOMATION_EMBEDDED_URL=http://127.0.0.1:3100/api/site-automation
SITE_AUTOMATION_TOKEN=
```

Embedded mode assumes the Paperclip backend exposes:

- `GET /api/site-automation/health`
- `POST /api/site-automation/jobs`
- `GET /api/site-automation/jobs/:id`

Until the Paperclip backend exposes that route, keep `SITE_AUTOMATION_MODE=bridge`. `wix-paperclip-ui` now treats embedded mode as unconfigured unless `SITE_AUTOMATION_EMBEDDED_URL` is set explicitly.

## Runtime visibility

`POST /api/health` now returns:

- `topology.paperclipDeploymentMode`
- `topology.siteAutomationMode`
- `topology.paperclipApiUrl`
- `topology.siteAutomationBaseUrl`

Use that payload to confirm which topology the app is actually using after an env change.
