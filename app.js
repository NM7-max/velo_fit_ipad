import {
  FilesetResolver,
  PoseLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

// Modèle plus stable que la version Lite utilisée avant.
// Il peut être un peu plus lourd, mais il donne généralement moins de points erratiques.
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const SEUIL_VISIBILITE = 0.45;
const ANGLE_MIN_OK = 145;
const ANGLE_MAX_OK = 155;
const MARGE_PROCHE = 5;
const DESCENTE_APRES_MAX = 6;
const FRAMES_CONFIRMATION_MAX = 3;
const REMONTEE_NOUVEAU_TOUR = 10;
const DETECTION_INTERVAL_MS = 70;
const ALPHA_POINTS = 0.45;
const ALPHA_ANGLE = 0.35;

const COLORS = {
  good: "#28e06d",
  near: "#ffb02e",
  bad: "#ff3b4f",
  wait: "#36d7ff",
  white: "#ffffff",
  black: "#000000"
};

const video = document.getElementById("sourceVideo");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d", { alpha: false });

const btnCamera = document.getElementById("btnCamera");
const btnVideo = document.getElementById("btnVideo");
const btnStop = document.getElementById("btnStop");
const cameraChoice = document.getElementById("cameraChoice");
const videoFile = document.getElementById("videoFile");
const speedChoice = document.getElementById("speedChoice");

const statusPill = document.getElementById("statusPill");
const message = document.getElementById("message");
const angleText = document.getElementById("angleText");
const maxText = document.getElementById("maxText");
const stateText = document.getElementById("stateText");
const dropLabel = document.getElementById("dropLabel");

let poseLandmarker = null;
let running = false;
let stream = null;
let mode = "stop";
let objectUrl = null;
let selectedVideoFile = null;

let maximumsTours = [];
let dernierMaxAngle = null;
let maxTourCourant = null;
let minimumApresPic = null;
let framesDepuisPic = 0;
let rechercheNouveauPic = true;
let nbToursDetectes = 0;
let lastDetectTime = 0;
let lastLegName = null;
let smoothLeg = null;
let smoothAngle = null;
let lastAnalysis = null;

function setMessage(txt) {
  message.textContent = txt;
}

function setStatus(txt) {
  statusPill.textContent = txt;
}

function setState(txt, cls = "") {
  stateText.textContent = txt;
  stateText.className = "state-text" + (cls ? " " + cls : "");
}

function resetAnalysis() {
  maximumsTours = [];
  dernierMaxAngle = null;
  maxTourCourant = null;
  minimumApresPic = null;
  framesDepuisPic = 0;
  rechercheNouveauPic = true;
  nbToursDetectes = 0;
  lastDetectTime = 0;
  lastLegName = null;
  smoothLeg = null;
  smoothAngle = null;
  lastAnalysis = null;

  angleText.textContent = "Angle : --°";
  maxText.textContent = "Max tour : --°";
  setState("En attente");
}

async function initPose() {
  if (poseLandmarker) return;

  setStatus("Chargement");
  setMessage("Chargement de MediaPipe. Cela peut prendre quelques secondes...");

  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      // CPU est souvent plus stable sur Safari/iPad que GPU pour ce type de PWA.
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });

  setStatus("Prêt");
  setMessage("MediaPipe est chargé.");
}

function stopCurrent(options = {}) {
  running = false;

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  video.pause();
  video.removeAttribute("srcObject");
  video.srcObject = null;

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  video.removeAttribute("src");
  video.load();

  mode = "stop";
  dropLabel.style.display = "grid";
  setStatus("Arrêté");

  if (!options.keepSelection) {
    // On ne vide pas selectedVideoFile automatiquement, car l'utilisateur peut vouloir relancer la même vidéo.
  }
}

async function openCameraStream(facingMode) {
  const base = {
    audio: false,
    video: {
      facingMode: { exact: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

  try {
    return await navigator.mediaDevices.getUserMedia(base);
  } catch (errExact) {
    // Fallback iPad/Safari si exact n'est pas accepté.
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
  }
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMessage("Caméra indisponible. Sur iPad, ouvre l'app depuis une adresse HTTPS.");
      setStatus("Erreur");
      return;
    }

    await initPose();
    stopCurrent({ keepSelection: true });
    resetAnalysis();

    const facingMode = cameraChoice.value;
    stream = await openCameraStream(facingMode);

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.playbackRate = 1;

    await video.play();

    mode = "camera";
    running = true;
    dropLabel.style.display = "none";
    setStatus(facingMode === "environment" ? "Caméra 0" : "Caméra 1");
    setMessage("Analyse caméra en cours. Filme le cycliste de côté, en paysage, avec hanche-genou-cheville visibles.");
    requestAnimationFrame(loop);
  } catch (err) {
    setStatus("Erreur");
    setMessage("Impossible d'ouvrir la caméra : " + err.message);
  }
}

function waitForVideoReady() {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("la vidéo ne se charge pas"));
    }, 12000);

    function cleanup() {
      clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
    }

    function onReady() {
      if (video.videoWidth > 0) {
        cleanup();
        resolve();
      }
    }

    function onError() {
      cleanup();
      reject(new Error("format vidéo non lisible par Safari"));
    }

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);
  });
}

async function startSelectedVideo() {
  if (!selectedVideoFile) {
    setMessage("Aucune vidéo sélectionnée. Clique d'abord sur Choisir vidéo.");
    setStatus("Prêt");
    return;
  }

  try {
    await initPose();
    stopCurrent({ keepSelection: true });
    resetAnalysis();

    objectUrl = URL.createObjectURL(selectedVideoFile);
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.controls = false;
    video.playbackRate = parseFloat(speedChoice.value);
    video.load();

    await waitForVideoReady();
    await video.play();

    mode = "video";
    running = true;
    dropLabel.style.display = "none";
    setStatus("Vidéo");
    setMessage("Analyse vidéo : " + selectedVideoFile.name);
    requestAnimationFrame(loop);
  } catch (err) {
    setStatus("Erreur");
    setMessage("Impossible de lancer la vidéo : " + err.message + ". Essaie une vidéo .mp4/.mov enregistrée localement sur l'iPad.");
  }
}

function resizeCanvasToVideo() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function drawVideoFrame() {
  resizeCanvasToVideo();
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

function toCanvasPoint(lm) {
  return {
    x: lm.x * canvas.width,
    y: lm.y * canvas.height,
    v: lm.visibility ?? 1
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleABC(a, b, c) {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;

  const norm = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
  if (norm === 0) return 0;

  let cosang = (bax * bcx + bay * bcy) / norm;
  cosang = Math.max(-1, Math.min(1, cosang));
  return Math.acos(cosang) * 180 / Math.PI;
}

function getLeg(landmarks, side) {
  const ids = side === "gauche"
    ? { hip: 23, knee: 25, ankle: 27 }
    : { hip: 24, knee: 26, ankle: 28 };

  const hipLm = landmarks[ids.hip];
  const kneeLm = landmarks[ids.knee];
  const ankleLm = landmarks[ids.ankle];

  if (!hipLm || !kneeLm || !ankleLm) return null;

  if ((hipLm.visibility ?? 1) < SEUIL_VISIBILITE ||
      (kneeLm.visibility ?? 1) < SEUIL_VISIBILITE ||
      (ankleLm.visibility ?? 1) < SEUIL_VISIBILITE) {
    return null;
  }

  const hip = toCanvasPoint(hipLm);
  const knee = toCanvasPoint(kneeLm);
  const ankle = toCanvasPoint(ankleLm);

  if (distance(hip, knee) < 20 || distance(knee, ankle) < 20) {
    return null;
  }

  // Même logique que le PC : on rejette les cas très incohérents.
  if (hip.y >= knee.y + 25) {
    return null;
  }

  const confidence = ((hipLm.visibility ?? 1) + (kneeLm.visibility ?? 1) + (ankleLm.visibility ?? 1)) / 3;
  return { hip, knee, ankle, name: side, confidence };
}

function choisirJambe(landmarks) {
  // Pour éviter l'instabilité, on garde la même jambe si elle reste détectable.
  if (lastLegName) {
    const same = getLeg(landmarks, lastLegName);
    if (same) return same;
  }

  const left = getLeg(landmarks, "gauche");
  const right = getLeg(landmarks, "droite");

  if (left && right) {
    return left.confidence >= right.confidence ? left : right;
  }
  return left || right || null;
}

function smoothPoint(prev, cur) {
  if (!prev) return cur;
  return {
    x: prev.x * (1 - ALPHA_POINTS) + cur.x * ALPHA_POINTS,
    y: prev.y * (1 - ALPHA_POINTS) + cur.y * ALPHA_POINTS,
    v: cur.v
  };
}

function smoothJambe(jambe) {
  if (!smoothLeg || smoothLeg.name !== jambe.name) {
    smoothLeg = jambe;
    return jambe;
  }

  smoothLeg = {
    name: jambe.name,
    confidence: jambe.confidence,
    hip: smoothPoint(smoothLeg.hip, jambe.hip),
    knee: smoothPoint(smoothLeg.knee, jambe.knee),
    ankle: smoothPoint(smoothLeg.ankle, jambe.ankle)
  };
  return smoothLeg;
}

function updateMaxTour(angleGenou) {
  if (rechercheNouveauPic) {
    if (maxTourCourant === null || angleGenou > maxTourCourant) {
      maxTourCourant = angleGenou;
      framesDepuisPic = 0;
    } else {
      framesDepuisPic += 1;
    }

    const baisseDepuisPic = maxTourCourant - angleGenou;

    if (baisseDepuisPic >= DESCENTE_APRES_MAX && framesDepuisPic >= FRAMES_CONFIRMATION_MAX) {
      dernierMaxAngle = maxTourCourant;
      maximumsTours.push(dernierMaxAngle);
      nbToursDetectes += 1;

      rechercheNouveauPic = false;
      minimumApresPic = angleGenou;
      maxTourCourant = null;
      framesDepuisPic = 0;
    }
  } else {
    if (minimumApresPic === null || angleGenou < minimumApresPic) {
      minimumApresPic = angleGenou;
    }

    const remontee = angleGenou - minimumApresPic;
    if (remontee >= REMONTEE_NOUVEAU_TOUR) {
      rechercheNouveauPic = true;
      maxTourCourant = angleGenou;
      minimumApresPic = null;
      framesDepuisPic = 0;
    }
  }

  return dernierMaxAngle;
}

function evaluer(maximumAngle) {
  if (maximumAngle === null) {
    return { color: COLORS.near, cls: "near", text: "Pédale pour détecter un maximum" };
  }

  if (maximumAngle >= ANGLE_MIN_OK && maximumAngle <= ANGLE_MAX_OK) {
    return { color: COLORS.good, cls: "good", text: "Hauteur selle OK" };
  }

  if (maximumAngle > ANGLE_MAX_OK) {
    if (maximumAngle <= ANGLE_MAX_OK + MARGE_PROCHE) {
      return { color: COLORS.near, cls: "near", text: "Baisser la selle" };
    }
    return { color: COLORS.bad, cls: "bad", text: "Baisser la selle" };
  }

  if (maximumAngle >= ANGLE_MIN_OK - MARGE_PROCHE) {
    return { color: COLORS.near, cls: "near", text: "Monter la selle" };
  }

  return { color: COLORS.bad, cls: "bad", text: "Monter la selle" };
}

function drawPoint(pt, label, color) {
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.white;
  ctx.stroke();

  ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS.black;
  ctx.strokeText(label, pt.x + 16, pt.y - 10);
  ctx.fillStyle = COLORS.white;
  ctx.fillText(label, pt.x + 16, pt.y - 10);
}

function drawTextWithShadow(text, x, y, color, size = 26) {
  ctx.font = `bold ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.black;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawSavedAnalysis() {
  if (!lastAnalysis) return;

  const { jambe, angle, dernierMax, diagnostic } = lastAnalysis;
  ctx.strokeStyle = diagnostic.color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(jambe.hip.x, jambe.hip.y);
  ctx.lineTo(jambe.knee.x, jambe.knee.y);
  ctx.lineTo(jambe.ankle.x, jambe.ankle.y);
  ctx.stroke();

  drawPoint(jambe.hip, "HANCHE", diagnostic.color);
  drawPoint(jambe.knee, "GENOU", diagnostic.color);
  drawPoint(jambe.ankle, "CHEVILLE", diagnostic.color);

  drawTextWithShadow("Angle " + angle.toFixed(1) + "°", jambe.knee.x + 16, jambe.knee.y + 30, diagnostic.color, 24);

  const maxPart = dernierMax === null ? "--" : dernierMax.toFixed(1) + "°";
  drawTextWithShadow("Angle " + angle.toFixed(1) + "° | Max tour " + maxPart, 30, 42, diagnostic.color, 26);
  drawTextWithShadow(diagnostic.text, 30, 76, diagnostic.color, 26);
}

function analyseResults(results) {
  if (!results.landmarks || results.landmarks.length === 0) {
    angleText.textContent = "Angle : --°";
    setState("Personne non détectée");
    lastAnalysis = null;
    return;
  }

  const landmarks = results.landmarks[0];
  const jambeBrute = choisirJambe(landmarks);

  if (!jambeBrute) {
    angleText.textContent = "Angle : --°";
    setState("Points non valides — repositionne la caméra", "near");
    lastAnalysis = null;
    return;
  }

  lastLegName = jambeBrute.name;
  const jambe = smoothJambe(jambeBrute);

  const angleInstant = angleABC(jambe.hip, jambe.knee, jambe.ankle);
  smoothAngle = smoothAngle === null
    ? angleInstant
    : smoothAngle * (1 - ALPHA_ANGLE) + angleInstant * ALPHA_ANGLE;

  const dernierMax = updateMaxTour(smoothAngle);
  const diagnostic = evaluer(dernierMax);

  angleText.textContent = "Angle genou : " + smoothAngle.toFixed(1) + "°";
  maxText.textContent = dernierMax === null ? "Max tour : --°" : "Max tour : " + dernierMax.toFixed(1) + "°";
  setState(diagnostic.text, diagnostic.cls);

  lastAnalysis = {
    jambe,
    angle: smoothAngle,
    dernierMax,
    diagnostic
  };
}

function analyseCurrentFrame(now) {
  if (now - lastDetectTime < DETECTION_INTERVAL_MS) return;
  lastDetectTime = now;

  try {
    const results = poseLandmarker.detectForVideo(video, now);
    analyseResults(results);
  } catch (err) {
    setMessage("Erreur analyse : " + err.message);
  }
}

function loop(now) {
  if (!running || !poseLandmarker) return;

  if (video.readyState >= 2 && video.videoWidth > 0) {
    drawVideoFrame();
    analyseCurrentFrame(now);
    drawSavedAnalysis();
  }

  requestAnimationFrame(loop);
}

function handleFileSelection(evt) {
  const file = evt.target.files && evt.target.files[0];

  if (!file) {
    selectedVideoFile = null;
    setMessage("Sélection annulée. Aucune vidéo sélectionnée.");
    return;
  }

  selectedVideoFile = file;
  setStatus("Vidéo prête");
  setMessage("Vidéo sélectionnée : " + file.name + ". Clique sur Lancer vidéo sélectionnée.");
}

btnCamera.addEventListener("click", startCamera);
btnVideo.addEventListener("click", startSelectedVideo);
btnStop.addEventListener("click", () => {
  stopCurrent({ keepSelection: true });
  resetAnalysis();
  setMessage("Arrêté. Tu peux relancer la caméra ou la vidéo sélectionnée.");
});

videoFile.addEventListener("change", handleFileSelection);
videoFile.addEventListener("input", handleFileSelection);

speedChoice.addEventListener("change", () => {
  video.playbackRate = parseFloat(speedChoice.value);
  setMessage("Vitesse vidéo : x" + speedChoice.value);
});

cameraChoice.addEventListener("change", () => {
  const label = cameraChoice.value === "environment" ? "0 - arrière" : "1 - avant";
  setMessage("Caméra choisie : " + label);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

setStatus("Prêt");
