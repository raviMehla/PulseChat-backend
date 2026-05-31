import crypto from "crypto";
import {
  deriveFromPassword as webDeriveFromPassword,
  generateECDHKeyPair as webGenerateECDHKeyPair,
  exportPublicKey as webExportPublicKey,
  encryptPrivateKeyForBackup as webEncryptPrivateKeyForBackup,
  decryptPrivateKeyFromBackup as webDecryptPrivateKeyFromBackup,
  deriveMessageKey as webDeriveMessageKey,
  encryptMessage as webEncryptMessage,
  decryptMessage as webDecryptMessage,
  encryptECIES as webEncryptECIES,
  decryptECIES as webDecryptECIES
} from "../../frontend/src/services/crypto.js";

// Helper: Convert ArrayBuffer/Buffer to hex
function bufToHex(buffer) {
  return Buffer.from(buffer).toString("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE CRYPTO IMPLEMENTATIONS (Simulating the Mobile App)
// ─────────────────────────────────────────────────────────────────────────────

function nodeDeriveFromPassword(password, authSalt, keySalt) {
  const authSaltBuffer = Buffer.from(authSalt + "whatsapp-clone-auth-v1", "utf8");
  const keySaltBuffer = Buffer.from(keySalt + "whatsapp-clone-e2ee-v1", "utf8");

  const authToken = crypto.pbkdf2Sync(password, authSaltBuffer, 600000, 32, "sha256").toString("hex");
  const kek = crypto.pbkdf2Sync(password, keySaltBuffer, 600000, 32, "sha256");

  return { authToken, kek };
}

function nodeEncryptPrivateKeyForBackup(privateKeyDer, kek) {
  // privateKeyDer is a Buffer representing the PKCS8 DER private key
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  
  const encrypted = Buffer.concat([cipher.update(privateKeyDer), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Web AES-GCM appends the 16-byte auth tag at the end of the ciphertext
  const ciphertextWithTag = Buffer.concat([encrypted, tag]);

  return {
    encryptedPrivateKey: ciphertextWithTag.toString("hex"),
    keyIv: iv.toString("hex")
  };
}

function nodeDecryptPrivateKeyFromBackup(encryptedHex, kek, ivHex) {
  const iv = Buffer.from(ivHex, "hex");
  const encryptedWithTag = Buffer.from(encryptedHex, "hex");

  // Extract auth tag (last 16 bytes) and ciphertext
  const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16);
  const ciphertext = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted; // Returns PKCS8 DER private key
}

function nodeDeriveMessageKey(nodePrivateKeyDer, webPublicKeyHex) {
  // Import the PKCS8 private key
  const privateKey = crypto.createPrivateKey({
    key: nodePrivateKeyDer,
    format: "der",
    type: "pkcs8"
  });

  // Import the public key (starts with 04, raw uncompressed SEC1 format) via JWK
  const pubKeyBuffer = Buffer.from(webPublicKeyHex, "hex");
  const x = pubKeyBuffer.subarray(1, 33).toString("base64url");
  const y = pubKeyBuffer.subarray(33, 65).toString("base64url");

  const publicKey = crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x,
      y
    },
    format: "jwk"
  });

  // Perform ECDH shared agreement
  const sharedBits = crypto.diffieHellman({ privateKey, publicKey });

  // Derivation via HKDF-SHA256 (matching web)
  return crypto.hkdfSync(
    "sha256",
    sharedBits,
    new Uint8Array(32), // static salt
    Buffer.from("whatsapp-clone-msg-v1", "utf8"),
    32
  );
}

function nodeEncryptMessage(plaintext, aesKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("hex"),
    iv: iv.toString("hex")
  };
}

function nodeDecryptMessage(ciphertextHex, aesKey, ivHex) {
  const iv = Buffer.from(ivHex, "hex");
  const encryptedWithTag = Buffer.from(ciphertextHex, "hex");

  const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16);
  const ciphertext = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function nodeEncryptECIES(plaintext, recipientPublicKeyHex) {
  // Generate ephemeral EC keypair
  const ecdh = crypto.createECDH("prime256v1");
  const ephemeralPubKey = ecdh.generateKeys(); // raw public key

  const recipientPubKey = Buffer.from(recipientPublicKeyHex, "hex");
  const sharedBits = ecdh.computeSecret(recipientPubKey);

  const aesKey = crypto.hkdfSync(
    "sha256",
    sharedBits,
    new Uint8Array(32),
    Buffer.from("whatsapp-clone-ecies-v1", "utf8"),
    32
  );

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("hex"),
    iv: iv.toString("hex"),
    ephemeralPublicKey: ephemeralPubKey.toString("hex")
  };
}

function nodeDecryptECIES(ciphertextHex, nodePrivateKeyDer, ivHex, ephemeralPublicKeyHex) {
  const privateKey = crypto.createPrivateKey({
    key: nodePrivateKeyDer,
    format: "der",
    type: "pkcs8"
  });

  const pubKeyBuffer = Buffer.from(ephemeralPublicKeyHex, "hex");
  const x = pubKeyBuffer.subarray(1, 33).toString("base64url");
  const y = pubKeyBuffer.subarray(33, 65).toString("base64url");

  const publicKey = crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x,
      y
    },
    format: "jwk"
  });

  const sharedBits = crypto.diffieHellman({ privateKey, publicKey });

  const aesKey = crypto.hkdfSync(
    "sha256",
    sharedBits,
    new Uint8Array(32),
    Buffer.from("whatsapp-clone-ecies-v1", "utf8"),
    32
  );

  const iv = Buffer.from(ivHex, "hex");
  const encryptedWithTag = Buffer.from(ciphertextHex, "hex");

  const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16);
  const ciphertext = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log("=== Running Web-to-Node Interoperability Crypto Tests ===");

  const password = "Password123!";
  const authSalt = "auth_salt_test";
  const keySalt = "key_salt_test";

  // 1. Password Derivation Compatibility
  const webDer = await webDeriveFromPassword(password, authSalt, keySalt);
  const nodeDer = nodeDeriveFromPassword(password, authSalt, keySalt);

  console.log("Web AuthToken:", webDer.authToken);
  console.log("Node AuthToken:", nodeDer.authToken);
  if (webDer.authToken !== nodeDer.authToken) {
    throw new Error("FAIL: Auth Tokens do not match!");
  }
  console.log("PASS: Password key derivation matches!\n");

  // 2. Private Key Backup / Restore Compatibility
  // Let's generate a keypair using Web Crypto
  const webKeyPair = await webGenerateECDHKeyPair();
  const webPubKeyHex = await webExportPublicKey(webKeyPair.publicKey);
  
  // Export private key from Web and encrypt it using Node KEK
  const webPrivateKeyDer = await crypto.subtle.exportKey("pkcs8", webKeyPair.privateKey);
  const nodeEncrypted = nodeEncryptPrivateKeyForBackup(Buffer.from(webPrivateKeyDer), nodeDer.kek);

  // Decrypt it using Web
  const webRestored = await webDecryptPrivateKeyFromBackup(
    nodeEncrypted.encryptedPrivateKey,
    webDer.kek,
    nodeEncrypted.keyIv
  );
  console.log("PASS: Node encrypted private key was decrypted by Web!");

  // Encrypt it using Web
  const webEncrypted = await webEncryptPrivateKeyForBackup(webKeyPair.privateKey, webDer.kek);
  
  // Decrypt it using Node
  const nodeRestoredDer = nodeDecryptPrivateKeyFromBackup(
    webEncrypted.encryptedPrivateKey,
    nodeDer.kek,
    webEncrypted.keyIv
  );
  
  if (Buffer.compare(Buffer.from(webPrivateKeyDer), nodeRestoredDer) !== 0) {
    throw new Error("FAIL: Decrypted private key DERs do not match!");
  }
  console.log("PASS: Web encrypted private key was decrypted by Node!\n");

  // 3. Message Exchange Compatibility
  const bobWebKeyPair = await webGenerateECDHKeyPair();
  const bobPubKeyHex = await webExportPublicKey(bobWebKeyPair.publicKey);

  // Node (Alice) derives message key and encrypts message for Bob
  const aliceNodeMsgKey = nodeDeriveMessageKey(nodeRestoredDer, bobPubKeyHex);
  const message = "Hello Bob! This is Alice from the Mobile app.";
  const nodeEncMsg = nodeEncryptMessage(message, aliceNodeMsgKey);

  // Bob (Web) derives message key and decrypts
  const bobWebMsgKey = await webDeriveMessageKey(bobWebKeyPair.privateKey, webPubKeyHex);
  const decryptedByBob = await webDecryptMessage(nodeEncMsg.ciphertext, bobWebMsgKey, nodeEncMsg.iv);

  console.log("Decrypted by Bob:", decryptedByBob);
  if (decryptedByBob !== message) {
    throw new Error("FAIL: Bob (Web) could not decrypt message from Alice (Node)!");
  }
  console.log("PASS: Mobile-to-Web message encryption/decryption matches!\n");

  // Web (Bob) encrypts for Alice (Mobile)
  const bobReply = "Hi Alice! Web client decrypted your message successfully.";
  const webEncReply = await webEncryptMessage(bobReply, bobWebMsgKey);

  // Alice (Mobile) decrypts
  const decryptedByAlice = nodeDecryptMessage(webEncReply.ciphertext, aliceNodeMsgKey, webEncReply.iv);
  console.log("Decrypted by Alice:", decryptedByAlice);
  if (decryptedByAlice !== bobReply) {
    throw new Error("FAIL: Alice (Node) could not decrypt message from Bob (Web)!");
  }
  console.log("PASS: Web-to-Mobile message encryption/decryption matches!\n");

  // 4. ECIES (Group Key) Encryption / Decryption Compatibility
  const groupKey = "8f3a6120de84050d24c0e63ba7ea44e8bc1a3b5de78fbc38a901d8e5b40c21e6";
  
  // Alice (Node) encrypts group key for Bob (Web)
  const nodeEciesPayload = nodeEncryptECIES(groupKey, bobPubKeyHex);

  // Bob (Web) decrypts group key
  const bobDecryptedGroupKey = await webDecryptECIES(
    nodeEciesPayload.ciphertext,
    bobWebKeyPair.privateKey,
    nodeEciesPayload.iv,
    nodeEciesPayload.ephemeralPublicKey
  );

  console.log("Bob Decrypted Group Key:", bobDecryptedGroupKey);
  if (bobDecryptedGroupKey !== groupKey) {
    throw new Error("FAIL: Bob (Web) could not decrypt ECIES payload from Alice (Node)!");
  }
  console.log("PASS: Mobile-to-Web ECIES matches!\n");

  // Bob (Web) encrypts group key for Alice (Node)
  const webEciesPayload = await webEncryptECIES(groupKey, webPubKeyHex);

  // Alice (Node) decrypts group key
  const aliceDecryptedGroupKey = nodeDecryptECIES(
    webEciesPayload.ciphertext,
    nodeRestoredDer,
    webEciesPayload.iv,
    webEciesPayload.ephemeralPublicKey
  );

  console.log("Alice Decrypted Group Key:", aliceDecryptedGroupKey);
  if (aliceDecryptedGroupKey !== groupKey) {
    throw new Error("FAIL: Alice (Node) could not decrypt ECIES payload from Bob (Web)!");
  }
  console.log("PASS: Web-to-Mobile ECIES matches!\n");

  console.log("🎉 ALL INTEROPERABILITY TESTS PASSED! CRITICAL CRYPTO CORE COMPATIBILITY VERIFIED.");
}

run().catch(console.error);
