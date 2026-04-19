import admin from "firebase-admin";

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is missing in .env");
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


//console.log("ENV CHECK:", process.env.FIREBASE_SERVICE_ACCOUNT);
console.log("Firebase initialized");


export default admin;