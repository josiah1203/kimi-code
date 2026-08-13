# SpiderByte Web

The hosted SpiderByte frontend is a Next.js App Router application with Clerk
authentication and Clerk Billing UI. The local commercial packages remain the
source of truth for SpiderByte accounts, entitlements, usage, and audit state.

## Development

From the repository root:

```bash
pnpm install
pnpm dev:web
```

The app runs at `http://localhost:3000`. The Clerk CLI can refresh the local
development keys with:

```bash
clerk env pull --app YOUR_CLERK_APP_ID --file .env.local
```

Keep `CLERK_SECRET_KEY` server-only. The browser uses only the publishable key
from `.env.local`.
