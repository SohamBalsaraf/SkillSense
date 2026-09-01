console.log("SKILLSENSE APP VERSION 7 - FINAL");

const MIN_RECORD_SECONDS = 60;
const MAX_RECORD_SECONDS = 90;

const MEDIAPIPE_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";

const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
  
const QUESTIONS = [
  "Tell me about a time you solved a difficult problem.",
  "Why should we hire you for this role?",
  "Describe a project you are proud of.",
  "Tell me about a time you handled conflict in a team.",
  "What is one weakness you are actively improving?"
];

const FILLERS = [
  "um",
  "uh",
  "like",
  "you know",
  "basically",
  "actually",
  "literally",
  "sort of",
  "kind of"
];

const FACE_SAMPLE_EVERY_MS = 250;

const dom = {
  questionTitle: document.getElementById("questionTitle"),
  newQuestionButton: document.getElementById("newQuestionButton"),
  previewVideo: document.getElementById("previewVideo"),
  videoEmpty: document.getElementById("videoEmpty"),
  timerBadge: document.getElementById("timerBadge"),
  privacyStatus: document.getElementById("privacyStatus"),
  privacyNote: document.getElementById("privacyNote"),
  permissionStatus: document.getElementById("permissionStatus"),
  faceStatus: document.getElementById("faceStatus"),
  speechStatus: document.getElementById("speechStatus"),
  networkStatus: document.getElementById("networkStatus"),
  recordButton: document.getElementById("recordButton"),
  stopButton: document.getElementById("stopButton"),
  recordingHint: document.getElementById("recordingHint"),
  transcriptText: document.getElementById("transcriptText"),
  wordCountLabel: document.getElementById("wordCountLabel"),
  resultsPanel: document.getElementById("resultsPanel"),
  wpmResult: document.getElementById("wpmResult"),
  fillerResult: document.getElementById("fillerResult"),
  eyeResult: document.getElementById("eyeResult"),
  expressionResult: document.getElementById("expressionResult"),
  flaggedWords: document.getElementById("flaggedWords"),
  tipsList: document.getElementById("tipsList"),
  practiceAgainButton: document.getElementById("practiceAgainButton"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  historyList: document.getElementById("historyList")
};

const appState = {
  db: null,
  recording: false,
  stream: null,
  mediaRecorder: null,
  chunks: [],
  startedAt: 0,
  timerId: null,
  faceFrameId: null,
  lastFaceSampleAt: 0,
  faceLandmarker: null,
  faceReady: false,
  faceStats: {
    total: 0,
    eyeContact: 0,
    expressions: {
      neutral: 0,
      happy: 0,
      sad: 0,
      angry: 0,
      surprised: 0,
      tense: 0
    }
  },
  recognition: null,
  speechReady: false,
  transcriptFinal: "",
  transcriptInterim: "",
  questionIndex: 0,
  networkOriginalFetch: null,
  networkOriginalXHR: null,
  networkWatching: false
};

function shortError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || error.name || String(error);
}

function capitalize(value) {
  if (!value) {
    return "";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function setStatus(element, message) {
  if (element) {
    element.textContent = message;
  }
}

function getTranscript() {
  return `${appState.transcriptFinal} ${appState.transcriptInterim}`
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function countWords(text) {
  return getWords(text).length;
}

function updateTranscriptUI() {
  const transcript = getTranscript();
  const wordCount = countWords(transcript);

  dom.transcriptText.textContent =
    transcript || "Your spoken answer appears here while the browser transcribes it locally.";

  dom.wordCountLabel.textContent =
    `${wordCount} word${wordCount === 1 ? "" : "s"}`;
}

function findFillers(words) {
  const matches = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];

    if (FILLERS.includes(word)) {
      matches.push(word);
      continue;
    }

    if (
      index < words.length - 2 &&
      words[index] === "you" &&
      words[index + 1] === "know"
    ) {
      matches.push("you know");
      index += 1;
      continue;
    }

    if (
      index < words.length - 1 &&
      words[index] === "sort" &&
      words[index + 1] === "of"
    ) {
      matches.push("sort of");
      index += 1;
      continue;
    }

    if (
      index < words.length - 1 &&
      words[index] === "kind" &&
      words[index + 1] === "of"
    ) {
      matches.push("kind of");
      index += 1;
    }
  }

  return matches;
}

function summarizeFillers(matches) {
  return matches.reduce((summary, filler) => {
    summary[filler] = (summary[filler] || 0) + 1;
    return summary;
  }, {});
}

function getDominantExpression(expressions) {
  const entries = Object.entries(expressions);

  if (!entries.length) {
    return "neutral";
  }

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function buildTips({
  wpm,
  fillerMatches,
  eyeContactPercent,
  expression,
  faceAvailable
}) {
  const tips = [];
  const fillerSummary = summarizeFillers(fillerMatches);
  const topFiller = Object.entries(fillerSummary).sort(
    (a, b) => b[1] - a[1]
  )[0];

  if (topFiller && topFiller[1] >= 3) {
    tips.push(
      `Try pausing instead of saying "${topFiller[0]}". You used ${topFiller[1]} times.`
    );
  } else if (fillerMatches.length > 0) {
    tips.push(
      `Nice control on filler words. You only used ${fillerMatches.length} flagged filler word${
        fillerMatches.length === 1 ? "" : "s"
      }.`
    );
  } else {
    tips.push("Clean delivery: no tracked filler words were spotted.");
  }

  if (wpm > 170) {
    tips.push(
      `Slow down a little. ${wpm} WPM can feel rushed in an interview answer.`
    );
  } else if (wpm < 110) {
    tips.push(
      `Add a bit more energy. ${wpm} WPM may sound hesitant unless you are pausing intentionally.`
    );
  } else {
    tips.push(`Your pace was interview-friendly at ${wpm} WPM.`);
  }

  if (!faceAvailable) {
    tips.push(
      "Face analysis was unavailable on this browser, so eye contact and expression were not scored."
    );
  } else if (eyeContactPercent < 55) {
    tips.push(
      `Aim your face back toward the camera more often. Eye-contact estimate was ${eyeContactPercent}%.`
    );
  } else if (expression === "tense") {
    tips.push(
      "Your expression looked tense in several frames. Relax your jaw before starting the next answer."
    );
  } else {
    tips.push(
      `Good camera presence. Eye-contact estimate was ${eyeContactPercent}%.`
    );
  }

  return tips.slice(0, 3);
}

async function loadMediaPipeBundle() {
  const module = await import(MEDIAPIPE_MODULE_URL);

  if (!module.FaceLandmarker || !module.FilesetResolver) {
    throw new Error("MediaPipe exports missing");
  }

  return module;
}

async function createFaceLandmarker(module, delegate) {
  const vision = await module.FilesetResolver.forVisionTasks(
    MEDIAPIPE_WASM_URL
  );

  return module.FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: FACE_MODEL_URL,
      delegate: delegate
    },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true
  });
}

async function prepareFaceModel() {
  appState.faceReady = false;
  appState.faceLandmarker = null;

  setStatus(
    dom.faceStatus,
    "Face: loading MediaPipe..."
  );

  try {
    const module = await loadMediaPipeBundle();

    setStatus(
      dom.faceStatus,
      "Face: loading WASM..."
    );

    try {
      appState.faceLandmarker =
        await createFaceLandmarker(
          module,
          "GPU"
        );

      appState.faceReady = true;

      setStatus(
        dom.faceStatus,
        "Face: ready (GPU)"
      );

      updateRecordButton();
      return;

    } catch (gpuError) {

      console.warn(
        "MediaPipe GPU failed:",
        gpuError
      );

      setStatus(
        dom.faceStatus,
        "Face: GPU failed, trying CPU..."
      );
    }

    appState.faceLandmarker =
      await createFaceLandmarker(
        module,
        "CPU"
      );

    appState.faceReady = true;

    setStatus(
      dom.faceStatus,
      "Face: ready (CPU)"
    );

  } catch (error) {

    appState.faceReady = false;
    appState.faceLandmarker = null;

    console.error(
      "MediaPipe failed:",
      error
    );

    setStatus(
      dom.faceStatus,
      `Face failed: ${shortError(error)}`
    );
  }

  updateRecordButton();
}

async function prepareSpeech() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    appState.speechReady = false;
    setStatus(
      dom.speechStatus,
      "Speech: Web Speech recognition unavailable"
    );
    return;
  }

  if (typeof SpeechRecognition.available !== "function") {
    appState.speechReady = false;
    setStatus(
      dom.speechStatus,
      "Speech: local availability cannot be verified in this browser"
    );
    return;
  }

  try {
    const availability = await SpeechRecognition.available({
      langs: ["en-US"],
      processLocally: true
    });

    if (availability === "available") {
      appState.speechReady = true;
      setStatus(
        dom.speechStatus,
        "Speech: on-device en-US dictation ready"
      );
      return;
    }

    if (
      availability === "downloadable" &&
      typeof SpeechRecognition.install === "function"
    ) {
      setStatus(
        dom.speechStatus,
        "Speech: downloading local en-US language pack..."
      );

      const installed = await SpeechRecognition.install({
        langs: ["en-US"]
      });

      if (installed) {
        appState.speechReady = true;
        setStatus(
          dom.speechStatus,
          "Speech: on-device en-US dictation ready"
        );
        return;
      }
    }

    appState.speechReady = false;
    setStatus(
      dom.speechStatus,
      "Speech: on-device en-US dictation unavailable"
    );
  } catch (error) {
    appState.speechReady = false;
    console.warn("Local speech unavailable:", error);

    setStatus(
      dom.speechStatus,
      "Speech: on-device en-US dictation unavailable"
    );
  }
}

function setupRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition || !appState.speechReady) {
    appState.recognition = null;
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;

  if ("processLocally" in recognition) {
    recognition.processLocally = true;
  }

  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";

    for (
      let index = event.resultIndex;
      index < event.results.length;
      index += 1
    ) {
      const result = event.results[index];

      if (result.isFinal) {
        finalText += `${result[0].transcript} `;
      } else {
        interimText += result[0].transcript;
      }
    }

    appState.transcriptFinal += finalText;
    appState.transcriptInterim = interimText;

    updateTranscriptUI();
  };

  recognition.onerror = (event) => {
    console.warn("Speech recognition error:", event.error);

    if (event.error === "not-allowed") {
      appState.speechReady = false;
      setStatus(
        dom.speechStatus,
        "Speech: microphone permission denied"
      );
    }
  };

  recognition.onend = () => {
    if (appState.recording && appState.speechReady) {
      try {
        recognition.start();
      } catch {
        // Browser may reject an immediate restart.
      }
    }
  };

  appState.recognition = recognition;
}

async function ensurePermissions() {
  if (!window.isSecureContext) {
    throw new Error(
      "Camera and microphone require localhost or HTTPS."
    );
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "This browser does not provide camera/microphone access."
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user"
    },
    audio: true
  });

  return stream;
}

function resetFaceStats() {
  appState.faceStats = {
    total: 0,
    eyeContact: 0,
    expressions: {
      neutral: 0,
      happy: 0,
      sad: 0,
      angry: 0,
      surprised: 0,
      tense: 0
    }
  };
}

function collectFaceSample(result) {
  if (!result?.faceLandmarks?.length) {
    return;
  }

  const landmarks = result.faceLandmarks[0];

  if (!landmarks || landmarks.length < 468) {
    return;
  }

  appState.faceStats.total += 1;

  const nose = landmarks[1];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];

  if (nose && leftEye && rightEye) {
    const eyeMidpoint = {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2
    };

    const horizontalOffset = Math.abs(
      nose.x - eyeMidpoint.x
    );

    const verticalOffset = Math.abs(
      nose.y - eyeMidpoint.y
    );

    if (
      horizontalOffset < 0.08 &&
      verticalOffset < 0.08
    ) {
      appState.faceStats.eyeContact += 1;
    }
  }

  const blendshapes = result.faceBlendshapes?.[0]?.categories;

  if (!blendshapes?.length) {
    appState.faceStats.expressions.neutral += 1;
    return;
  }

  const scores = {};

  for (const category of blendshapes) {
    scores[category.categoryName] = category.score;
  }

  const smile =
    Math.max(
      scores.mouthSmileLeft || 0,
      scores.mouthSmileRight || 0
    );

  const frown =
    Math.max(
      scores.mouthFrownLeft || 0,
      scores.mouthFrownRight || 0
    );

  const jawOpen = scores.jawOpen || 0;
  const browDown =
    Math.max(
      scores.browDownLeft || 0,
      scores.browDownRight || 0
    );

  const eyeWide =
    Math.max(
      scores.eyeWideLeft || 0,
      scores.eyeWideRight || 0
    );

  let expression = "neutral";

  if (jawOpen > 0.55 && eyeWide > 0.4) {
    expression = "surprised";
  } else if (browDown > 0.45 && frown > 0.35) {
    expression = "angry";
  } else if (browDown > 0.4 && jawOpen < 0.25) {
    expression = "tense";
  } else if (smile > 0.5) {
    expression = "happy";
  } else if (frown > 0.45) {
    expression = "sad";
  }

  appState.faceStats.expressions[expression] += 1;
}

function runFaceLoop() {
  if (
    !appState.recording ||
    !appState.faceReady ||
    !appState.faceLandmarker
  ) {
    return;
  }

  const now = performance.now();

  const videoReady =
    dom.previewVideo.readyState >=
    HTMLMediaElement.HAVE_CURRENT_DATA;

  const shouldSample =
    now - appState.lastFaceSampleAt >= FACE_SAMPLE_EVERY_MS;

  if (videoReady && shouldSample) {
    appState.lastFaceSampleAt = now;

    try {
      const result =
        appState.faceLandmarker.detectForVideo(
          dom.previewVideo,
          now
        );

      collectFaceSample(result);
    } catch (error) {
      console.error(
        "Face detection failed during recording:",
        error
      );

      appState.faceReady = false;

      setStatus(
        dom.faceStatus,
        `Face: analysis stopped (${shortError(error)})`
      );

      return;
    }
  }

  appState.faceFrameId =
    window.requestAnimationFrame(runFaceLoop);
}

function updateTimer() {
  if (!appState.recording) {
    return;
  }

  const elapsed = Math.floor(
    (performance.now() - appState.startedAt) / 1000
  );

  const minutes = Math.floor(elapsed / 60)
    .toString()
    .padStart(2, "0");

  const seconds = (elapsed % 60)
    .toString()
    .padStart(2, "0");

  dom.timerBadge.textContent =
    `${minutes}:${seconds}`;

  if (elapsed >= MIN_RECORD_SECONDS) {
    dom.stopButton.disabled = false;
    dom.recordingHint.textContent =
      `You can stop now. Auto-stop at ${MAX_RECORD_SECONDS} seconds.`;
  } else {
    const remaining =
      MIN_RECORD_SECONDS - elapsed;

    dom.stopButton.disabled = true;

    dom.recordingHint.textContent =
      `Stop unlocks in ${remaining} second${
        remaining === 1 ? "" : "s"
      }. Auto-stop at ${MAX_RECORD_SECONDS} seconds.`;
  }

  if (elapsed >= MAX_RECORD_SECONDS) {
    stopRecording("Auto-stopped at maximum duration.");
  }
}

function updateRecordButton() {
  const supported =
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    window.isSecureContext;

  dom.recordButton.disabled =
    appState.recording || !supported;

  if (!supported) {
    dom.recordingHint.textContent =
      "Camera and microphone require localhost or HTTPS.";
  }
}

function startNetworkWatch() {
  if (appState.networkWatching) {
    return;
  }

  appState.networkWatching = true;

  appState.networkOriginalFetch =
    window.fetch;

  appState.networkOriginalXHR =
    window.XMLHttpRequest;

  let networkHit = false;

  window.fetch = async (...args) => {
    networkHit = true;

    setStatus(
      dom.networkStatus,
      "Network: request detected during analysis"
    );

    return appState.networkOriginalFetch(...args);
  };

  class TrackingXHR extends appState.networkOriginalXHR {
    open(...args) {
      networkHit = true;

      setStatus(
        dom.networkStatus,
        "Network: XHR detected during analysis"
      );

      return super.open(...args);
    }
  }

  window.XMLHttpRequest = TrackingXHR;

  appState.networkHitGetter = () =>
    networkHit;

  setStatus(
    dom.networkStatus,
    "Network: watching analysis window"
  );
}

function stopNetworkWatch() {
  if (!appState.networkWatching) {
    return;
  }

  window.fetch =
    appState.networkOriginalFetch;

  window.XMLHttpRequest =
    appState.networkOriginalXHR;

  const networkHit =
    appState.networkHitGetter?.() || false;

  appState.networkWatching = false;
  appState.networkOriginalFetch = null;
  appState.networkOriginalXHR = null;
  appState.networkHitGetter = null;

  setStatus(
    dom.networkStatus,
    networkHit
      ? "Network: app request detected during analysis"
      : "Network: no app fetch/XHR during analysis"
  );
}

function calculateMetrics() {
  const transcript = getTranscript();
  const words = getWords(transcript);

  const durationSeconds = Math.max(
    (performance.now() - appState.startedAt) / 1000,
    1
  );

  const fillerMatches = findFillers(words);
  const faceAvailable =
    appState.faceStats.total > 0;

  const expression = faceAvailable
    ? getDominantExpression(
        appState.faceStats.expressions
      )
    : "unavailable";

  const eyeContactPercent = faceAvailable
    ? Math.round(
        (appState.faceStats.eyeContact /
          appState.faceStats.total) *
          100
      )
    : null;

  const wpm = Math.round(
    words.length /
      (durationSeconds / 60)
  );

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    question: dom.questionTitle.textContent,
    durationSeconds: Math.round(durationSeconds),
    transcript,
    wordCount: words.length,
    wpm,
    fillerCount: fillerMatches.length,
    fillerSummary:
      summarizeFillers(fillerMatches),
    eyeContactPercent,
    expression,
    faceAnalysisAvailable:
      faceAvailable,
    speechAvailable:
      appState.speechReady,
    tips: buildTips({
      wpm,
      fillerMatches,
      eyeContactPercent,
      expression,
      faceAvailable
    })
  };
}

function renderResults(metrics) {
  dom.resultsPanel.classList.remove(
    "is-hidden"
  );

  dom.wpmResult.textContent =
    metrics.wpm;

  dom.fillerResult.textContent =
    metrics.fillerCount;

  dom.eyeResult.textContent =
    metrics.eyeContactPercent === null
      ? "N/A"
      : `${metrics.eyeContactPercent}%`;

  dom.expressionResult.textContent =
    metrics.expression === "unavailable"
      ? "N/A"
      : capitalize(metrics.expression);

  const flagged =
    Object.entries(metrics.fillerSummary)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([word, count]) =>
          `${word} (${count})`
      );

  dom.flaggedWords.textContent =
    flagged.length
      ? flagged.join(", ")
      : "None spotted.";

  dom.tipsList.innerHTML = "";

  for (const tip of metrics.tips) {
    const item =
      document.createElement("li");

    item.textContent = tip;

    dom.tipsList.appendChild(item);
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request =
      indexedDB.open(
        "skillsense-db",
        1
      );

    request.onupgradeneeded = () => {
      const database =
        request.result;

      if (
        !database.objectStoreNames.contains(
          "sessions"
        )
      ) {
        database.createObjectStore(
          "sessions",
          {
            keyPath: "id"
          }
        );
      }
    };

    request.onsuccess = () =>
      resolve(request.result);

    request.onerror = () =>
      reject(request.error);
  });
}

function saveSession(metrics, reason) {
  return new Promise((resolve, reject) => {
    if (!appState.db) {
      reject(
        new Error(
          "IndexedDB is not available."
        )
      );

      return;
    }

    const session = {
      ...metrics,
      stopReason: reason
    };

    const transaction =
      appState.db.transaction(
        "sessions",
        "readwrite"
      );

    transaction.objectStore(
      "sessions"
    ).put(session);

    transaction.oncomplete =
      () => resolve();

    transaction.onerror =
      () => reject(transaction.error);
  });
}

function getAllSessions() {
  return new Promise(
    (resolve, reject) => {
      if (!appState.db) {
        resolve([]);
        return;
      }

      const transaction =
        appState.db.transaction(
          "sessions",
          "readonly"
        );

      const request =
        transaction
          .objectStore("sessions")
          .getAll();

      request.onsuccess =
        () => {
          const sessions =
            request.result || [];

          sessions.sort(
            (a, b) =>
              new Date(b.createdAt) -
              new Date(a.createdAt)
          );

          resolve(sessions);
        };

      request.onerror =
        () => reject(request.error);
    }
  );
}

async function renderHistory() {
  const sessions =
    await getAllSessions();

  dom.historyList.innerHTML = "";

  if (!sessions.length) {
    const empty =
      document.createElement("p");

    empty.className =
      "empty-history";

    empty.textContent =
      "No saved sessions yet.";

    dom.historyList.appendChild(
      empty
    );

    return;
  }

  for (const session of sessions) {
    const item =
      document.createElement("article");

    item.className =
      "history-item";

    const title =
      document.createElement("strong");

    title.textContent =
      session.question;

    const date =
      document.createElement("span");

    date.textContent =
      new Date(
        session.createdAt
      ).toLocaleString();

    const details =
      document.createElement("span");

    const eye =
      session.eyeContactPercent === null
        ? "N/A"
        : `${session.eyeContactPercent}%`;

    details.textContent =
      `${session.wpm} WPM | ` +
      `${session.fillerCount} fillers | ` +
      `${eye} eye contact`;

    item.appendChild(title);
    item.appendChild(date);
    item.appendChild(details);

    dom.historyList.appendChild(item);
  }
}

function clearHistory() {
  return new Promise(
    (resolve, reject) => {
      if (!appState.db) {
        resolve();
        return;
      }

      const transaction =
        appState.db.transaction(
          "sessions",
          "readwrite"
        );

      transaction
        .objectStore("sessions")
        .clear();

      transaction.oncomplete =
        () => resolve();

      transaction.onerror =
        () => reject(transaction.error);
    }
  );
}

async function startRecording() {
  if (appState.recording) {
    return;
  }

  try {
    const stream =
      await ensurePermissions();

    appState.stream = stream;

    dom.previewVideo.srcObject =
      stream;

    dom.videoEmpty.classList.add(
      "is-hidden"
    );

    try {
      await dom.previewVideo.play();
    } catch (error) {
      console.warn(
        "Video playback did not start automatically:",
        error
      );
    }

    appState.recording = true;
    appState.startedAt =
      performance.now();

    appState.chunks = [];
    appState.transcriptFinal = "";
    appState.transcriptInterim = "";

    resetFaceStats();

    dom.resultsPanel.classList.add(
      "is-hidden"
    );

    updateTranscriptUI();

    document.body.classList.add(
      "is-recording"
    );

    dom.recordButton.disabled =
      true;

    dom.stopButton.disabled =
      true;

    dom.timerBadge.textContent =
      "00:00";

    setStatus(
      dom.permissionStatus,
      "Permissions: camera and microphone are active."
    );

    setStatus(
      dom.networkStatus,
      "Network: watching analysis window"
    );

    const mimeTypes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];

    let selectedMimeType = "";

    for (const mimeType of mimeTypes) {
      if (
        MediaRecorder.isTypeSupported(
          mimeType
        )
      ) {
        selectedMimeType =
          mimeType;
        break;
      }
    }

    appState.mediaRecorder =
      selectedMimeType
        ? new MediaRecorder(
            stream,
            {
              mimeType:
                selectedMimeType
            }
          )
        : new MediaRecorder(
            stream
          );

    appState.mediaRecorder.ondataavailable =
      (event) => {
        if (
          event.data &&
          event.data.size > 0
        ) {
          appState.chunks.push(
            event.data
          );
        }
      };

    appState.mediaRecorder.onerror =
      (event) => {
        console.error(
          "MediaRecorder error:",
          event.error
        );
      };

    appState.mediaRecorder.start(
      1000
    );

    if (
      appState.recognition &&
      appState.speechReady
    ) {
      try {
        appState.recognition.start();

        setStatus(
          dom.speechStatus,
          "Speech: transcribing on-device"
        );
      } catch (error) {
        console.warn(
          "Speech recognition did not start:",
          error
        );
      }
    }

    if (
      appState.faceReady &&
      appState.faceLandmarker
    ) {
      appState.lastFaceSampleAt =
        0;

      appState.faceFrameId =
        window.requestAnimationFrame(
          runFaceLoop
        );
    }

    startNetworkWatch();

    appState.timerId =
      window.setInterval(
        updateTimer,
        250
      );

    updateTimer();
  } catch (error) {
    console.error(
      "Could not start recording:",
      error
    );

    if (appState.stream) {
      appState.stream
        .getTracks()
        .forEach((track) =>
          track.stop()
        );

      appState.stream = null;
    }

    setStatus(
      dom.permissionStatus,
      `Permissions: ${shortError(error)}`
    );

    dom.recordButton.disabled =
      false;

    dom.stopButton.disabled =
      true;
  }
}

function stopMediaTracks() {
  if (!appState.stream) {
    return;
  }

  appState.stream
    .getTracks()
    .forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore already stopped tracks.
      }
    });

  appState.stream = null;
}

function stopSpeechRecognition() {
  if (!appState.recognition) {
    return;
  }

  try {
    appState.recognition.stop();
  } catch {
    // Recognition may already be stopped.
  }
}

async function stopRecording(
  reason = "Stopped by user"
) {
  if (!appState.recording) {
    return;
  }

  appState.recording = false;

  if (appState.timerId) {
    window.clearInterval(
      appState.timerId
    );

    appState.timerId = null;
  }

  if (appState.faceFrameId) {
    window.cancelAnimationFrame(
      appState.faceFrameId
    );

    appState.faceFrameId =
      null;
  }

  stopSpeechRecognition();

  document.body.classList.remove(
    "is-recording"
  );

  if (
    appState.mediaRecorder &&
    appState.mediaRecorder.state !==
      "inactive"
  ) {
    try {
      appState.mediaRecorder.stop();
    } catch {
      // Ignore recorder stop race.
    }
  }

  stopMediaTracks();

  dom.previewVideo.srcObject =
    null;

  dom.videoEmpty.classList.remove(
    "is-hidden"
  );

  dom.timerBadge.textContent =
    "00:00";

  dom.stopButton.disabled =
    true;

  dom.recordButton.disabled =
    false;

  setStatus(
    dom.permissionStatus,
    "Permissions: camera and microphone are off."
  );

  setStatus(
    dom.speechStatus,
    appState.speechReady
      ? "Speech: on-device en-US dictation ready"
      : "Speech: local dictation unavailable, transcript disabled"
  );

  stopNetworkWatch();

  updateTranscriptUI();

  const metrics =
    calculateMetrics();

  renderResults(metrics);

  try {
    await saveSession(
      metrics,
      reason
    );

    await renderHistory();
  } catch (error) {
    console.error(
      "Could not save session:",
      error
    );
  }

  dom.recordingHint.textContent =
    reason;

  appState.mediaRecorder =
    null;

  appState.chunks = [];
}

function chooseNextQuestion() {
  appState.questionIndex =
    (appState.questionIndex + 1) %
    QUESTIONS.length;

  dom.questionTitle.textContent =
    QUESTIONS[
      appState.questionIndex
    ];

  resetSessionView();
}

function resetSessionView() {
  if (appState.recording) {
    return;
  }

  appState.transcriptFinal = "";
  appState.transcriptInterim = "";

  resetFaceStats();

  dom.resultsPanel.classList.add(
    "is-hidden"
  );

  dom.timerBadge.textContent =
    "00:00";

  dom.recordingHint.textContent =
    `Stop unlocks after ${MIN_RECORD_SECONDS} seconds and the app auto-stops at ${MAX_RECORD_SECONDS} seconds.`;

  updateTranscriptUI();

  if (
    appState.faceReady
  ) {
    setStatus(
      dom.faceStatus,
      "Face: ready"
    );
  }

  if (
    appState.speechReady
  ) {
    setStatus(
      dom.speechStatus,
      "Speech: on-device en-US dictation ready"
    );
  }
}

function wireEvents() {
  dom.recordButton.addEventListener(
    "click",
    startRecording
  );

  dom.stopButton.addEventListener(
    "click",
    () =>
      stopRecording(
        "Stopped by user"
      )
  );

  dom.newQuestionButton.addEventListener(
    "click",
    chooseNextQuestion
  );

  dom.practiceAgainButton.addEventListener(
    "click",
    resetSessionView
  );

  dom.clearHistoryButton.addEventListener(
    "click",
    async () => {
      const confirmed =
        window.confirm(
          "Delete all saved interview history from this device?"
        );

      if (!confirmed) {
        return;
      }

      try {
        await clearHistory();
        await renderHistory();
      } catch (error) {
        console.error(
          "Could not clear history:",
          error
        );
      }
    }
  );
}

async function init() {
  wireEvents();

  updateRecordButton();

  updateTranscriptUI();

  setStatus(
    dom.privacyStatus,
    "Preparing"
  );

  try {
    appState.db =
      await openDatabase();

    await renderHistory();

  } catch (error) {

    console.error(
      "IndexedDB initialization failed:",
      error
    );

    setStatus(
      dom.privacyStatus,
      "Local storage unavailable"
    );
  }

  setStatus(
    dom.privacyStatus,
    "Local ready"
  );

  prepareFaceModel();

  prepareSpeech().then(() => {
    setupRecognition();
  });

  setStatus(
    dom.networkStatus,
    "Network: idle"
  );

  setStatus(
    dom.permissionStatus,
    "Permissions: camera and microphone are requested only after you tap Record."
  );

  dom.recordingHint.textContent =
    `Stop unlocks after ${MIN_RECORD_SECONDS} seconds and the app auto-stops at ${MAX_RECORD_SECONDS} seconds.`;

  console.log(
    "SkillSense initialization complete."
  );
}

window.addEventListener(
  "beforeunload",
  () => {
    if (appState.recording) {
      stopMediaTracks();
    }
  }
);

init();

