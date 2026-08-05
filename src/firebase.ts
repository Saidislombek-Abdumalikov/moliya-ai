import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyD0pzvcVsr_Fh3DxUQLhyKtoUejYtSRRCs",
  authDomain: "arctic-pad-sn56p.firebaseapp.com",
  projectId: "arctic-pad-sn56p",
  storageBucket: "arctic-pad-sn56p.firebasestorage.app",
  messagingSenderId: "708290879984",
  appId: "1:708290879984:web:f711a89c8728f6a9897d35"
};

const app = initializeApp(firebaseConfig);

// Initialize Firestore with the custom database ID
export const db = getFirestore(app, "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a");
export const auth = getAuth(app);
