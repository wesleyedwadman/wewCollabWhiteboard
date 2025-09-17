// CollaborativeWhiteboard.tsx (clean rewrite)
// ------------------------------------------------------------
// React + TypeScript + Fabric.js whiteboard with Firestore sync.
// Tested with Vite. Works without Firebase config (offline mode).
// ------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
// Fabric import (works across bundlers and Fabric v5/v6)
import { fabric } from "fabric";

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  doc,
  deleteDoc,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { v4 as uuidv4 } from "uuid";

// ---------- Firebase Config ----------
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

let app: FirebaseApp | null = null;
let db: ReturnType<typeof getFirestore> | null = null;
try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
} catch (e) {
  console.warn("Firebase initialization failed; running offline.", e);
}

// ---------- Types ----------

type Tool = "select" | "pen" | "line" | "rect" | "ellipse" | "erase";

type RemoteObject = {
  id?: string;
  json: any; // fabric toObject() payload
  createdAt?: unknown;
};

// ---------- Component ----------
export default function CollaborativeWhiteboard() {
  // Canvas & fabric
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);

  // Tools/UI state
  const [tool, setTool] = useState<Tool>("pen");
  const [stroke, setStroke] = useState<string>("#111827");
  const [fill, setFill] = useState<string>("transparent");
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [boardId, setBoardId] = useState<string>(() => new URLSearchParams(window.location.search).get("board") || "default-board");

  const connected = !!db;

  // Collaboration helpers
  const isRemoteApplying = useRef<boolean>(false);
  const objectsMapRef = useRef<Map<string, fabric.Object>>(new Map()); // docId → fabricObject

  // Undo/redo stacks (refs to avoid re-renders)
  const undoRef = useRef<fabric.Object[]>([]);
  const redoRef = useRef<fabric.Object[]>([]);

  // ---------- Init Fabric Canvas ----------
  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    const canvas = new fabric.Canvas(canvasEl, {
      backgroundColor: "#ffffff",
      selection: tool === "select",
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // Resize to parent container
    const resize = () => {
      const parent = canvasEl.parentElement;
      if (!parent) return;
      canvas.setWidth(parent.clientWidth);
      canvas.setHeight(Math.max(500, window.innerHeight - 220));
      canvas.renderAll();
    };
    resize();
    window.addEventListener("resize", resize);

    // Drawing state
    let isDrawing = false;
    let tempObj: fabric.Object | null = null;
    let origin: { x: number; y: number } | null = null;

    const startDrawing = (opt: fabric.IEvent) => {
      if (tool === "select" || !canvas) return;
      const pointer = canvas.getPointer(opt.e);
      origin = { x: pointer.x, y: pointer.y };
      isDrawing = true;

      if (tool === "pen") {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        (canvas.freeDrawingBrush as fabric.PencilBrush).color = stroke;
        (canvas.freeDrawingBrush as fabric.PencilBrush).width = strokeWidth;
        return;
      }

      canvas.isDrawingMode = false;
      if (tool === "line") {
        tempObj = new fabric.Line([origin.x, origin.y, origin.x, origin.y], {
          stroke,
          strokeWidth,
          selectable: false,
          objectCaching: false,
        });
      } else if (tool === "rect") {
        tempObj = new fabric.Rect({
          left: origin.x,
          top: origin.y,
          width: 1,
          height: 1,
          stroke,
          strokeWidth,
          fill: fill === "transparent" ? "rgba(0,0,0,0)" : fill,
          selectable: false,
          objectCaching: false,
        });
      } else if (tool === "ellipse") {
        tempObj = new fabric.Ellipse({
          left: origin.x,
          top: origin.y,
          rx: 1,
          ry: 1,
          stroke,
          strokeWidth,
          fill: fill === "transparent" ? "rgba(0,0,0,0)" : fill,
          selectable: false,
          objectCaching: false,
        });
      } else if (tool === "erase") {
        const target = canvas.findTarget(opt.e, true);
        if (target) {
          pushUndo(target);
          canvas.remove(target);
          if (connected) void removeRemote(target);
          canvas.requestRenderAll();
        }
        isDrawing = false;
        origin = null;
        return;
      }

      if (tempObj) canvas.add(tempObj);
    };

    const whileDrawing = (opt: fabric.IEvent) => {
      if (!isDrawing || !origin || !canvas) return;
      const p = canvas.getPointer(opt.e);
      if (tool === "line" && tempObj instanceof fabric.Line) {
        tempObj.set({x2: p.x, y2: p.y});
      } else if (tool === "rect" && tempObj instanceof fabric.Rect) {
        const w = p.x - origin.x;
        const h = p.y - origin.y;
        tempObj.set({
          width: Math.abs(w),
          height: Math.abs(h),
          left: w < 0 ? p.x : origin.x,
          top: h < 0 ? p.y : origin.y,
        });
      } else if (tool === "ellipse" && tempObj instanceof fabric.Ellipse) {
        const rx = Math.abs(p.x - origin.x) / 2;
        const ry = Math.abs(p.y - origin.y) / 2;
        tempObj.set({
          rx: Math.max(rx, 1),
          ry: Math.max(ry, 1),
          left: Math.min(origin.x, p.x),
          top: Math.min(origin.y, p.y),
        });
      }
      canvas.requestRenderAll();
    };

    const endDrawing = async () => {
      if (!isDrawing || !canvas) return;
      isDrawing = false;
      canvas.isDrawingMode = false;

      if (tool === "pen") {
        const last = canvas.getObjects().slice(-1)[0];
        if (last) {
          last.set({ selectable: true });
          pushUndo(last);
          await maybeSyncAdd(last);
        }
      } else if (tempObj) {
        tempObj.set({ selectable: true });
        pushUndo(tempObj);
        await maybeSyncAdd(tempObj);
        tempObj = null;
      }
      origin = null;
      canvas.requestRenderAll();
    };

    canvas.on("mouse:down", startDrawing);
    canvas.on("mouse:move", whileDrawing);
    canvas.on("mouse:up", endDrawing);

    // Keyboard shortcuts
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const active = canvas.getActiveObjects();
        if (active.length) {
          active.forEach((obj: fabric.Object) => {
            pushUndo(obj);
            canvas.remove(obj);
            if (connected) void removeRemote(obj);
          });
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, stroke, strokeWidth, fill, connected]);

  // ---------- Remote Sync: Firestore subscription ----------
  useEffect(() => {
    if (!db || !fabricRef.current) return;

    const c = collection(db, "boards", boardId, "objects");
    const qy = query(c, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(qy, (snapshot) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      isRemoteApplying.current = true;

      snapshot.docs.forEach((d: QueryDocumentSnapshot<DocumentData>) => {
        const id = d.id;
        if (objectsMapRef.current.has(id)) return;
        const data = d.data() as RemoteObject;
        // @ts-ignore – fabric util API differs across versions
        fabric.util.enlivenObjects([data.json], (enlivened: fabric.Object[]) => {
          enlivened.forEach((obj) => {
            (obj as any).__remoteId = id;
            obj.selectable = true;
            canvas.add(obj);
            objectsMapRef.current.set(id, obj);
          });

          canvas.requestRenderAll();
        });
      });

      isRemoteApplying.current = false;
    });

    return () => unsub();
  }, [boardId]);

  // ---------- Helpers: Sync add / remove ----------
  const maybeSyncAdd = async (obj: fabric.Object) => {
    if (!db || isRemoteApplying.current) return;
    try {
      const c = collection(db, "boards", boardId, "objects");
      const payload = (obj as any).toObject ? (obj as any).toObject(["rx", "ry"]) : {};
      const ref = await addDoc(c, {
        json: payload,
        createdAt: serverTimestamp(),
      });
      (obj as any).__remoteId = ref.id;
      objectsMapRef.current.set(ref.id, obj);
    } catch (e) {
      console.error("Failed to sync add", e);
    }
  };

  const removeRemote = async (obj: fabric.Object) => {
    if (!db) return;
    const id = (obj as any).__remoteId as string | undefined;
    if (!id) return;
    try {
      await deleteDoc(doc(db, "boards", boardId, "objects", id));
      objectsMapRef.current.delete(id);
    } catch (e) {
      console.error("Failed to delete remote object", e);
    }
  };

  // ---------- Undo / Redo ----------
  const pushUndo = (obj: fabric.Object) => {
    undoRef.current = [...undoRef.current, obj];
    redoRef.current = [];
  };

  const handleUndo = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const stack = undoRef.current;
    if (!stack.length) return;
    const last = stack[stack.length - 1];
    canvas.remove(last);
    redoRef.current = [last, ...redoRef.current];
    undoRef.current = stack.slice(0, -1);
    if (connected) void removeRemote(last);
    canvas.requestRenderAll();
  };

  const handleRedo = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const r = redoRef.current;
    if (!r.length) return;
    const next = r[0];
    canvas.add(next);
    pushUndo(next);
    redoRef.current = r.slice(1);
    if (connected) void maybeSyncAdd(next);
    canvas.requestRenderAll();
  };

  // ---------- Clear & Export ----------
  const handleClear = async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objs = canvas.getObjects();
    for (const o of objs) {
      if (connected) await removeRemote(o);
      canvas.remove(o);
    }
    undoRef.current = [];
    redoRef.current = [];
    canvas.requestRenderAll();
  };

  const handleExportPNG = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `whiteboard-${boardId}.png`;
    a.click();
  };

  // ---------- Board mgmt ----------
  const newBoard = () => {
    const id = uuidv4().slice(0, 8);
    setBoardId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("board", id);
    window.history.replaceState({}, "", url.toString());
  };

  const copyShareLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("board", boardId);
    await navigator.clipboard.writeText(url.toString());
  };

  // ---------- Render ----------
  return (
    <div className="w-full flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold">Collab Whiteboard</span>
          <span className="text-xs text-gray-500">(React + Fabric + Firestore)</span>
          <span className={`ml-3 inline-flex items-center rounded-full px-2 py-0.5 text-xs ${connected ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
            {connected ? "Realtime: ON" : "Realtime: OFF (no Firebase config)"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="px-2 py-1 border rounded-md text-sm"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            placeholder="board id"
          />
          <button onClick={newBoard} className="px-3 py-1.5 rounded-xl bg-gray-900 text-white text-sm shadow">
            New Board
          </button>
          <button onClick={copyShareLink} className="px-3 py-1.5 rounded-xl bg-gray-100 text-sm shadow">
            Copy Share Link
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow">
        <ToolButton label="Select" active={tool === "select"} onClick={() => setTool("select")} />
        <ToolButton label="Pen" active={tool === "pen"} onClick={() => setTool("pen")} />
        <ToolButton label="Line" active={tool === "line"} onClick={() => setTool("line")} />
        <ToolButton label="Rect" active={tool === "rect"} onClick={() => setTool("rect")} />
        <ToolButton label="Ellipse" active={tool === "ellipse"} onClick={() => setTool("ellipse")} />
        <ToolButton label="Erase" active={tool === "erase"} onClick={() => setTool("erase")} />

        <div className="w-px h-6 bg-gray-200 mx-1" />

        <label className="flex items-center gap-2 text-sm">
          Stroke
          <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Fill
          <input type="color" value={fill === "transparent" ? "#ffffff" : fill} onChange={(e) => setFill(e.target.value)} />
          <button className="px-2 py-1 rounded-md bg-gray-100 text-xs" onClick={() => setFill("transparent")}>Transparent</button>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Width
          <input type="range" min={1} max={20} value={strokeWidth} onChange={(e) => setStrokeWidth(parseInt(e.target.value))} />
          <span className="w-8 text-right text-xs">{strokeWidth}px</span>
        </label>

        <div className="w-px h-6 bg-gray-200 mx-1" />

        <button onClick={handleUndo} className="px-3 py-1.5 rounded-xl bg-gray-100 text-sm">Undo</button>
        <button onClick={handleRedo} className="px-3 py-1.5 rounded-xl bg-gray-100 text-sm">Redo</button>
        <button onClick={handleClear} className="px-3 py-1.5 rounded-xl bg-gray-100 text-sm">Clear</button>
        <button onClick={handleExportPNG} className="px-3 py-1.5 rounded-xl bg-gray-900 text-white text-sm">Export PNG</button>
      </div>

      <div className="rounded-2xl overflow-hidden shadow bg-white">
        <canvas ref={canvasRef} className="w-full h-[600px]" />
      </div>

      <details className="mt-2 text-sm text-gray-600">
        <summary className="cursor-pointer font-medium">Setup Guide (Vite + Firebase)</summary>
        <div className="mt-2 space-y-2">
          <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 border">{`
# 1) Create a new project
npm create vite@latest collab-whiteboard -- --template react-ts
cd collab-whiteboard

# 2) Install deps
npm i fabric firebase uuid

# 3) Optional: Tailwind
npm i -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# 4) Add this file as src/CollaborativeWhiteboard.tsx and render it in App.tsx

# 5) Firebase setup (optional for realtime)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# 6) Run
npm run dev

# 7) Deploy
Push to GitHub → Import on Vercel → add env vars
`}</pre>
        </div>
      </details>
    </div>
  );

  // ---------- UI helper ----------
  function ToolButton({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        className={`px-3 py-1.5 rounded-xl text-sm shadow border ${active ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200"}`}
      >
        {label}
      </button>
    );
  }
}
