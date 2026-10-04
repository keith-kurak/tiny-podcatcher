---
name: apk-session-link
description: Build a production-variant Android APK of the current branch on EAS and produce an EAS Simulator "create session" link that opens it on a cloud Android emulator. Use when asked for a session link, a test link, a cloud emulator link, or a link to a prod APK build — for example to add to a PR description so a reviewer can try the change in the browser.
---

# APK session link

A create-session link opens a cloud Android emulator on EAS with a given build already
installed and launched. Whoever opens it signs in to Expo and needs access to the
`keithco/podcatch` project. Reference:
https://docs.expo.dev/preview/eas-simulator/create-session-links/

The link format is:

```
https://expo.dev/accounts/keithco/projects/podcatch/simulator-sessions/create?buildId=<BUILD_ID>&name=<URL-ENCODED NAME>
```

## Steps

Run every command from `apps/mobile/`.

### 1. Make sure the build will contain the branch

EAS builds the committed state of the repo, and it uses the git commit hash for the build
record. Commit (and push, if the link is going into a PR) before you build. Check with
`git status`.

### 2. Start the build

The `preview` profile in `apps/mobile/eas.json` is the "prod APK": internal distribution,
`APP_VARIANT=production` (production package id and name), `preview` update channel, APK
output. The `production` profile makes an AAB, which the emulator cannot install. The
`development` profile is a dev client, which needs Metro — do not use it for a link.

```bash
npx --yes eas-cli@latest build --profile preview --platform android --non-interactive --no-wait --json
```

The JSON array holds one build. Read its `id`. If the output is cut off, get it with:

```bash
npx --yes eas-cli@latest build:list --platform android --limit 1 --json --non-interactive
```

Check that `gitCommitHash` matches `git rev-parse HEAD`.

### 3. Wait for the build to finish

The link fails validation while the build is not finished.
Poll at a slow rate (every few minutes). Do not poll in a tight loop:

```bash
npx --yes eas-cli@latest build:view <BUILD_ID> --json | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])"
```

Continue at `FINISHED`. At `ERRORED` or `CANCELED`, report the build URL
(`https://expo.dev/accounts/keithco/projects/podcatch/builds/<BUILD_ID>`) and stop.

### 4. Make the link

Give the session a short, sentence-case name that says what to test (3–6 words, and the
PR number when there is one). URL-encode it:

```bash
BUILD_ID=<BUILD_ID>
NAME=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "Auto-download PR 50")
echo "https://expo.dev/accounts/keithco/projects/podcatch/simulator-sessions/create?buildId=$BUILD_ID&name=$NAME"
```

Rules from the docs:

- Use only one app source. For this repo, that is `buildId`. Do not add `platform`; EAS
  reads it from the build.
- Each time someone opens the link, EAS creates a new session. Say this when you share it.
- Builds expire. The build JSON shows `expirationDate`. After that date the link stops
  working, and you must build again.

### 5. (Optional) Confirm the build boots

You cannot open the link yourself, because it needs a browser sign-in. To prove the
same build installs and launches on the cloud emulator, start a session from the CLI with
the same build id, take a screenshot, then stop it. Follow the `expo:eas-simulator` skill:

```bash
npx --yes eas-cli@latest simulator:start --platform android --build-id <BUILD_ID> \
  --type agent-device --name "<same name>" --max-duration-minutes 15 --non-interactive
npx --yes eas-cli@latest simulator:exec npx agent-device@latest screenshot ./shot.png --platform android
npx --yes eas-cli@latest simulator:stop
printf '# managed by eas-cli\n' > .env.eas-simulator
```

`.env.eas-simulator` holds a token. The repo's `.gitignore` excludes it. Never commit it.

### 6. Put it in the PR

Add a section like this to the PR body (`gh pr edit <n> --body-file …`), and keep the rest
of the body:

```markdown
## Try it

[Open a cloud emulator with this build](<LINK>). It is a production-variant APK
(`preview` profile) of <short sha>. Each time you open the link, it starts a new session.
You must sign in to Expo with access to keithco/podcatch.

Build: https://expo.dev/accounts/keithco/projects/podcatch/builds/<BUILD_ID>
```

If the branch gets new commits, the link still opens the old build. Build again and replace
the link when the PR needs the latest code.
