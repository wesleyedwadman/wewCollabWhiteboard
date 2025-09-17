import { useRef } from "react";

type AddEntry    = { type: "add"; obj: fabric.Object };
type RemoveEntry = { type: "remove"; obj: fabric.Object };
type BatchRemove = { type: "batch-remove"; objs: fabric.Object[] };
type Entry = AddEntry | RemoveEntry | BatchRemove;

export function useUndoRedo(
  fabricRef: React.MutableRefObject<fabric.Canvas | null>,
  connected: boolean,
  removeRemote: (obj: fabric.Object) => Promise<void> | void,
  maybeSyncAdd: (obj: fabric.Object) => Promise<void> | void,
) {
  const undoRef = useRef<Entry[]>([]);
  const redoRef = useRef<Entry[]>([]);

  const pushAdd = (obj: fabric.Object) => {
    undoRef.current = [...undoRef.current, { type: "add", obj }];
    redoRef.current = [];
  };

  const pushRemove = (obj: fabric.Object) => {
    undoRef.current = [...undoRef.current, { type: "remove", obj }];
    redoRef.current = [];
  };

  const handleUndo = async () => {
    const canvas = fabricRef.current;
    if (!canvas || !undoRef.current.length) return;

    const last = undoRef.current.pop()!;
    if (last.type === "add") {
      // Undo an add => remove it
      canvas.remove(last.obj);
      if (connected) await removeRemote(last.obj);
      redoRef.current.unshift({ type: "add", obj: last.obj });
    } else if (last.type === "remove") {
      // Undo a remove => add back
      canvas.add(last.obj);
      if (connected) await maybeSyncAdd(last.obj);
      redoRef.current.unshift({ type: "remove", obj: last.obj });
    } else {
      // Undo a clear (batch remove) => add all back
      for (const o of last.objs) {
        canvas.add(o);
        if (connected) await maybeSyncAdd(o);
      }
      redoRef.current.unshift({ type: "batch-remove", objs: last.objs });
    }
    canvas.requestRenderAll();
  };

  const handleRedo = async () => {
    const canvas = fabricRef.current;
    if (!canvas || !redoRef.current.length) return;

    const next = redoRef.current.shift()!;
    if (next.type === "add") {
      // Redo an add => add again
      canvas.add(next.obj);
      if (connected) await maybeSyncAdd(next.obj);
      undoRef.current = [...undoRef.current, { type: "add", obj: next.obj }];
    } else if (next.type === "remove") {
      // Redo a remove => remove again
      canvas.remove(next.obj);
      if (connected) await removeRemote(next.obj);
      undoRef.current = [...undoRef.current, { type: "remove", obj: next.obj }];
    } else {
      // Redo a clear => remove all again
      for (const o of next.objs) {
        canvas.remove(o);
        if (connected) await removeRemote(o);
      }
      undoRef.current = [...undoRef.current, { type: "batch-remove", objs: next.objs }];
    }
    canvas.requestRenderAll();
  };

  // Clear: remove everything as ONE undo step
  const handleClear = async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objs = canvas.getObjects().slice(); // copy
    if (!objs.length) return;

    // Record ONE batch entry so a single Undo restores all
    undoRef.current = [...undoRef.current, { type: "batch-remove", objs }];
    redoRef.current = [];

    for (const o of objs) {
      if (connected) await removeRemote(o);
      canvas.remove(o);
    }
    canvas.requestRenderAll();
  };

  return { pushAdd, pushRemove, handleUndo, handleRedo, handleClear }; // returned API
}