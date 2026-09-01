# SkillSense

SkillSense is a mobile-first Progressive Web App for mock interview practice. It uses camera and microphone access in the browser, runs face analysis with MediaPipe Face Landmarker on device, requests local Web Speech recognition when the browser supports it, and saves session history in IndexedDB.

## Run locally

Start a static server from this folder:

```bash
python -m http.server 8080
```

Open `http://localhost:8080` in Chrome or Edge. Camera, microphone, service workers, and Web Speech recognition require `localhost` or HTTPS.

If you are seeing `Needs support` like in the screenshot, the page loaded but the browser did not provide everything SkillSense needs. In this app, Record stays disabled unless all of these are true:

- The page is running in a secure context: `http://localhost`, Android `localhost` through ADB reverse, or `https://...`.
- `navigator.mediaDevices.getUserMedia` is available for camera and microphone.
- MediaPipe Face Landmarker loaded successfully.
- Web Speech on-device recognition is available for `en-US`.

Plain `http://192.168.x.x:8080` is useful for checking the layout on a phone, but many browsers will not allow camera/microphone from that address because it is not `localhost` and not HTTPS.

## Test on Android

### Option A: same laptop, safest local phone test

1. Enable USB debugging on the Android phone.
2. Connect the phone to the laptop.
3. Run the local server on the laptop: `python -m http.server 8080`.
4. Run `adb reverse tcp:8080 tcp:8080`.
5. Open `http://localhost:8080` in Chrome on the phone.
6. Use Chrome's install prompt or the browser menu to install SkillSense.

This is the cleanest path because Android Chrome sees the page as `localhost`, so it is a secure context without putting your laptop on a public URL.

### Option B: same Wi-Fi local IP check

1. On Windows, run `ipconfig` and find the laptop's Wi-Fi IPv4 address, usually something like `192.168.1.23`.
2. Run `python -m http.server 8080` from this folder.
3. On the phone, open `http://192.168.1.23:8080`.
4. Use this only for UI/layout checks unless your browser explicitly treats the origin as secure.
5. If it does not ask for camera/microphone, switch to Option A or Option C.

Keep your firewall scoped to private networks only. Do not forward router ports for this project.

### Option C: HTTPS tunnel

Use this when USB debugging is not available or the browser insists on HTTPS:

```bash
ngrok http 8080
```

or:

```bash
cloudflared tunnel --url http://localhost:8080
```

Open the HTTPS URL on the Android phone. The tunnel only serves the static app files; interview analysis still runs in the browser.

For safer tunnel testing:

- Start the tunnel only while testing, then stop it.
- Share the URL only with the people who need it.
- Use a tunnel account/password feature if available.
- Do not run the tunnel from a folder that contains private files outside this static app.

## Browser permission behavior

SkillSense requests camera and microphone only after the user taps `Record Answer`. The app now checks for a secure context first, then asks for both permissions through `navigator.mediaDevices.getUserMedia()`.

Expected cases:

- Allowed: camera preview appears, timer starts, local speech and face analysis begin.
- Denied: no recording starts, tracks are stopped, and the page tells the user to allow camera/microphone in site settings.
- Missing device: the page says no camera or microphone was found.
- Insecure origin: the page tells the user to use `localhost`, ADB reverse, HTTPS tunnel, or HTTPS static hosting.

On Android Chrome, permission can be reset from the lock icon in the address bar or from Chrome Settings > Site settings > Camera / Microphone.

## Phone-only vs laptop-needed work

Phone-only:

- Edit `index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js`, and this README in any mobile code editor.
- Change the interview questions in `QUESTIONS` inside `app.js`.
- For a short demo, temporarily lower `MIN_RECORD_SECONDS` and `MAX_RECORD_SECONDS` at the top of `app.js`, then restore them to `60` and `90` for judging.
- Install and use the PWA after it is hosted on `localhost` through ADB reverse or on HTTPS through a tunnel.

Laptop needed:

- Run the local static server or HTTPS tunnel.
- Use Chrome DevTools Network tab to verify no app fetch/XHR happens during the recording analysis window.
- Use ADB reverse for the cleanest Android `localhost` test.
- Optionally vendor the MediaPipe JS/WASM/model files if the team wants first-load offline support.

## Privacy and network testing

MediaPipe Tasks runs input processing on device, but the first app load downloads the MediaPipe JS, WASM, and face model files. The service worker caches those files after they are fetched once.

The app includes:

- No analytics code.
- No tracking pixels.
- No backend endpoint.
- IndexedDB-only session history.
- A visible `Delete history` button for local stored results.
- Content Security Policy in `index.html`, `_headers` for Netlify-style hosts, and `vercel.json` for Vercel.

SkillSense warms MediaPipe before enabling recording. When recording starts, `app.js` wraps `fetch` and `XMLHttpRequest` and reports whether the page made app-level network requests during analysis. To verify manually:

1. Open DevTools.
2. Go to Network.
3. Load the app and wait for `Local ready`.
4. Clear the Network log.
5. Tap `Record Answer`.
6. Stop after 60 seconds or wait for auto-stop at 90 seconds.
7. Confirm no new JS/model/API requests appeared during that recording window.

The Web Speech API local path is experimental. SkillSense sets `recognition.processLocally = true` and, when available, uses `SpeechRecognition.available()` / `SpeechRecognition.install()` to require an on-device `en-US` dictation pack. If the browser cannot guarantee local speech recognition, the Record button stays disabled instead of falling back to cloud speech.

## Deployment safety checklist

Before a public demo:

1. Open the deployed URL in DevTools > Network.
2. Hard refresh the page.
3. Confirm expected first-load requests only:
   - Your static files.
   - `cdn.jsdelivr.net` for MediaPipe Tasks JS/WASM.
   - `storage.googleapis.com` for the MediaPipe face model.
4. Wait until the app says `Local ready`.
5. Clear the Network log.
6. Record a session.
7. Confirm no network requests are made during the analysis window.

For the strongest privacy pitch, vendor the MediaPipe JS/WASM/model files into this repo and change the CSP to self-only:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'
```

With the current CDN version, the honest wording is: first load downloads MediaPipe assets from allowed public hosts; after that, interview camera frames, audio, transcript, scores, and history stay on the user's device.

## Public URL for judges

Good free static hosts:

- Netlify: easiest for this project because `_headers` is included and Netlify serves HTTPS by default.
- Vercel: `vercel.json` is included and Vercel serves HTTPS by default.
- GitHub Pages: simple and free HTTPS, but it does not let you set real HTTP security headers on project pages; keep the meta CSP in `index.html` or put Cloudflare in front if you need headers.

Camera and microphone still require each judge to grant permission in their own browser. A public HTTPS URL does not bypass the browser prompt.

## Places data could accidentally leave the device

Rule these out in your pitch and test plan:

- Browser extensions that can read pages or capture camera/mic.
- DevTools performance/network recordings that you export or share.
- Analytics snippets, tag managers, heatmaps, crash reporters, or template SDKs.
- Remote speech recognition fallback. SkillSense avoids this by requiring `processLocally`.
- Uploading recordings or screenshots to a bug tracker, chat app, or cloud drive.
- Public tunnels left running after testing.
- CDN/model fetches during first load. Vendor MediaPipe files if your claim must be "no external network after install."

References used while building: [MediaPipe Tasks Vision README](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md), [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API), and [MDN SpeechRecognition.processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally).
