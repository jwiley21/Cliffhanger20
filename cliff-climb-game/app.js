/*
How to run: Open cliff-climb-game/index.html with Live Server.
Assets: Place bg.png, climber.png, climb.mp3, fall.mp3 in cliff-climb-game/assets/.
*/

const TOTAL_STEPS = 20;
const STEP_INTERVAL_MS = 1050;
const CLIMB_AUDIO_TAIL_MS = 1000;
const EDGE_HOLD_MS = STEP_INTERVAL_MS;
const FALL_DURATION_MS = 2000;
const BASE_STAGE_WIDTH = 900;
const BASE_STAGE_HEIGHT = 550;
const BACKGROUND_SHIFT_Y = 40; // Base pixels to reveal the full title.

// Tape endpoints sampled from the background image (normalized to bg.png size).
const PATH_START = { x: 0.1919, y: 0.6406 };
const PATH_END = { x: 0.7766, y: 0.2309 };
const PATH_INSET = 0.0;
const BASE_ROTATION_OFFSET_DEG = 0;
const FOOT_OFFSET = {
  tangent: 3,
  normal: 12,
}; // Base-pixel offset for the climber's feet.

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
const stepsInput = document.getElementById("stepsInput");
const lockBtn = document.getElementById("lockBtn");
const resetBtn = document.getElementById("resetBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const statusText = document.getElementById("statusText");
const errorText = document.getElementById("errorText");
const hud = document.querySelector(".hud");

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
  edgeTimeout: null,
  fallTimeout: null,
  audioStopTimeout: null,
  bgSize: {
    width: 1152,
    height: 896,
  },
  bgShiftY: 0,
  hudHome: {
    parent: hud.parentElement,
    nextSibling: hud.nextElementSibling,
  },
};

function setStatus(text) {
  statusText.textContent = text;
}

function showError(message) {
  if (!message) {
    errorText.textContent = "";
    errorText.hidden = true;
    return;
  }

  errorText.textContent = message;
  errorText.hidden = false;
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

  if (state.edgeTimeout) {
    clearTimeout(state.edgeTimeout);
    state.edgeTimeout = null;
  }

  if (state.fallTimeout) {
    clearTimeout(state.fallTimeout);
    state.fallTimeout = null;
  }

  if (state.audioStopTimeout) {
    clearTimeout(state.audioStopTimeout);
    state.audioStopTimeout = null;
  }
}

function setControlsRunning(running) {
  stepsInput.disabled = running;
  lockBtn.disabled = running;
  fullscreenBtn.disabled = running;
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

function scheduleClimbAudioStop() {
  if (state.audioStopTimeout) {
    clearTimeout(state.audioStopTimeout);
  }

  state.audioStopTimeout = setTimeout(() => {
    stopAudio(climbAudio);
    state.audioStopTimeout = null;
  }, CLIMB_AUDIO_TAIL_MS);
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

  const isFullscreen = document.fullscreenElement === stageWrapper;
  let scale = Math.min(width / BASE_STAGE_WIDTH, height / BASE_STAGE_HEIGHT);
  if (!isFullscreen) {
    scale = Math.min(scale, 1);
  }

  const stageWidth = Math.round(BASE_STAGE_WIDTH * scale);
  const stageHeight = Math.round(BASE_STAGE_HEIGHT * scale);
  stage.style.width = `${stageWidth}px`;
  stage.style.height = `${stageHeight}px`;
  state.bgShiftY = (BACKGROUND_SHIFT_Y * stageHeight) / BASE_STAGE_HEIGHT;
  stage.style.setProperty("--bg-shift-y", `${state.bgShiftY}px`);

  setClimberStep(state.currentStep, false);
}

function updateFullscreenButton() {
  const isFullscreen = document.fullscreenElement === stageWrapper;
  fullscreenBtn.textContent = isFullscreen ? "Exit Fullscreen" : "Fullscreen";
}

function moveHudToStage() {
  if (hud.parentElement === stageWrapper) {
    return;
  }

  stageWrapper.appendChild(hud);
  hud.classList.add("hud--overlay");
}

function restoreHud() {
  if (hud.parentElement !== stageWrapper) {
    return;
  }

  hud.classList.remove("hud--overlay");
  const { parent, nextSibling } = state.hudHome;
  if (nextSibling) {
    parent.insertBefore(hud, nextSibling);
  } else {
    parent.appendChild(hud);
  }
}

function syncHudPlacement() {
  if (document.fullscreenElement === stageWrapper) {
    moveHudToStage();
  } else {
    restoreHud();
  }
}

function prepareForClimb() {
  clearTimers();
  stopAllAudio();
  resetFallState();
  setClimberStep(state.currentStep, false);
}

function finishClimb() {
  scheduleClimbAudioStop();
  state.isRunning = false;
  setControlsRunning(false);
  setStatus(`Holding at step ${state.currentStep}.`);
}

function queueFall() {
  setStatus("On the edge...");
  state.edgeTimeout = setTimeout(() => {
    triggerFall();
  }, EDGE_HOLD_MS);
}

function triggerFall() {
  stopAudio(climbAudio);
  setStatus("Falling...");
  state.edgeTimeout = null;

  climber.classList.add("falling");
  const fallX = Math.round(stage.clientWidth * 0.26);
  const fallY = Math.round(stage.clientHeight * 0.85);
  setFallVars(fallX, fallY, 70);

  stopAudio(fallAudio);
  tryPlay(fallAudio);

  state.fallTimeout = setTimeout(() => {
    state.isRunning = false;
    setControlsRunning(false);
    setStatus("Fell!");
  }, FALL_DURATION_MS);
}

function runClimb() {
  const climbLimit = Math.min(state.targetStep, TOTAL_STEPS);
  const needsFall = state.targetStep > TOTAL_STEPS;

  state.isRunning = true;
  setControlsRunning(true);
  setStatus("Climbing...");

  if (state.currentStep >= climbLimit) {
    setClimberStep(climbLimit, true);
    if (needsFall) {
      queueFall();
    } else {
      finishClimb();
    }
    return;
  }

  tryPlay(climbAudio);

  state.intervalId = setInterval(() => {
    state.currentStep += 1;
    setClimberStep(state.currentStep, true);
    triggerBounce();

    if (state.currentStep >= climbLimit) {
      clearTimers();

      if (needsFall) {
        setClimberStep(climbLimit, true);
        queueFall();
      } else {
        finishClimb();
      }
    }
  }, STEP_INTERVAL_MS);
}

function handleLockIn() {
  if (state.isRunning) {
    return;
  }

  const rawValue = stepsInput.value.trim();
  if (!rawValue) {
    showError("Enter a non-negative integer.");
    return;
  }

  const steps = Number(rawValue);
  if (!Number.isInteger(steps) || steps < 0) {
    showError("Enter a non-negative integer.");
    return;
  }

  showError("");
  prepareForClimb();
  state.targetStep = state.currentStep + steps;
  stepsInput.value = "";

  if (steps === 0) {
    setStatus(
      state.currentStep === 0
        ? "Holding at base."
        : `Holding at step ${state.currentStep}.`
    );
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
  setControlsRunning(false);
  showError("");
  resetFallState();
  climberSprite.classList.remove("bounce");
  setClimberStep(0, false);
  setStatus("Ready");
  stepsInput.value = "";
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    stageWrapper.requestFullscreen().catch(() => {});
  } else if (document.fullscreenElement === stageWrapper) {
    document.exitFullscreen().catch(() => {});
  }
}

lockBtn.addEventListener("click", handleLockIn);
resetBtn.addEventListener("click", resetGame);
fullscreenBtn.addEventListener("click", toggleFullscreen);
stepsInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleLockIn();
  }
});

climberSprite.addEventListener("animationend", () => {
  climberSprite.classList.remove("bounce");
});

document.addEventListener("fullscreenchange", () => {
  updateFullscreenButton();
  syncHudPlacement();
  resizeStage();
});

window.addEventListener("resize", resizeStage);

bgImage.addEventListener("load", () => {
  if (bgImage.naturalWidth && bgImage.naturalHeight) {
    state.bgSize.width = bgImage.naturalWidth;
    state.bgSize.height = bgImage.naturalHeight;
    resizeStage();
  }
});

updateFullscreenButton();
syncHudPlacement();
setBaseRotation();
resizeStage();
setClimberStep(0, false);

if (climberSprite.complete) {
  trimClimberImage();
} else {
  climberSprite.addEventListener("load", trimClimberImage, { once: true });
}
