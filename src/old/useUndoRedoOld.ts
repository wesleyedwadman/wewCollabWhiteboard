import {useRef} from "react";
import type {WBObject} from "../types/whiteboard";


export function useUndoRedo(
fabricRef: React.MutableRefObject<fabric.Canvas | null>,
connected: boolean,
removeRemote: (obj: WBObject) => Promise<void> | void,
maybeSyncAdd: (obj: WBObject) => Promise<void> | void,
) {
const undoRef = useRef<WBObject[]>([]);
const redoRef = useRef<WBObject[]>([]);


const pushUndo = (obj: WBObject) => {
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


return { pushUndo, handleUndo, handleRedo, handleClear };
}