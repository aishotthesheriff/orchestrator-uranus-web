# Deploying to Hostinger

The game runs at **https://3rdiaudio.com** on Hostinger's Node.js web hosting (Business plan, hosting account `u758383565`), with its MariaDB database on the same server. First deployed on 2026-11-13.

This page says how a deploy is done, what is set up on Hostinger, and what is different there from the local Docker stack. For the database itself see [DATABASE.md](DATABASE.md).

## What is where

| Thing | Where |
|---|---|
| App code | A new folder for every deploy: `/home/u758383565/domains/3rdiaudio.com/hbuilds/versions/<build id>/nodejs/` |
| Generated images and log files | `/home/u758383565/domains/3rdiaudio.com/data/` (the `DATA_DIR` setting). Kept across deploys. |
| Database | `u758383565_uranus` on the same server. The app connects on `127.0.0.1:3306`. |
| Settings and secrets | Environment variables on the site (hPanel > Websites > 3rdiaudio.com > Node.js, or the Hostinger API). |
| Production secrets generated for this site | `.env.production` in the repo folder on the Mac mini. Not in git. Holds the session secret, the admin key for Dev Tools, and the database password. |

## How to deploy

1. Make a clean copy of the app. Only files known to git are copied, so `.env` files, backups and `node_modules` stay out:

   ```sh
   sh scripts/hostinger-stage.sh /tmp/uranus-deploy
   ```

2. If `server/db/schema/` has a new file, apply it to the production database first (see [Running database commands](#running-database-commands-against-production)). A new build must never start against an older schema.

3. Deploy the copy with the Hostinger deploy operation, **always with these settings**:

   | Setting | Value |
   |---|---|
   | Type | `nodejs` |
   | Node.js version | 22 |
   | App type | `express` |
   | Build script | `build:hostinger` |
   | Entry file | `dist/index.js` |
   | Package manager | `npm` |

   State them on every deploy. A deploy from a folder does not reuse the settings of the previous one: without them it guessed Node 20 and `server.js`, and the build failed.

4. Wait for the build to report `completed` (about a minute). A failed build leaves the previous version running.

5. Check the result:
   - `https://3rdiaudio.com/api/health` shows `"status":"healthy"` and `reference.inSync: true`.
   - Open the site in a browser and sign in. A page can be blank while the health check is green (see [Problems found on the first deploy](#problems-found-on-the-first-deploy)).
   - One real turn: `npx tsx scripts/game-simulator.ts --server https://3rdiaudio.com --username <name> --actions 2 --auto --wait 40`. It makes real LLM and image calls and leaves a user and a game in the production database.

## Why the build script is `build:hostinger`

Hostinger installs dependencies with `NODE_ENV=production` set (it is one of the site's environment variables), which leaves out `devDependencies`. The build needs them (`vite`, `esbuild`, Tailwind). `build:hostinger` installs them and then runs the normal build. A project `.npmrc` cannot do this: the deploy tool treats `.npmrc` as a secret file and does not upload it.

## Environment variables

Replacing the variables through the API replaces the **whole set**, and values cannot be read back, so keep this list complete.

| Variable | Value | Note |
|---|---|---|
| `NODE_ENV` | `production` | Hostinger starts `dist/index.js` directly, not `npm start`, so this must be set here. |
| `DATABASE_URL` | `mysql://u758383565_uranus:<password>@127.0.0.1:3306/u758383565_uranus` | Password in `.env.production`. Use `127.0.0.1`, not `localhost`. |
| `DB_POOL_MAX` | `20` | Hostinger allows this database user 75 connections. Two app processes run, so 40 can be in use. |
| `DATA_DIR` | `/home/u758383565/domains/3rdiaudio.com/data` | Generated images and logs. Without it they are lost on every deploy. |
| `SESSION_SECRET` | in `.env.production` | Signs the sign-in cookie. |
| `ADMIN_API_KEYS` | in `.env.production` | The key Dev Tools asks for. |
| `OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY` | same as local `.env` | Story and image models. |
| `HF_TOKEN` | same as local `.env` | Hugging Face image models. |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | `true`, key, `uranus-production` | Player turns are traced to LangSmith. Remove the first to turn it off. |
| `ALLOWED_ORIGINS` | `https://3rdiaudio.com,https://www.3rdiaudio.com` | Origins allowed to open a socket. |
| `IMAGE_SIMILARITY_CACHE_ENABLED` | `false` | Same as local. |

Not set on purpose: `CSRF_ENABLED` and `RATE_LIMIT_ENABLED` (both default to on; the local `.env` turns them off), `CONSOLE_LLM_LOG`, and `PORT` (Hostinger connects the app to the web server itself).

## Running database commands against production

The database accepts connections only from the server itself. To run `npm run db:migrate`, `db:verify-release` or `db:probe` from the Mac:

1. Add a remote-access rule for the Mac's public IP on `u758383565_uranus` (hPanel > Databases > Remote MySQL, or the API).
2. Run the command from a clean copy of the app (so only the release being deployed is seen), with `DATABASE_URL=mysql://u758383565_uranus:<password>@srv529.hstgr.io:3306/u758383565_uranus`.
3. Remove the rule again.

`db:init -- --replace` deletes content. It is not part of a normal deploy.

## Publishing content

Publish releases **locally**, commit them, and deploy. A release published from Dev Tools on the live site is written into that deploy's folder and is gone after the next deploy, while the database would still name it as current (health would then show `inSync: false`). After deploying a new release, load it into the production database from the Mac with `db:init-release` (see [DATABASE.md](DATABASE.md)).

## What is different on Hostinger

- **Two app processes.** Hostinger starts the app twice, and both run the queue workers. Job leases already make that safe. Live updates are passed between the processes through the `socket_events` table (`server/socketRelay.ts`), because a browser is connected to only one of them.
- **Protections are on.** CSRF protection and rate limiting run in production and are off in the local `.env`. Test with them on before a deploy that touches sign-in or request handling.
- **A CDN is in front.** It shows automated clients a short "checking your browser" page. Scripts need a browser-like `User-Agent`; headless Chrome passes after a few seconds.
- **Database limits.** See [Hostinger limits](DATABASE.md#hostinger-limits).
- **`/metrics` is public**, as it is locally. It holds counters and timings, no player data.

## Problems found on the first deploy

Each of these was invisible locally and is now fixed in the code. They are listed so the same symptoms are recognised.

| Symptom | Cause | Fix |
|---|---|---|
| Every sign-in refused with 403 | With CSRF on, `/api/csrf-token` returned 500: it skipped the middleware that creates the token. Hidden locally because CSRF is off there. | `server/index.ts`: the token route goes through the middleware. |
| Blank page, `Cannot read properties of undefined (reading 'useState')` | The production bundle split libraries into chunks that imported each other. Only the production build is affected; the dev server does not bundle. | `vite.config.ts`: one library chunk. |
| Fonts blocked | The content security policy did not allow Google Fonts. | `server/index.ts`: policy allows the font stylesheet and files. |
| Image appears only after a reload | The process that finished the image was not the one the browser was connected to. | `server/socketRelay.ts`. |
| Build fails: `vite: command not found` | `NODE_ENV=production` during install. | `build:hostinger`. |
| Idle database connections dropped | Hostinger's 20 second idle timeout. | Session `wait_timeout`, see DATABASE.md. |
