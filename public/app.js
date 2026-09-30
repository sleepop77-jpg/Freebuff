const DEFAULT_PALETTE = [
  "#111827",
  "#f8fafc",
  "#e2e8f0",
  "#94a3b8",
  "#475569",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e"
];

const STORAGE_KEY = "pixelforge-project-v1";

function createLayer(name, width, height) {
  return {
    id: crypto.randomUUID(),
    name,
    visible: true,
    pixels: new Array(width * height).fill(-1)
  };
}

function createFrame(width, height, duration = 100) {
  return {
    id: crypto.randomUUID(),
    duration,
    layers: [createLayer("Layer 1", width, height)]
  };
}

function createProject(width = 32, height = 32) {
  return {
    version: 1,
    width,
    height,
    palette: [...DEFAULT_PALETTE],
    frames: [createFrame(width, height)],
    activeFrame: 0,
    activeLayer: 0,
    onionSkin: true,
    grid: true,
    playing: false
  };
}

let state = loadProject() || createProject();
let tool = "pencil";
let selectedColor = 0;
let zoom = 12;
let isDrawing = false;
let lastPointerCell = null;

const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 40;

const canvas = document.querySelector("#pixelCanvas");
const ctx = canvas.getContext("2d");

const refs = {
  palette: document.querySelector("#palette"),
  timelineTrack: document.querySelector("#timelineTrack"),
  layerList: document.querySelector("#layerList"),
  frameReadout: document.querySelector("#frameReadout"),
  canvasReadout: document.querySelector("#canvasReadout"),
  fpsReadout: document.querySelector("#fpsReadout"),
  cursorReadout: document.querySelector("#cursorReadout"),
  toolReadout: document.querySelector("#toolReadout"),
  selectedColorReadout: document.querySelector("#selectedColorReadout"),
  durationInput: document.querySelector("#durationInput"),
  widthInput: document.querySelector("#widthInput"),
  heightInput: document.querySelector("#heightInput"),
  zoomSlider: document.querySelector("#zoomSlider"),
  zoomValue: document.querySelector("#zoomValue"),
  gridButton: document.querySelector("#gridButton"),
  onionButton: document.querySelector("#onionButton"),
  playButton: document.querySelector("#playButton"),
  agentStatus: document.querySelector("#agentStatus"),
  agentLed: document.querySelector("#agentLed"),
  commandInput: document.querySelector("#commandInput"),
  capabilitiesBox: document.querySelector("#capabilitiesBox"),
  connectionPill: document.querySelector("#connectionPill"),
  connectionText: document.querySelector("#connectionText"),
  toastStack: document.querySelector("#toastStack")
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshot() {
  return clone({
    width: state.width,
    height: state.height,
    palette: state.palette,
    frames: state.frames,
    activeFrame: state.activeFrame,
    activeLayer: state.activeLayer,
    onionSkin: state.onionSkin,
    grid: state.grid
  });
}

function restore(snapshotState) {
  state = {
    ...state,
    ...clone(snapshotState),
    playing: false
  };
  renderAll();
}

function commit(fn, historyLabel = "Edit") {
  undoStack.push({
    label: historyLabel,
    state: snapshot()
  });

  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }

  redoStack.length = 0;
  fn();
  persistAndSync();
  renderAll();
}

function undo() {
  if (!undoStack.length) {
    toast("Nothing to undo.");
    return;
  }

  redoStack.push({
    state: snapshot()
  });

  const entry = undoStack.pop();
  restore(entry.state);
  toast(`Undo: ${entry.label}`, "success");
}

function redo() {
  if (!redoStack.length) {
    toast("Nothing to redo.");
    return;
  }

  undoStack.push({
    state: snapshot()
  });

  const entry = redoStack.pop();
  restore(entry.state);
  toast("Redo", "success");
}

function currentFrame() {
  return state.frames[state.activeFrame];
}

function currentLayer() {
  const frame = currentFrame();
  return frame.layers[state.activeLayer] || frame.layers[0];
}

function pixelIndex(x, y) {
  return y * state.width + x;
}

function inside(x, y) {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

function setPixelDirect(x, y, colorIndex) {
  if (!inside(x, y)) return;
  currentLayer().pixels[pixelIndex(x, y)] = colorIndex;
}

function getCompositedPixel(x, y, frame = currentFrame()) {
  const index = pixelIndex(x, y);

  for (let i = frame.layers.length - 1; i >= 0; i--) {
    const layer = frame.layers[i];
    if (!layer.visible) continue;

    const pixel = layer.pixels[index];

    if (pixel !== -1) {
      return pixel;
    }
  }

  return -1;
}

function renderCanvas() {
  const width = state.width * zoom;
  const height = state.height * zoom;

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  drawFrame(currentFrame(), 1);

  if (state.onionSkin && state.activeFrame > 0) {
    drawFrame(state.frames[state.activeFrame - 1], 0.19);
  }

  if (state.grid) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= state.width; x++) {
      const px = x * zoom + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }

    for (let y = 0; y <= state.height; y++) {
      const py = y * zoom + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }

    ctx.stroke();
  }
}

function drawFrame(frame, alpha) {
  const source = document.createElement("canvas");
  source.width = state.width;
  source.height = state.height;

  const sourceCtx = source.getContext("2d");
  sourceCtx.imageSmoothingEnabled = false;

  const image = sourceCtx.createImageData(state.width, state.height);
  const pixels = image.data;

  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const colorIndex = getCompositedPixel(x, y, frame);
      const rgbaIndex = (y * state.width + x) * 4;

      if (colorIndex === -1) {
        pixels[rgbaIndex] = 0;
        pixels[rgbaIndex + 1] = 0;
        pixels[rgbaIndex + 2] = 0;
        pixels[rgbaIndex + 3] = 0;
        continue;
      }

      const hex = state.palette[colorIndex] || "#ffffff";
      const rgb = hexToRgb(hex);

      pixels[rgbaIndex] = rgb.r;
      pixels[rgbaIndex + 1] = rgb.g;
      pixels[rgbaIndex + 2] = rgb.b;
      pixels[rgbaIndex + 3] = 255;
    }
  }

  sourceCtx.putImageData(image, 0, 0);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    0,
    0,
    state.width * zoom,
    state.height * zoom
  );
  ctx.restore();
}

function renderPalette() {
  refs.palette.innerHTML = "";

  state.palette.forEach((color, index) => {
    const swatch = document.createElement("button");
    swatch.className = `swatch ${selectedColor === index ? "active" : ""}`;
    swatch.style.background = color;
    swatch.title = `${color} · ${index}`;
    swatch.addEventListener("click", () => {
      selectedColor = index;
      renderPalette();
      updateReadouts();
    });

    refs.palette.appendChild(swatch);
  });
}

function makeFrameThumbnail(frame) {
  const size = 82;
  const thumb = document.createElement("canvas");
  thumb.width = size;
  thumb.height = size;

  const tctx = thumb.getContext("2d");
  tctx.imageSmoothingEnabled = false;

  const temp = document.createElement("canvas");
  temp.width = state.width;
  temp.height = state.height;

  const tempCtx = temp.getContext("2d");
  const image = tempCtx.createImageData(state.width, state.height);

  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const colorIndex = getCompositedPixel(x, y, frame);
      const i = (y * state.width + x) * 4;

      if (colorIndex === -1) {
        image.data[i + 3] = 0;
        continue;
      }

      const rgb = hexToRgb(state.palette[colorIndex] || "#ffffff");
      image.data[i] = rgb.r;
      image.data[i + 1] = rgb.g;
      image.data[i + 2] = rgb.b;
      image.data[i + 3] = 255;
    }
  }

  tempCtx.putImageData(image, 0, 0);
  tctx.drawImage(temp, 0, 0, size, size);

  return thumb;
}

function renderTimeline() {
  refs.timelineTrack.innerHTML = "";

  state.frames.forEach((frame, index) => {
    const card = document.createElement("div");
    card.className = `frame-card ${state.activeFrame === index ? "active" : ""}`;

    const preview = makeFrameThumbnail(frame);
    preview.className = "frame-preview";

    const caption = document.createElement("div");
    caption.className = "frame-caption";
    caption.innerHTML = `<strong>${String(index + 1).padStart(2, "0")}</strong><span>${frame.duration}ms</span>`;

    card.append(preview, caption);

    card.addEventListener("click", () => {
      selectFrame(index);
    });

    refs.timelineTrack.appendChild(card);
  });
}

function renderLayers() {
  const frame = currentFrame();
  refs.layerList.innerHTML = "";

  frame.layers.slice().reverse().forEach((layer, reverseIndex) => {
    const actualIndex = frame.layers.length - 1 - reverseIndex;

    const row = document.createElement("div");
    row.className = `layer-row ${state.activeLayer === actualIndex ? "active" : ""}`;

    const eye = document.createElement("button");
    eye.className = "layer-eye";
    eye.textContent = layer.visible ? "●" : "○";
    eye.title = "Toggle visibility";

    eye.addEventListener("click", event => {
      event.stopPropagation();

      commit(() => {
        layer.visible = !layer.visible;
      }, "Toggle layer visibility");
    });

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name;

    row.append(eye, name);

    row.addEventListener("click", () => {
      commit(() => {
        state.activeLayer = actualIndex;
      }, "Select layer");
    });

    refs.layerList.appendChild(row);
  });
}

function renderAll() {
  renderCanvas();
  renderPalette();
  renderTimeline();
  renderLayers();
  updateReadouts();
}

function updateReadouts() {
  const frame = currentFrame();

  refs.frameReadout.textContent =
    `Frame ${state.activeFrame + 1} / ${state.frames.length}`;

  refs.canvasReadout.textContent =
    `${state.width} × ${state.height}`;

  refs.durationInput.value = frame.duration;

  refs.widthInput.value = state.width;
  refs.heightInput.value = state.height;

  refs.zoomValue.textContent = `${zoom}×`;

  refs.gridButton.classList.toggle("active", state.grid);
  refs.onionButton.classList.toggle("active", state.onionSkin);

  refs.toolReadout.textContent =
    tool.charAt(0).toUpperCase() + tool.slice(1);

  refs.selectedColorReadout.textContent =
    `Color ${state.palette[selectedColor] || "#ffffff"}`;

  const fps = Math.round(1000 / frame.duration);
  refs.fpsReadout.textContent = `${fps} FPS`;

  refs.playButton.textContent = state.playing ? "■ Stop" : "▶ Play";
}

function selectFrame(index) {
  if (index < 0 || index >= state.frames.length) return;

  commit(() => {
    state.activeFrame = index;
    state.activeLayer = Math.min(
      state.activeLayer,
      currentFrame().layers.length - 1
    );
  }, "Select frame");
}

function addFrame() {
  commit(() => {
    const frame = createFrame(state.width, state.height, currentFrame().duration);
    state.frames.splice(state.activeFrame + 1, 0, frame);
    state.activeFrame += 1;
    state.activeLayer = 0;
  }, "Add frame");

  toast("New frame created.", "success");
}

function duplicateFrame() {
  commit(() => {
    const duplicate = clone(currentFrame());
    duplicate.id = crypto.randomUUID();

    duplicate.layers.forEach(layer => {
      layer.id = crypto.randomUUID();
    });

    state.frames.splice(state.activeFrame + 1, 0, duplicate);
    state.activeFrame += 1;
  }, "Duplicate frame");

  toast("Frame duplicated.", "success");
}

function deleteFrame() {
  if (state.frames.length === 1) {
    toast("An animation needs at least one frame.");
    return;
  }

  commit(() => {
    state.frames.splice(state.activeFrame, 1);
    state.activeFrame = Math.max(
      0,
      Math.min(state.activeFrame, state.frames.length - 1)
    );
    state.activeLayer = Math.min(
      state.activeLayer,
      currentFrame().layers.length - 1
    );
  }, "Delete frame");
}

function addLayer() {
  commit(() => {
    const frame = currentFrame();
    const layer = createLayer(
      `Layer ${frame.layers.length + 1}`,
      state.width,
      state.height
    );

    frame.layers.push(layer);
    state.activeLayer = frame.layers.length - 1;
  }, "Add layer");

  toast("Layer added.", "success");
}

function deleteLayer() {
  const frame = currentFrame();

  if (frame.layers.length === 1) {
    toast("A frame needs at least one layer.");
    return;
  }

  commit(() => {
    frame.layers.splice(state.activeLayer, 1);
    state.activeLayer = Math.max(
      0,
      Math.min(state.activeLayer, frame.layers.length - 1)
    );
  }, "Delete layer");
}

function getCellFromPointer(event) {
  const rect = canvas.getBoundingClientRect();

  const x = Math.floor(
    ((event.clientX - rect.left) / rect.width) * state.width
  );

  const y = Math.floor(
    ((event.clientY - rect.top) / rect.height) * state.height
  );

  return { x, y };
}

function usePointer(event) {
  const { x, y } = getCellFromPointer(event);

  if (!inside(x, y)) return;

  refs.cursorReadout.textContent = `x: ${x}  y: ${y}`;

  if (tool === "picker") {
    const color = getCompositedPixel(x, y);

    if (color !== -1) {
      selectedColor = color;
      renderPalette();
      updateReadouts();
      setTool("pencil");
    }

    return;
  }

  if (tool === "fill") {
    floodFill(x, y, selectedColor);
    return;
  }

  setPixelDirect(
    x,
    y,
    tool === "eraser" ? -1 : selectedColor
  );

  renderCanvas();
  persistAndSync();
}

function floodFill(startX, startY, targetColor) {
  const layer = currentLayer();
  const startIndex = pixelIndex(startX, startY);
  const original = layer.pixels[startIndex];

  if (original === targetColor) return;

  commit(() => {
    const queue = [[startX, startY]];
    const visited = new Set();

    while (queue.length) {
      const [x, y] = queue.shift();
      const key = `${x},${y}`;

      if (visited.has(key) || !inside(x, y)) continue;
      visited.add(key);

      const index = pixelIndex(x, y);

      if (layer.pixels[index] !== original) continue;

      layer.pixels[index] = targetColor;

      queue.push([x + 1, y]);
      queue.push([x - 1, y]);
      queue.push([x, y + 1]);
      queue.push([x, y - 1]);
    }
  }, "Fill area");
}

function setTool(nextTool) {
  tool = nextTool;

  document.querySelectorAll(".tool-button[data-tool]").forEach(button => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });

  refs.toolReadout.textContent =
    tool.charAt(0).toUpperCase() + tool.slice(1);
}

function saveProject() {
  persistAndSync();
  const data = JSON.stringify(exportState(), null, 2);
  downloadBlob(data, "pixelforge-project.json", "application/json");
  toast("Project saved.", "success");
}

function persistAndSync() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(exportState()));

  sendSocket({
    type: "state",
    state: exportState()
  });
}

function exportState() {
  return {
    version: state.version,
    width: state.width,
    height: state.height,
    palette: state.palette,
    frames: state.frames,
    activeFrame: state.activeFrame,
    activeLayer: state.activeLayer,
    onionSkin: state.onionSkin,
    grid: state.grid
  };
}

function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) return null;

    const project = JSON.parse(raw);

    if (
      !project.width ||
      !project.height ||
      !Array.isArray(project.frames)
    ) {
      return null;
    }

    project.playing = false;
    return project;
  } catch {
    return null;
  }
}

function newProject() {
  const width = clamp(
    Number(refs.widthInput.value) || 32,
    8,
    128
  );

  const height = clamp(
    Number(refs.heightInput.value) || 32,
    8,
    128
  );

  const fresh = createProject(width, height);

  commit(() => {
    state = fresh;
    selectedColor = 0;
  }, "New project");

  toast("New project created.", "success");
}

function exportSpriteSheet() {
  const gap = 1;
  const sheet = document.createElement("canvas");

  sheet.width =
    state.frames.length * (state.width + gap) - gap;

  sheet.height = state.height;

  const sctx = sheet.getContext("2d");
  sctx.imageSmoothingEnabled = false;

  state.frames.forEach((frame, index) => {
    const source = document.createElement("canvas");
    source.width = state.width;
    source.height = state.height;

    const sourceCtx = source.getContext("2d");
    sourceCtx.imageSmoothingEnabled = false;

    const image = sourceCtx.createImageData(
      state.width,
      state.height
    );

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const colorIndex = getCompositedPixel(x, y, frame);
        const i = (y * state.width + x) * 4;

        if (colorIndex === -1) {
          image.data[i + 3] = 0;
          continue;
        }

        const rgb = hexToRgb(
          state.palette[colorIndex] || "#ffffff"
        );

        image.data[i] = rgb.r;
        image.data[i + 1] = rgb.g;
        image.data[i + 2] = rgb.b;
        image.data[i + 3] = 255;
      }
    }

    sourceCtx.putImageData(image, 0, 0);
    sctx.drawImage(source, index * (state.width + gap), 0);
  });

  sheet.toBlob(blob => {
    if (!blob) {
      toast("Could not export sprite sheet.", "error");
      return;
    }

    downloadBlob(
      blob,
      "pixelforge-sprite-sheet.png",
      "image/png"
    );

    toast("Sprite sheet exported.", "success");
  }, "image/png");
}

function downloadBlob(data, filename, type) {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data], { type });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");

  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toast(message, type = "") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;

  refs.toastStack.appendChild(item);

  setTimeout(() => {
    item.remove();
  }, 2200);
}

function setDuration(value) {
  const duration = clamp(Number(value) || 100, 20, 5000);

  commit(() => {
    currentFrame().duration = duration;
  }, "Change frame duration");
}

function resizeProject(width, height) {
  width = clamp(Math.round(width), 8, 128);
  height = clamp(Math.round(height), 8, 128);

  commit(() => {
    const oldWidth = state.width;
    const oldHeight = state.height;

    for (const frame of state.frames) {
      for (const layer of frame.layers) {
        const nextPixels = new Array(width * height).fill(-1);

        const copyWidth = Math.min(oldWidth, width);
        const copyHeight = Math.min(oldHeight, height);

        for (let y = 0; y < copyHeight; y++) {
          for (let x = 0; x < copyWidth; x++) {
            nextPixels[y * width + x] =
              layer.pixels[y * oldWidth + x];
          }
        }

        layer.pixels = nextPixels;
      }
    }

    state.width = width;
    state.height = height;
  }, "Resize canvas");

  toast(`Canvas resized to ${width} × ${height}.`, "success");
}

function play() {
  state.playing = true;
  updateReadouts();
}

function stop() {
  state.playing = false;
  updateReadouts();
}

let lastPlaybackTimestamp = 0;

function playbackLoop(timestamp) {
  requestAnimationFrame(playbackLoop);

  if (!state.playing) {
    lastPlaybackTimestamp = timestamp;
    return;
  }

  const duration = currentFrame().duration;

  if (timestamp - lastPlaybackTimestamp >= duration) {
    state.activeFrame =
      (state.activeFrame + 1) % state.frames.length;

    state.activeLayer = Math.min(
      state.activeLayer,
      currentFrame().layers.length - 1
    );

    lastPlaybackTimestamp = timestamp;
    renderAll();
  }
}

requestAnimationFrame(playbackLoop);

document.querySelectorAll(".tool-button[data-tool]").forEach(button => {
  button.addEventListener("click", () => {
    setTool(button.dataset.tool);
  });
});

document.querySelector("#undoButton").addEventListener("click", undo);
document.querySelector("#redoButton").addEventListener("click", redo);

refs.zoomSlider.addEventListener("input", event => {
  zoom = Number(event.target.value);
  renderCanvas();
  updateReadouts();
});

refs.gridButton.addEventListener("click", () => {
  commit(() => {
    state.grid = !state.grid;
  }, "Toggle grid");
});

refs.onionButton.addEventListener("click", () => {
  commit(() => {
    state.onionSkin = !state.onionSkin;
  }, "Toggle onion skin");
});

refs.durationInput.addEventListener("change", event => {
  setDuration(event.target.value);
});

refs.widthInput.addEventListener("change", () => {
  resizeProject(
    Number(refs.widthInput.value),
    Number(refs.heightInput.value)
  );
});

refs.heightInput.addEventListener("change", () => {
  resizeProject(
    Number(refs.widthInput.value),
    Number(refs.heightInput.value)
  );
});

document.querySelector("#newProjectButton").addEventListener("click", newProject);
document.querySelector("#saveProjectButton").addEventListener("click", saveProject);
document.querySelector("#exportButton").addEventListener("click", exportSpriteSheet);

document.querySelector("#addFrameButton").addEventListener("click", addFrame);
document.querySelector("#duplicateFrameButton").addEventListener("click", duplicateFrame);
document.querySelector("#deleteFrameButton").addEventListener("click", deleteFrame);

document.querySelector("#prevFrameButton").addEventListener("click", () => {
  selectFrame(
    (state.activeFrame - 1 + state.frames.length) %
      state.frames.length
  );
});

document.querySelector("#nextFrameButton").addEventListener("click", () => {
  selectFrame(
    (state.activeFrame + 1) % state.frames.length
  );
});

document.querySelector("#playButton").addEventListener("click", () => {
  state.playing ? stop() : play();
});

document.querySelector("#addLayerButton").addEventListener("click", addLayer);

canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;

  isDrawing = true;
  lastPointerCell = null;
  canvas.setPointerCapture(event.pointerId);

  const cell = getCellFromPointer(event);

  if (
    tool === "pencil" ||
    tool === "eraser"
  ) {
    commit(() => {
      setPixelDirect(
        cell.x,
        cell.y,
        tool === "eraser" ? -1 : selectedColor
      );
    }, tool === "eraser" ? "Erase pixel" : "Draw pixel");

    isDrawing = true;
  } else {
    usePointer(event);
  }
});

canvas.addEventListener("pointermove", event => {
  const cell = getCellFromPointer(event);

  if (inside(cell.x, cell.y)) {
    refs.cursorReadout.textContent = `x: ${cell.x}  y: ${cell.y}`;
  }

  if (!isDrawing) return;

  if (
    tool === "pencil" ||
    tool === "eraser"
  ) {
    if (
      !lastPointerCell ||
      lastPointerCell.x !== cell.x ||
      lastPointerCell.y !== cell.y
    ) {
      setPixelDirect(
        cell.x,
        cell.y,
        tool === "eraser" ? -1 : selectedColor
      );

      lastPointerCell = cell;
      renderCanvas();
      persistAndSync();
    }
  }
});

canvas.addEventListener("pointerup", event => {
  isDrawing = false;
  lastPointerCell = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  renderAll();
});

canvas.addEventListener("pointerleave", () => {
  refs.cursorReadout.textContent = "x: --  y: --";
});

document.querySelector("#runCommandButton").addEventListener("click", () => {
  try {
    const command = JSON.parse(refs.commandInput.value);
    runAgentCommand(command);
  } catch (error) {
    toast(`Invalid command JSON: ${error.message}`, "error");
  }
});

document.querySelector("#showCapabilitiesButton").addEventListener("click", async () => {
  refs.capabilitiesBox.classList.toggle("hidden");

  if (!refs.capabilitiesBox.classList.contains("hidden")) {
    try {
      const response = await fetch("/api/capabilities");
      const data = await response.json();

      refs.capabilitiesBox.textContent = data.commands
        .map(command => `• ${command}`)
        .join("\n");
    } catch {
      refs.capabilitiesBox.textContent = "Could not load capabilities.";
    }
  }
});

document.addEventListener("keydown", event => {
  const tag = document.activeElement?.tagName;

  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (event.key.toLowerCase() === "b") setTool("pencil");
  if (event.key.toLowerCase() === "e") setTool("eraser");
  if (event.key.toLowerCase() === "g") setTool("fill");
  if (event.key.toLowerCase() === "i") setTool("picker");

  if (event.code === "Space") {
    event.preventDefault();
    state.playing ? stop() : play();
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveProject();
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();

    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
  }
});

const commandHandlers = {
  new_project(command) {
    const width = clamp(Number(command.width || 32), 8, 128);
    const height = clamp(Number(command.height || 32), 8, 128);

    commit(() => {
      state = createProject(width, height);
      selectedColor = 0;
    }, "AI new project");
  },

  set_pixel(command) {
    const x = Number(command.x);
    const y = Number(command.y);
    const color = resolveColor(command.color);

    if (!inside(x, y)) {
      throw new Error(`Pixel (${x}, ${y}) is outside the canvas.`);
    }

    commit(() => {
      setPixelDirect(x, y, color);
    }, "AI set pixel");
  },

  set_pixels(command) {
    if (!Array.isArray(command.pixels)) {
      throw new Error('"pixels" must be an array.');
    }

    commit(() => {
      for (const item of command.pixels) {
        const x = Number(item.x);
        const y = Number(item.y);

        if (!inside(x, y)) continue;

        setPixelDirect(x, y, resolveColor(item.color));
      }
    }, "AI set pixels");
  },

  fill(command) {
    const x = Number(command.x);
    const y = Number(command.y);

    if (!inside(x, y)) {
      throw new Error("Fill origin is outside the canvas.");
    }

    floodFill(x, y, resolveColor(command.color));
  },

  fill_rect(command) {
    const x = Number(command.x);
    const y = Number(command.y);
    const width = Number(command.width);
    const height = Number(command.height);
    const color = resolveColor(command.color);

    commit(() => {
      for (let yy = y; yy < y + height; yy++) {
        for (let xx = x; xx < x + width; xx++) {
          if (inside(xx, yy)) {
            setPixelDirect(xx, yy, color);
          }
        }
      }
    }, "AI fill rectangle");
  },

  clear() {
    commit(() => {
      currentLayer().pixels.fill(-1);
    }, "AI clear layer");
  },

  add_frame(command) {
    const after = Number.isFinite(Number(command.after))
      ? Number(command.after)
      : state.activeFrame;

    commit(() => {
      const referenceDuration = currentFrame().duration;
      const frame = createFrame(
        state.width,
        state.height,
        Number(command.duration) || referenceDuration
      );

      const insertAt = clamp(
        after + 1,
        0,
        state.frames.length
      );

      state.frames.splice(insertAt, 0, frame);
      state.activeFrame = insertAt;
      state.activeLayer = 0;
    }, "AI add frame");
  },

  duplicate_frame(command) {
    const from = clamp(
      Number(command.frame ?? state.activeFrame),
      0,
      state.frames.length - 1
    );

    commit(() => {
      const duplicate = clone(state.frames[from]);
      duplicate.id = crypto.randomUUID();

      duplicate.layers.forEach(layer => {
        layer.id = crypto.randomUUID();
      });

      const insertAt = from + 1;

      state.frames.splice(insertAt, 0, duplicate);
      state.activeFrame = insertAt;
      state.activeLayer = 0;
    }, "AI duplicate frame");
  },

  delete_frame(command) {
    if (state.frames.length === 1) {
      throw new Error("Cannot delete the only frame.");
    }

    const index = clamp(
      Number(command.frame ?? state.activeFrame),
      0,
      state.frames.length - 1
    );

    commit(() => {
      state.frames.splice(index, 1);
      state.activeFrame = Math.min(
        state.activeFrame,
        state.frames.length - 1
      );
    }, "AI delete frame");
  },

  select_frame(command) {
    const index = clamp(
      Number(command.frame),
      0,
      state.frames.length - 1
    );

    commit(() => {
      state.activeFrame = index;
      state.activeLayer = 0;
    }, "AI select frame");
  },

  set_frame_duration(command) {
    const index = clamp(
      Number(command.frame ?? state.activeFrame),
      0,
      state.frames.length - 1
    );

    const duration = clamp(
      Number(command.duration),
      20,
      5000
    );

    commit(() => {
      state.frames[index].duration = duration;
    }, "AI frame duration");
  },

  add_layer(command) {
    const name = String(
      command.name || `Layer ${currentFrame().layers.length + 1}`
    );

    commit(() => {
      currentFrame().layers.push(
        createLayer(name, state.width, state.height)
      );

      state.activeLayer =
        currentFrame().layers.length - 1;
    }, "AI add layer");
  },

  delete_layer() {
    deleteLayer();
  },

  select_layer(command) {
    const index = clamp(
      Number(command.layer),
      0,
      currentFrame().layers.length - 1
    );

    commit(() => {
      state.activeLayer = index;
    }, "AI select layer");
  },

  set_layer_visibility(command) {
    const index = clamp(
      Number(command.layer ?? state.activeLayer),
      0,
      currentFrame().layers.length - 1
    );

    commit(() => {
      currentFrame().layers[index].visible =
        command.visible !== false;
    }, "AI layer visibility");
  },

  set_onion_skin(command) {
    commit(() => {
      state.onionSkin = command.enabled !== false;
    }, "AI onion skin");
  },

  set_grid(command) {
    commit(() => {
      state.grid = command.enabled !== false;
    }, "AI grid");
  },

  play() {
    play();
  },

  stop() {
    stop();
  },

  export_sprite_sheet() {
    exportSpriteSheet();
  },

  export_project() {
    saveProject();
  }
};

function resolveColor(input) {
  if (typeof input === "number") {
    if (input < 0 || input >= state.palette.length) {
      throw new Error(`Palette index ${input} does not exist.`);
    }

    return input;
  }

  if (typeof input === "string") {
    const normalized = input.startsWith("#")
      ? input.toLowerCase()
      : `#${input.toLowerCase()}`;

    const index = state.palette.findIndex(
      color => color.toLowerCase() === normalized
    );

    if (index !== -1) return index;

    state.palette.push(normalized);
    return state.palette.length - 1;
  }

  return selectedColor;
}

async function runAgentCommand(command) {
  if (!command || typeof command.command !== "string") {
    throw new Error('Command object must include "command".');
  }

  const handler = commandHandlers[command.command];

  if (!handler) {
    throw new Error(`Unknown command: ${command.command}`);
  }

  try {
    const result = await handler(command);

    persistAndSync();

    const response = {
      type: "command_result",
      id: command.id || null,
      ok: true,
      command: command.command,
      result: result ?? null,
      state: exportState()
    };

    sendSocket(response);
    toast(`Agent: ${command.command}`, "success");

    return response;
  } catch (error) {
    const response = {
      type: "command_result",
      id: command.id || null,
      ok: false,
      command: command.command,
      error: error.message
    };

    sendSocket(response);
    toast(error.message, "error");

    return response;
  }
}

window.PixelForgeAI = {
  version: "pixelforge-command-v1",

  getState() {
    return clone(exportState());
  },

  getCapabilities() {
    return Object.keys(commandHandlers);
  },

  execute(command) {
    return runAgentCommand(command);
  }
};

let socket = null;
let reconnectTimer = null;

function connectSocket() {
  const protocol =
    window.location.protocol === "https:" ? "wss:" : "ws:";

  socket = new WebSocket(
    `${protocol}//${window.location.host}`
  );

  socket.addEventListener("open", () => {
    refs.connectionPill.classList.add("connected");
    refs.connectionText.textContent = "Agent bridge online";
    refs.agentStatus.textContent = "HTTP + WebSocket connected";
    refs.agentLed.classList.add("online");

    sendSocket({
      type: "state",
      state: exportState()
    });
  });

  socket.addEventListener("message", async event => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === "agent_command") {
        const command = {
          ...message.command,
          id: message.id
        };

        await runAgentCommand(command);
      }

      if (message.type === "state_snapshot" && message.state) {
        state = {
          ...message.state,
          playing: false
        };

        renderAll();
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(exportState())
        );
      }
    } catch (error) {
      console.error(error);
    }
  });

  socket.addEventListener("close", () => {
    refs.connectionPill.classList.remove("connected");
    refs.connectionText.textContent = "Bridge offline";
    refs.agentStatus.textContent = "Retrying connection";
    refs.agentLed.classList.remove("online");

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSocket, 1500);
  });
}

function sendSocket(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

connectSocket();

renderAll();
===== END FILE =====
