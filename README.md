# Collaborative Whiteboard (React + TypeScript + Vite)

A lightweight, real-time collaborative whiteboard built with **React**, **TypeScript**, **Fabric.js**, and **Firebase (Firestore)**.  
Draw with a pen, lines, rectangles, and ellipses; erase, undo/redo, import images, and **share a board via URL** for live multi-tab/multi-user sync. Export your board to PNG.

## ------ Features ------

- **Drawing tools**: Pen (freehand), Line, Rectangle, Ellipse  
- **Erase**: Click to remove objects; Delete/Backspace supported  
- **Undo / Redo**: Action-aware history (add/remove)  
- **Import images**: Upload from device (Data URL)  
- **Export PNG**: High-res export (`multiplier: 2`)  
- **Shareable boards**: `?board=<id>` routed, easy New/Copy-link  
- **Realtime sync** (Firestore): add/remove/transform (move/scale/rotate)  
- **Precise selection**: per-pixel hit testing for thin strokes  
- **Responsive sizing**: resizes with container/viewport

## ------ Tech Stack ------

- **React 18 + TypeScript + Vite**
- **Fabric.js** (`fabric@5`) for canvas drawing
- **Firebase** (Firestore) for realtime data
- Optional: Tailwind (if you decide to style via utilities)

## ------ Getting Started ------

### 1) Install

# from project root
npm install
# required libs
npm i fabric firebase uuid
# (recommended) types
npm i -D @types/fabric

### 2) Firebase Setup

Go to Firebase console → create a project.

Add a Web App → copy the config snippet (apiKey, authDomain, projectId, etc.).

Enable Firestore (Native mode).

Create .env.local at the project root:

VITE_FIREBASE_API_KEY=YOUR_API_KEY
VITE_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET=YOUR_PROJECT.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID
VITE_FIREBASE_APP_ID=YOUR_APP_ID

### 3) Firestore Security Rules

Dev-only (open): do not ship to production as-is.

// Firestore rules (Dev only)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /boards/{boardId}/objects/{objectId} {
      allow read, write: if true;
    }
  }
}

For production, restrict reads/writes to authenticated users and validate document shapes.

### 4) Run Locally
npm run dev

## --- Usage ---

- Tools: Select, Pen, Line, Rect, Ellipse, Erase

- Style: Change Stroke color/width, Fill or Transparent

- History: Undo/Redo buttons or Ctrl/Cmd + Z / Ctrl/Cmd + Y

- Erase: Click target or select an object and press Delete/Backspace

- Import Image: Toolbar → Import Image (adds Data URL image)

- Export: Toolbar → Export PNG

- Boards: Header → New Board (updates URL), Copy Share Link