import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";


const firebaseConfig = {
apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};


let app: FirebaseApp | null = null;
let db: Firestore | null = null;


try {
if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId) {
app = initializeApp(firebaseConfig);
db = getFirestore(app);
}
} catch (e) {
console.warn("Firebase initialization failed; running offline.", e);
}


export const firestore = db;
export const isConnected = !!db;

console.log("FB init:", {
    hasApiKey: !!firebaseConfig.apiKey,
    projectId: firebaseConfig.projectId,
    connected: !!db,
  });