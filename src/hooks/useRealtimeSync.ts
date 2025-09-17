import { useEffect, useRef } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  doc,
  deleteDoc,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { firestore } from "../lib/firebase";
import { fabric } from "fabric";

type RemoteDoc = {
  json: string;        // JSON stored as a STRING in Firestore
  createdAt?: unknown;
};

export function useRealtimeSync(
  boardId: string,
  fabricRef: React.MutableRefObject<fabric.Canvas | null>,
  objectsMapRef: React.MutableRefObject<Map<string, fabric.Object>>,
  ready: boolean
) {
  const isRemoteApplying = useRef(false); // feedback
  const syncReady = useRef(false);
  const pendingAdds = useRef<fabric.Object[]>([]);

  // factor actual write so we can flush queued items
  const addNow = async (obj: fabric.Object) => { // serializes fabric objects to a JSON
    const db: Firestore | null = firestore;
    if (!db) return;

    const colRef = collection(db, "boards", boardId, "objects");

    const payload = (obj as any).toObject
      ? (obj as any).toObject([
          "type","left","top","width","height","scaleX","scaleY","angle",
          "rx","ry","strokeUniform","fill","stroke","strokeWidth","path","src"
        ])
      : {};

    const ref = doc(colRef);             // client-generated id
    const id = ref.id;

    (obj as any).__remoteId = ref.id;
    objectsMapRef.current.set(ref.id, obj);

    await setDoc(ref, {
      json: JSON.stringify(payload),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  useEffect(() => {
    const db: Firestore | null = firestore;
    const canvas = fabricRef.current;
    if (!db || !ready || !canvas || !boardId) return;

    const colRef = collection(db, "boards", boardId, "objects");
    const qy = query(colRef, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const c = fabricRef.current;
        if (!c) return;

        isRemoteApplying.current = true; // feedback

        // 1) Hydrate everything we don't have yet
        snap.docs.forEach((docSnap) => {
          const id = docSnap.id;
          if (objectsMapRef.current.has(id)) return;

          const data = docSnap.data() as RemoteDoc;
          let parsed: any;
          try {
            parsed = JSON.parse(data.json);
          } catch {
            console.error("[sync] Bad JSON for", id);
            return;
          }

          (fabric as any).util.enlivenObjects([parsed], (enlivened: fabric.Object[]) => {
            enlivened.forEach((obj) => {
              (obj as any).__remoteId = id;
              (obj as any).perPixelTargetFind = true;
              obj.selectable = true;
              obj.setCoords?.();
              c.add(obj);
              objectsMapRef.current.set(id, obj);
            });
            c.requestRenderAll();
          });
        });

        // 2) Apply live adds/removes
        snap.docChanges().forEach((chg) => { // live changes
          const id = chg.doc.id;

          if (chg.type === "added") {
            // if hydrate above already handled it, skip
            if (objectsMapRef.current.has(id)) return;

            const data = chg.doc.data() as RemoteDoc;
            let parsed: any;
            try {
              parsed = JSON.parse(data.json);
            } catch {
              console.error("[sync] Bad JSON (added) for", id);
              return;
            }

            (fabric as any).util.enlivenObjects([parsed], (enlivened: fabric.Object[]) => {
              enlivened.forEach((obj) => {
                (obj as any).__remoteId = id;
                (obj as any).perPixelTargetFind = true;
                obj.selectable = true;
                obj.setCoords?.();
                c.add(obj);
                objectsMapRef.current.set(id, obj);
              });
              c.requestRenderAll();
            });
          } else if (chg.type === "removed") {
            const existing = objectsMapRef.current.get(id);
            if (existing) {
              c.remove(existing);
              objectsMapRef.current.delete(id);
              c.requestRenderAll();
            }
          }

          else if (chg.type === "modified") {
            const c = fabricRef.current;
            if (!c) return;
          
            const id = chg.doc.id;
            const existing = objectsMapRef.current.get(id);
            const data = chg.doc.data() as RemoteDoc;
          
            let parsed: any;
            try {
              parsed = JSON.parse(data.json);
            } catch {
              console.error("[sync] Bad JSON (modified) for", id);
              return;
            }
          
            // We are about to apply a remote change → suppress local listeners
            isRemoteApplying.current = true;
          
            // Replace the object (simplest + robust across types)
            if (existing) {
              c.remove(existing);
              objectsMapRef.current.delete(id);
            }
          
            // Special-case images for reliability
            if (parsed.type === "image" && parsed.src) {
              fabric.Image.fromURL(
                parsed.src,
                (img) => {
                  img.set({ ...parsed });
                  (img as any).__remoteId = id;
                  (img as any).perPixelTargetFind = true;
                  img.selectable = true;
                  img.setCoords?.();
                  c.add(img);
                  objectsMapRef.current.set(id, img);
                  c.requestRenderAll();
                  isRemoteApplying.current = false;
                },
                { crossOrigin: "anonymous" }
              );
            } else {
              // Other shapes/paths via enliven
              (fabric as any).util.enlivenObjects([parsed], (enlivened: fabric.Object[]) => {
                const obj = enlivened[0];
                if (!obj) { isRemoteApplying.current = false; return; }
                (obj as any).__remoteId = id;
                (obj as any).perPixelTargetFind = true;
                obj.selectable = true;
                obj.setCoords?.();
                c.add(obj);
                objectsMapRef.current.set(id, obj);
                c.requestRenderAll();
                isRemoteApplying.current = false;
              });
            }
          }
        });

        isRemoteApplying.current = false;

        // Mark ready after first snapshot and flush queued local adds
        if (!syncReady.current) {
          syncReady.current = true;
          if (pendingAdds.current.length) {
            const toFlush = pendingAdds.current.slice();
            pendingAdds.current = [];
            toFlush.forEach((o) => { void addNow(o); });
          }
        }
      },
      (err) => console.error("[sync] onSnapshot error", err)
    );

    return () => {
      syncReady.current = false;          // reset on board/canvas change
      pendingAdds.current = [];
      unsub();
    };
  }, [boardId, ready, fabricRef, objectsMapRef]);

  // Local -> Firestore (ADD) with queue before ready
  const maybeSyncAdd = async (obj: fabric.Object) => { // queue objects
    const db: Firestore | null = firestore;
    if (!db) return;

    if (isRemoteApplying.current || !syncReady.current) {
      pendingAdds.current.push(obj);
      return;
    }
    await addNow(obj);
  };

  // Local -> Firestore (DELETE)
  const removeRemote = async (obj: fabric.Object) => { // removes from map ref.
    const db: Firestore | null = firestore;
    if (!db) return;
    const id = (obj as any).__remoteId as string | undefined;
    if (!id) return;
    try {
      await deleteDoc(doc(db, "boards", boardId, "objects", id));
      objectsMapRef.current.delete(id);
    } catch (e) {
      console.error("[sync] Failed to delete remote object", e);
    }
  };

  return { maybeSyncAdd, removeRemote, isRemoteApplying, syncReady }; // returned API
}

