// js/firebase-app.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Your Firebase configuration (replace with your actual config)
const firebaseConfig = {
  apiKey: "AIzaSyCaz1dkWvAsBmbs1V1HjrLxaaDAsqPU1Is",
  authDomain: "luh-ai-project.firebaseapp.com",
  databaseURL: "https://luh-ai-project-default-rtdb.firebaseio.com",
  projectId: "luh-ai-project",
  storageBucket: "luh-ai-project.appspot.com",
  messagingSenderId: "875618668754",
  appId: "1:875618668754:web:d131d31fb004a43b739d0b",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);

// Export Firebase services for use in other modules
export {
  auth,
  db,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  doc,
  getDoc,
  setDoc,
};
