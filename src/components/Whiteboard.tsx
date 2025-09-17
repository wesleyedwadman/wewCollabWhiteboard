import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Toolbar } from "./Toolbar";
import { useRealtimeSync } from "../hooks/useRealtimeSync";
import { useUndoRedo } from "../hooks/useUndoRedo";
import { isConnected } from "../lib/firebase";
import type { Tool } from "../types/whiteboard";


import { firestore as db } from "../lib/firebase";
import { firestore } from "../lib/firebase";
import { collection, addDoc, Firestore, onSnapshot, serverTimestamp, updateDoc, doc } from "firebase/firestore";

// Ensure: npm i -D @types/fabric  and  npm i fabric@5
import { fabric } from "fabric";
import firebase from "firebase/compat/app";

//export function Whiteboard(): JSX.Element {
export const Whiteboard: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null); // canvas reference
  const fabricRef = useRef<fabric.Canvas | null>(null); // fabric reference handles events
  const fileInputRef = useRef<HTMLInputElement | null>(null); // image inputs

  const [tool, setTool] = useState<Tool>("pen");
  const [stroke, setStroke] = useState<string>("#111827");
  const [fill, setFill] = useState<string>("transparent");
  const [strokeWidth, setStrokeWidth] = useState<number>(3);

  const [boardId, setBoardId] = useState<string>(() => {
    const q = new URLSearchParams(window.location.search);
    const existing = q.get("board");
    return existing ?? uuidv4().slice(0, 8);
  });

  const wrapperRef = useRef<HTMLDivElement | null>(null); // UI reference

  const connected = isConnected; // Firestore connection

  // Map of Firestore doc id -> fabric object
  const objectsMapRef = useRef<Map<string, fabric.Object>>(new Map()); // Firestore ID -> Fabric object

  const [canvasReady, setCanvasReady] = useState(false);

  const openImagePicker = () => fileInputRef.current?.click(); // image inputs

  // Realtime & undo/redo helpers
  const { maybeSyncAdd, removeRemote, isRemoteApplying } = useRealtimeSync(boardId, fabricRef, objectsMapRef, canvasReady);
  const { pushAdd, pushRemove, handleUndo, handleRedo, handleClear } = useUndoRedo(
    fabricRef,
    connected,
    removeRemote,
    maybeSyncAdd
  );

  // Keep latest tool/style values available to stable handlers
  const toolRef = useRef<Tool>(tool);
  const strokeRef = useRef<string>(stroke);
  const fillRef = useRef<string>(fill);
  const strokeWidthRef = useRef<number>(strokeWidth);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { strokeRef.current = stroke; }, [stroke]);
  useEffect(() => { fillRef.current = fill; }, [fill]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);

  // ---- Initialize Fabric ONCE ----
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const canvas = new fabric.Canvas(el, {
      backgroundColor: "#ffffff",
      selection: toolRef.current === "select",
      preserveObjectStacking: true,
    });

    fabricRef.current = canvas;
    setCanvasReady(true)

    // syncs modified objects
    canvas.on("object:modified", async (e: any) => {
      const db: Firestore | null = firestore;
      if (!db) return; // req. firestore initialization
      if (!e?.target) return;
    
      const obj = e.target as fabric.Object;
      const id = (obj as any).__remoteId as string | undefined;
      if (!id) return;
    
      // prevent echo-loop when we are applying remote changes
      if (isRemoteApplying.current) return;
    
      const colRef = collection(db, "boards", boardId, "objects"); // Points to the firestore sub-collection for all canvas objects
      const ref = doc(colRef, id); // points do modified object id
    
      const payload = (obj as any).toObject //serializable
        ? (obj as any).toObject([
            "type","left","top","width","height","scaleX","scaleY","angle",
            "rx","ry","strokeUniform","fill","stroke","strokeWidth",
            "path","src"
          ])
        : {};
    
      try {
        await updateDoc(ref, {
          json: JSON.stringify(payload),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error("[sync] update failed", err);
      }
    });

    canvas.perPixelTargetFind = true;   // precise hit test //temp
    canvas.targetFindTolerance = 6;     // forgiving for thin lines //temp
    canvas.skipTargetFind = false; //temp

    const resize = () => {
      // match Fabric’s backstore to the actual rendered element size
      const wrap = wrapperRef.current;
      if (!wrap) return;
    
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
    
      // Update Fabric's drawing surfaces (lower + upper) and CSS size
      canvas.setDimensions({ width: w, height: h });       // sets backstore + css
      canvas.calcOffset();
      canvas.requestRenderAll();
    };

    resize();

    const ro = new ResizeObserver(resize);
    if (wrapperRef.current) ro.observe(wrapperRef.current);

    window.addEventListener("resize", resize);

    let isDrawing = false;
    let tempObj: fabric.Object | null = null;
    let origin: {x: number; y: number} | null = null;

    const startDrawing = (opt: fabric.IEvent) => {
      const currentTool = toolRef.current;
      const currentStroke = strokeRef.current;
      const currentFill = fillRef.current;
      const currentWidth = strokeWidthRef.current;
    
      // keep selection in sync
      canvas.selection = currentTool === "select";
      if (currentTool === "select") return;
    
      const p = canvas.getPointer(opt.e);
      origin = { x: p.x, y: p.y };
      isDrawing = true;
    
      if (currentTool === "pen") {
        canvas.isDrawingMode = true;
    
        if (!canvas.freeDrawingBrush) {
          canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        }
    
        const brush = canvas.freeDrawingBrush as fabric.PencilBrush;
        brush.color = currentStroke;
        brush.width = currentWidth;
        return; // exit early, pen doesn’t create tempObj
      }
    
      // All shape tools should disable freehand mode
      canvas.isDrawingMode = false;
    
      if (currentTool === "line") {
        tempObj = new fabric.Line([origin.x, origin.y, origin.x, origin.y], {
          stroke: currentStroke,
          strokeWidth: currentWidth,
          selectable: false,
          objectCaching: false,
        });
      } else if (currentTool === "rect") {
        tempObj = new fabric.Rect({
          left: origin.x,
          top: origin.y,
          width: 1,
          height: 1,
          stroke: currentStroke,
          strokeWidth: currentWidth,
          fill: currentFill === "transparent" ? "rgba(0,0,0,0)" : currentFill,
          selectable: false,
          objectCaching: false,
        });
      } else if (currentTool === "ellipse") {
        tempObj = new fabric.Ellipse({
          left: origin.x,
          top: origin.y,
          rx: 1,
          ry: 1,
          stroke: currentStroke,
          strokeWidth: currentWidth,
          fill: currentFill === "transparent" ? "rgba(0,0,0,0)" : currentFill,
          selectable: false,
          objectCaching: false,
        });
      } else if (currentTool === "erase") {
        // try normal hit-test
        let target = canvas.findTarget(opt.e, true);

        // fallback manual scan (helps with thin edges)
        if (!target) {
          const p = canvas.getPointer(opt.e);
          const objects = canvas.getObjects().slice().reverse();
          target = objects.find(o => (o as any).containsPoint?.(p)) as fabric.Object | undefined;
        }

        if (target) {
          // if you updated the hook: use pushRemove; else keep pushUndo
          //pushUndo(target)
          pushRemove(target);          // record the removal
          canvas.remove(target);
          if (connected) void removeRemote(target);
          canvas.requestRenderAll();
        }
        isDrawing = false;
        origin = null;
        return;
      }
    
      if (tempObj) {
        tempObj.selectable = false;
        tempObj.evented = false;
        (tempObj as any).perPixelTargetFind = true;
        canvas.add(tempObj);
      }
    };

    const whileDrawing = (opt: fabric.IEvent) => {
      if (!isDrawing || !origin) return;
      const p = canvas.getPointer(opt.e);

      if (tempObj instanceof fabric.Line) {
        tempObj.set({x2: p.x, y2: p.y});
        tempObj.setCoords(); 
      } else if (tempObj instanceof fabric.Rect) {
        const w = p.x - origin.x;
        const h = p.y - origin.y;
        tempObj.set({
          width: Math.abs(w),
          height: Math.abs(h),
          left: w < 0 ? p.x : origin.x,
          top: h < 0 ? p.y : origin.y,
        });
        tempObj.setCoords(); 
      } else if (tempObj instanceof fabric.Ellipse) {
        const rx = Math.abs(p.x - origin.x) / 2;
        const ry = Math.abs(p.y - origin.y) / 2;
        tempObj.set({
          rx: Math.max(rx, 1),
          ry: Math.max(ry, 1),
          left: Math.min(origin.x, p.x),
          top: Math.min(origin.y, p.y),
        });
        tempObj.setCoords(); 
      }

      canvas.requestRenderAll();
    };

    const endDrawing = async () => {
      if (!isDrawing) return;
      isDrawing = false;
      //canvas.isDrawingMode = false;

      canvas.isDrawingMode = toolRef.current === "pen";

      if (tempObj) {
        tempObj.set({
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          objectCaching: false,        // keep geometry fresh
          strokeUniform: true,         // improves thin-line interaction
        });
        (tempObj as any).perPixelTargetFind = true;

        tempObj.setCoords();
      
        // Record the add in history (using current hook API)
        pushAdd(tempObj)
      
        await maybeSyncAdd(tempObj);
        tempObj = null;
        canvas.requestRenderAll(); // might remove
      }
      origin = null;
      canvas.requestRenderAll();

      canvas.on("path:created", async (e: any) => {
        const path = e?.path as fabric.Path | undefined;
        if (!path) return;
        path.set({ selectable: true }); // makes it selectable
        (path as any).perPixelTargetFind = true;
        pushAdd(path); // Undo/Redo 
        await maybeSyncAdd(path);
        canvas.requestRenderAll();
      });
    };

    // Attach events
    canvas.on("mouse:down", startDrawing);
    canvas.on("mouse:move", whileDrawing);
    canvas.on("mouse:up", endDrawing);

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
            pushRemove(obj);
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
      setCanvasReady(false);
      canvas.dispose();
      fabricRef.current = null;
    };

  }, []); // run once

  // Reflect selection/drawing mode immediately when tool changes
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    c.selection = tool === "select";
    if (tool !== "pen") c.isDrawingMode = false;
  }, [tool]);

  // clears board
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    c.discardActiveObject();
    c.getObjects().forEach(o => c.remove(o));
    c.requestRenderAll();
    objectsMapRef.current.clear();
  }, [boardId]);

  useEffect(() => { // firestore connection
    if (!db) { console.warn("No Firestore instance"); return; }
  
    const col = collection(db, "debug-pings");
    addDoc(col, { at: serverTimestamp(), boardId })
      .then((ref) => console.log("Write OK, docId:", ref.id))
      .catch((err) => console.error("Write FAIL:", err));
  
    const unsub = onSnapshot(col, (snap) => {
      console.log("Live debug-pings count:", snap.size);
    }, (err) => {
      console.error("Snapshot FAIL:", err);
    });
  
    return unsub;
  }, [boardId]);

  // ----- Helpers for header/buttons -----
  const handleExportPNG = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `whiteboard-${boardId}.png`;
    a.click();
  };

  const newBoard = () => {
    const id = uuidv4().slice(0, 8);
    setBoardId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("board", id);
    window.history.replaceState({}, "", url.toString());

    window.location.reload();
  };

  const copyShareLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("board", boardId);
    await navigator.clipboard.writeText(url.toString());
  };

  const handleFiles = (files: FileList) => {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Create a Fabric image from DataURL
      fabric.Image.fromURL(
        dataUrl,
        (img) => {
          const canvas = fabricRef.current;
          if (!canvas) return;
          img.set({
            left: canvas.getWidth() / 2 - (img.width ?? 0) / 2,
            top: canvas.getHeight() / 2 - (img.height ?? 0) / 2,
            selectable: true,
            hasControls: true,
            hasBorders: true,
            objectCaching: false,
            // scale down large images
            scaleX: Math.min(1, (canvas.getWidth() / (img.width ?? 1)) * 0.6),
            scaleY: Math.min(1, (canvas.getHeight() / (img.height ?? 1)) * 0.6),
          });
          (img as any).perPixelTargetFind = true;
          img.setCoords();
          canvas.add(img);
          canvas.setActiveObject(img);
          canvas.requestRenderAll();
  
          // history + sync
          pushAdd?.(img) ?? pushRemove(img);
          void maybeSyncAdd(img);
        },
        { crossOrigin: "anonymous" }
      );
    };
    reader.readAsDataURL(file);
  };

  // JSX return
  return (
    <div className="w-full flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold">Collab Whiteboard</span>
          <span className="text-xs text-gray-500">(React + Fabric + Firestore)</span>
          <span
            className={`ml-3 inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
              connected ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
            }`}
          >
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

      <Toolbar
        tool={tool}
        stroke={stroke}
        fill={fill}
        strokeWidth={strokeWidth}
        onTool={setTool}
        onStroke={setStroke}
        onFill={setFill}
        onTransparentFill={() => setFill("transparent")}
        onWidth={(n) => setStrokeWidth(n)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        onExport={handleExportPNG}
        onImportImage={openImagePicker}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      
      <div
        ref={wrapperRef}
        style={{
          width: "100vw",          // full viewport width
          height: "80vh",          // adjust as you like: 70–90vh
          background: "white",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
        }}
      >
        <canvas key={boardId} ref={canvasRef} />
      </div>
    </div>
  );
}