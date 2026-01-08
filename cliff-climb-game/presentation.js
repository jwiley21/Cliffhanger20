const TOTAL_STEPS = 20;
const STEP_INTERVAL_MS = 1050;
const AUDIO_TAIL_MS = 1000;
const EDGE_HOLD_MS = STEP_INTERVAL_MS;
const FALL_DURATION_MS = 2000;
const BASE_STAGE_WIDTH = 900;
const BASE_STAGE_HEIGHT = 550;
const BACKGROUND_SHIFT_Y = 40;

// Tape endpoints sampled from the background image (normalized to bg.png size).
const PATH_START = { x: 0.1919, y: 0.6406 };
const PATH_END = { x: 0.7766, y: 0.2309 };
const PATH_INSET = 0.0;
const BASE_ROTATION_OFFSET_DEG = 0;
const FOOT_OFFSET = {
  tangent: 3,
  normal: 12,
};

const PATH_VECTOR = {
  x: PATH_END.x - PATH_START.x,
  y: PATH_END.y - PATH_START.y,
};
const PATH_LENGTH = Math.hypot(PATH_VECTOR.x, PATH_VECTOR.y);
const PATH_DIR = {
  x: PATH_VECTOR.x / PATH_LENGTH,
  y: PATH_VECTOR.y / PATH_LENGTH,
};
const PATH_NORMAL = {
  x: -PATH_DIR.y,
  y: PATH_DIR.x,
};
const PATH_ANGLE_DEG =
  (Math.atan2(PATH_VECTOR.y, PATH_VECTOR.x) * 180) / Math.PI;

const stageWrapper = document.getElementById("stageWrapper");
const stage = document.getElementById("stage");
const climber = document.getElementById("climber");
const climberSprite = document.getElementById("climberSprite");
const fullscreenBtn = document.getElementById("fullscreenBtn");

const climbAudio = new Audio("assets/climb.mp3");
climbAudio.loop = true;
climbAudio.preload = "auto";
climbAudio.volume = 0.6;

const fallAudio = new Audio("assets/fall.mp3");
fallAudio.loop = false;
fallAudio.preload = "auto";
fallAudio.volume = 0.7;

const bgImage = new Image();
bgImage.src = "assets/bg.png";

const state = {
  isRunning: false,
  currentStep: 0,
  targetStep: 0,
  intervalId: null,
  holdTimeout: null,
  fallTimeout: null,
  bgSize: {
    width: 1152,
    height: 896,
  },
  bgShiftY: 0,
};

function notifyController(stateValue) {
  if (!window.opener) {
    return;
  }

  const targetOrigin =
    window.location.origin === "null" ? "*" : window.location.origin;
  window.opener.postMessage({ type: "STATE", state: stateValue }, targetOrigin);
}

function stopAudio(audio) {
  audio.pause();
  audio.currentTime = 0;
}

function stopAllAudio() {
  stopAudio(climbAudio);
  stopAudio(fallAudio);
}

function clearTimers() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  if (state.holdTimeout) {
    clearTimeout(state.holdTimeout);
    state.holdTimeout = null;
  }

  if (state.fallTimeout) {
    clearTimeout(state.fallTimeout);
    state.fallTimeout = null;
  }
}

function setFallVars(x, y, rotDeg) {
  climber.style.setProperty("--fall-x", `${x}px`);
  climber.style.setProperty("--fall-y", `${y}px`);
  climber.style.setProperty("--fall-rot", `${rotDeg}deg`);
}

function resetFallState() {
  climber.classList.remove("falling");
  setFallVars(0, 0, 0);
}

function tryPlay(audio) {
  stopAudio(audio);
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) {
    return;
  }

  audioUnlocked = true;
  const previousVolume = climbAudio.volume;
  climbAudio.volume = 0;
  climbAudio.play()
    .then(() => {
      climbAudio.pause();
      climbAudio.currentTime = 0;
      climbAudio.volume = previousVolume;
    })
    .catch(() => {
      climbAudio.volume = previousVolume;
      audioUnlocked = false;
    });
}

function trimClimberImage() {
  if (climberSprite.dataset.trimmed === "true") {
    return;
  }

  if (!climberSprite.complete || climberSprite.naturalWidth === 0) {
    return;
  }

  const width = climberSprite.naturalWidth;
  const height = climberSprite.naturalHeight;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(climberSprite, 0, 0);

  const { data } = ctx.getImageData(0, 0, width, height);
  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;
  const alphaThreshold = 8;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] > alphaThreshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (left > right || top > bottom) {
    return;
  }

  const trimmedWidth = right - left + 1;
  const trimmedHeight = bottom - top + 1;
  const trimmedCanvas = document.createElement("canvas");
  const trimmedCtx = trimmedCanvas.getContext("2d");
  if (!trimmedCtx) {
    return;
  }

  trimmedCanvas.width = trimmedWidth;
  trimmedCanvas.height = trimmedHeight;
  trimmedCtx.drawImage(
    canvas,
    left,
    top,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight
  );

  climberSprite.dataset.trimmed = "true";
  climberSprite.src = trimmedCanvas.toDataURL("image/png");
}

function getAvailableSpace(element) {
  const styles = getComputedStyle(element);
  const padX =
    parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const padY =
    parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  return {
    width: element.clientWidth - padX,
    height: element.clientHeight - padY,
  };
}

function getBackgroundMetrics() {
  const stageWidth = stage.clientWidth;
  const stageHeight = stage.clientHeight;
  const imgWidth = state.bgSize.width;
  const imgHeight = state.bgSize.height;
  const scale = Math.max(stageWidth / imgWidth, stageHeight / imgHeight);
  const bgWidth = imgWidth * scale;
  const bgHeight = imgHeight * scale;
  const offsetX = (bgWidth - stageWidth) / 2;
  const offsetY = (bgHeight - stageHeight) / 2;
  const shiftY = state.bgShiftY;

  return {
    imgWidth,
    imgHeight,
    scale,
    offsetX,
    offsetY,
    shiftY,
  };
}

function getPathPoint(step) {
  const safeStep = Math.max(0, Math.min(step, TOTAL_STEPS));
  const t = safeStep / TOTAL_STEPS;
  const pathT = PATH_INSET + (1 - 2 * PATH_INSET) * t;
  const normX = PATH_START.x + (PATH_END.x - PATH_START.x) * pathT;
  const normY = PATH_START.y + (PATH_END.y - PATH_START.y) * pathT;

  const { imgWidth, imgHeight, scale, offsetX, offsetY, shiftY } =
    getBackgroundMetrics();
  const rawX = normX * imgWidth * scale - offsetX;
  const rawY = normY * imgHeight * scale - offsetY + shiftY;

  const scaleFactor = stage.clientHeight / BASE_STAGE_HEIGHT;
  const tangentOffset = FOOT_OFFSET.tangent * scaleFactor;
  const normalOffset = FOOT_OFFSET.normal * scaleFactor;
  return {
    x:
      rawX + (PATH_DIR.x * tangentOffset + PATH_NORMAL.x * normalOffset),
    y:
      rawY + (PATH_DIR.y * tangentOffset + PATH_NORMAL.y * normalOffset),
  };
}

function setClimberStep(step, animate = true) {
  if (!animate) {
    climber.classList.add("no-anim");
  }

  const point = getPathPoint(step);
  climber.style.setProperty("--pos-x", `${point.x}px`);
  climber.style.setProperty("--pos-y", `${point.y}px`);

  if (!animate) {
    void climber.offsetHeight;
    climber.classList.remove("no-anim");
  }
}

function setBaseRotation() {
  const rotation = PATH_ANGLE_DEG + BASE_ROTATION_OFFSET_DEG;
  climber.style.setProperty("--base-rot", `${rotation}deg`);
}

function triggerBounce() {
  climberSprite.classList.remove("bounce");
  void climberSprite.offsetWidth;
  climberSprite.classList.add("bounce");
}

function resizeStage() {
  const { width, height } = getAvailableSpace(stageWrapper);
  if (width <= 0 || height <= 0) {
    return;
  }

  const scale = Math.min(width / BASE_STAGE_WIDTH, height / BASE_STAGE_HEIGHT);
  const stageWidth = Math.round(BASE_STAGE_WIDTH * scale);
  const stageHeight = Math.round(BASE_STAGE_HEIGHT * scale);
  stage.style.width = `${stageWidth}px`;
  stage.style.height = `${stageHeight}px`;
  state.bgShiftY = (BACKGROUND_SHIFT_Y * stageHeight) / BASE_STAGE_HEIGHT;
  stage.style.setProperty("--bg-shift-y", `${state.bgShiftY}px`);

  setClimberStep(state.currentStep, false);
}

function toggleFullscreen() {
  if (!stageWrapper) {
    return;
  }

  if (!document.fullscreenElement) {
    stageWrapper.requestFullscreen().catch(() => {});
  } else if (document.fullscreenElement === stageWrapper) {
    document.exitFullscreen().catch(() => {});
  }
}

function prepareForClimb() {
  clearTimers();
  stopAllAudio();
  resetFallState();
  setClimberStep(state.currentStep, false);
}

function finishAfterHold(needsFall) {
  const holdMs = needsFall ? EDGE_HOLD_MS : AUDIO_TAIL_MS;
  state.holdTimeout = setTimeout(() => {
    state.holdTimeout = null;
    if (needsFall) {
      triggerFall();
    } else {
      stopAudio(climbAudio);
      state.isRunning = false;
      notifyController("DONE");
    }
  }, AUDIO_TAIL_MS);
}

function triggerFall() {
  stopAudio(climbAudio);
  climber.classList.add("falling");
  const fallX = Math.round(stage.clientWidth * 0.26);
  const fallY = Math.round(stage.clientHeight * 0.85);
  setFallVars(fallX, fallY, 70);

  stopAudio(fallAudio);
  tryPlay(fallAudio);

  state.fallTimeout = setTimeout(() => {
    state.isRunning = false;
    state.fallTimeout = null;
    notifyController("DONE");
  }, FALL_DURATION_MS);
}

function runClimb() {
  const climbLimit = Math.min(state.targetStep, TOTAL_STEPS);
  const needsFall = state.targetStep > TOTAL_STEPS;

  state.isRunning = true;

  if (state.currentStep >= climbLimit) {
    state.currentStep = climbLimit;
    setClimberStep(climbLimit, true);
    finishAfterHold(needsFall);
    return;
  }

  tryPlay(climbAudio);

  state.intervalId = setInterval(() => {
    state.currentStep += 1;
    setClimberStep(state.currentStep, true);
    triggerBounce();

    if (state.currentStep >= climbLimit) {
      clearTimers();
      state.currentStep = climbLimit;
      setClimberStep(climbLimit, true);
      finishAfterHold(needsFall);
    }
  }, STEP_INTERVAL_MS);
}

function startClimb(steps) {
  if (state.isRunning) {
    notifyController("BUSY");
    return;
  }

  if (!Number.isInteger(steps) || steps < 0) {
    return;
  }

  prepareForClimb();
  state.targetStep = state.currentStep + steps;
  state.isRunning = true;
  notifyController("RUNNING");

  if (steps === 0) {
    state.isRunning = false;
    notifyController("DONE");
    return;
  }

  runClimb();
}

function resetGame() {
  clearTimers();
  stopAllAudio();
  state.isRunning = false;
  state.currentStep = 0;
  state.targetStep = 0;
  resetFallState();
  climberSprite.classList.remove("bounce");
  setClimberStep(0, false);
  notifyController("READY");
}

function handleMessage(event) {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  if (window.opener && event.source !== window.opener) {
    return;
  }

  if (
    window.location.origin !== "null" &&
    event.origin !== window.location.origin
  ) {
    return;
  }

  if (data.type === "START") {
    console.log("[Presentation] START", data.steps);
    startClimb(data.steps);
    return;
  }

  if (data.type === "RESET") {
    console.log("[Presentation] RESET");
    resetGame();
    return;
  }

  console.log("[Presentation] Ignored message", data);
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener("click", toggleFullscreen);
}

stageWrapper.addEventListener("dblclick", toggleFullscreen);
window.addEventListener("message", handleMessage);
window.addEventListener("resize", resizeStage);
window.addEventListener("pointerdown", unlockAudio, { once: true });

document.addEventListener("fullscreenchange", () => {
  resizeStage();
});

bgImage.addEventListener("load", () => {
  if (bgImage.naturalWidth && bgImage.naturalHeight) {
    state.bgSize.width = bgImage.naturalWidth;
    state.bgSize.height = bgImage.naturalHeight;
    resizeStage();
  }
});

climberSprite.addEventListener("animationend", () => {
  climberSprite.classList.remove("bounce");
});

if (climberSprite.complete) {
  trimClimberImage();
} else {
  climberSprite.addEventListener("load", trimClimberImage, { once: true });
}

setBaseRotation();
resizeStage();
setClimberStep(0, false);
notifyController("READY");
