# Put Blockfront Worlds online with GitHub + Render

This is the simplest public-alpha path. Nobody visiting the finished site needs Python installed: Render runs the Python/FastAPI server for you.

## Part A — create a GitHub repository

1. Create a new empty repository on GitHub, for example `blockfront-worlds`.
2. Do not add a README/license from GitHub if you are about to push this existing folder.
3. Open this project folder in VS Code.
4. Open a PowerShell terminal in the **inner folder that contains `app.py`**.
5. Run:

```powershell
git init
git add .
git commit -m "Blockfront Worlds V2 public alpha"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/blockfront-worlds.git
git push -u origin main
```

If GitHub asks you to authenticate, complete its browser/device login flow.

## Part B — deploy on Render

1. Sign in to Render.
2. Choose **New -> Blueprint** if you want Render to use this repository's `render.yaml`, or **New -> Web Service** and connect the GitHub repo manually.
3. Select the `blockfront-worlds` repository.
4. Render should detect the Dockerfile/Blueprint.
5. Deploy.
6. Wait for the build to finish.
7. Open the generated HTTPS URL, which will look similar to:

```text
https://blockfront-worlds.onrender.com
```

The browser code automatically uses secure `wss://` WebSockets when the page itself is HTTPS.

## Free vs always-on

`render.yaml` currently requests the **Free** plan so you can test without committing to hosting cost. Free instances can sleep after inactivity and need to wake for the next visitor.

Once you are inviting the public rather than a few testers, upgrade the Web Service to an always-on paid instance from the Render dashboard. No code change is required.

## Test multiplayer publicly

1. Open the Render URL on your PC.
2. Choose a world.
3. Click **HOST GAME**.
4. Choose mode/world and create a room.
5. Click **COPY INVITE**.
6. Send that HTTPS link to a friend on a different network/device.
7. Both players should appear in the same room.

## Add a custom domain later

1. Buy a domain from a registrar, e.g. a `.com` or `.gg` you like.
2. In Render: Web Service -> Settings -> Custom Domains -> Add Custom Domain.
3. Render shows the DNS records to add at your registrar.
4. Add those records and wait for DNS propagation.
5. Render manages HTTPS/TLS for the connected domain.

Do not buy a domain containing another game's trademark; use an original Blockfront/brand name.

## Updating the live game

Continue editing locally in VS Code. Then:

```powershell
git add .
git commit -m "Describe the update"
git push
```

The included Blueprint uses `autoDeployTrigger: checksPass`. That means the GitHub test workflow runs first; Render deploys the commit after the linked checks pass. Your GitHub repository therefore remains the editable source of truth and broken commits are less likely to become the live version.

## Important scaling note

Keep the Render service at **one running instance** while room state is stored in Python memory. If you scale to multiple instances before adding Redis/shared match state, two players using the same room link can land on different processes and not see each other.

## Environment variables available now

```text
MAX_PLAYERS_PER_ROOM=16
ADS_ENABLED=0
ADS_PROVIDER=placeholder
```

AdSense values should stay blank until you have an approved account and have completed the privacy/consent work described in `MONETIZATION.md`.
