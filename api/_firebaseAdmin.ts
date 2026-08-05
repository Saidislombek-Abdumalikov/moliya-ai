import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let adminApp: any;

try {
  if (getApps().length === 0) {
    adminApp = initializeApp({
      projectId: "arctic-pad-sn56p"
    });
  } else {
    adminApp = getApps()[0];
  }
} catch (error) {
  console.error("Error initializing Firebase Admin SDK:", error);
}

export const adminDb = getFirestore(adminApp, "ai-studio-moliyav2-593a4147-5cc2-4aec-9b0e-422088ddb24a");

try {
  adminDb.settings({
    ignoreUndefinedProperties: true
  });
} catch {
  // Settings already initialized
}
