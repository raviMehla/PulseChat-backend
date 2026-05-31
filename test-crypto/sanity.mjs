// sanity.mjs — ESM script to test the E2EE crypto module in Node.js

import {
  deriveFromPassword,
  generateECDHKeyPair,
  exportPublicKey,
  importPublicKey,
  encryptPrivateKeyForBackup,
  decryptPrivateKeyFromBackup,
  deriveMessageKey,
  encryptMessage,
  decryptMessage,
  bufToHex,
  encryptECIES,
  decryptECIES
} from "../../frontend/src/services/crypto.js"; // Relative path from backend/test-crypto

async function runTests() {
  console.log("🚀 Starting E2EE Cryptographic Sanity Tests...\n");

  try {
    // ----------------------------------------------------
    // Test Case 1: Password-Based Key Derivation (PBKDF2)
    // ----------------------------------------------------
    console.log("Test Case 1: Deriving KEK and AuthToken...");
    const password = "SuperSecretPassword123!";
    const authSalt = "authsalt12345678";
    const keySalt = "keysalt12345678";

    const { authToken, kek } = await deriveFromPassword(password, authSalt, keySalt);
    console.log("✅ Derived Auth Token:", authToken);
    console.log("✅ Derived KEK (AES Key Object):", kek.type, kek.algorithm);
    
    // AuthToken must be a 64-character hex string
    if (authToken.length !== 64) {
      throw new Error(`AuthToken must be 64 characters, got ${authToken.length}`);
    }
    console.log("----------------------------------------------------\n");

    // ----------------------------------------------------
    // Test Case 2: Asymmetric Key Generation (ECDH P-256)
    // ----------------------------------------------------
    console.log("Test Case 2: Generating ECDH P-256 Keypairs for Alice & Bob...");
    const aliceKeys = await generateECDHKeyPair();
    const bobKeys = await generateECDHKeyPair();
    
    console.log("✅ Alice Keys generated:", aliceKeys.publicKey.algorithm, aliceKeys.privateKey.algorithm);
    console.log("✅ Bob Keys generated:", bobKeys.publicKey.algorithm, bobKeys.privateKey.algorithm);

    const alicePublicKeyHex = await exportPublicKey(aliceKeys.publicKey);
    const bobPublicKeyHex = await exportPublicKey(bobKeys.publicKey);

    console.log("✅ Alice Public Key Hex:", alicePublicKeyHex);
    console.log("✅ Bob Public Key Hex:", bobPublicKeyHex);
    console.log("----------------------------------------------------\n");

    // ----------------------------------------------------
    // Test Case 3: Private Key Backup & Restore (Vault)
    // ----------------------------------------------------
    console.log("Test Case 3: Encrypting & Decrypting Private Key for Backup...");
    const { encryptedPrivateKey, keyIv } = await encryptPrivateKeyForBackup(aliceKeys.privateKey, kek);
    console.log("✅ Encrypted Private Key Hex:", encryptedPrivateKey);
    console.log("✅ Key IV Hex:", keyIv);

    const restoredPrivateKey = await decryptPrivateKeyFromBackup(encryptedPrivateKey, kek, keyIv);
    console.log("✅ Private Key successfully restored from backup!");

    // Verify key remains valid by exporting public key from it or using it
    if (restoredPrivateKey.type !== "private" || restoredPrivateKey.algorithm.name !== "ECDH") {
      throw new Error("Restored key is not a valid ECDH Private Key");
    }
    console.log("----------------------------------------------------\n");

    // ----------------------------------------------------
    // Test Case 4: Key Agreement (ECDH)
    // ----------------------------------------------------
    console.log("Test Case 4: Deriving Shared Symmetric Message Keys...");
    // Alice derives using her private key and Bob's public key
    const aliceDerivedKey = await deriveMessageKey(aliceKeys.privateKey, bobPublicKeyHex);
    
    // Bob derives using his private key and Alice's public key
    const bobDerivedKey = await deriveMessageKey(bobKeys.privateKey, alicePublicKeyHex);

    console.log("✅ Alice derived message key.");
    console.log("✅ Bob derived message key.");
    console.log("----------------------------------------------------\n");

    // ----------------------------------------------------
    // Test Case 5: Message Encryption & Decryption
    // ----------------------------------------------------
    console.log("Test Case 5: Encrypting and Decrypting Messages...");
    const secretMessage = "Meet me at the secret spot at 9 PM. Bring the keys!";
    console.log("📝 Plaintext Message:", secretMessage);

    // Alice encrypts with her derived key
    const { ciphertext, iv } = await encryptMessage(secretMessage, aliceDerivedKey);
    console.log("🔒 Ciphertext Hex:", ciphertext);
    console.log("🔒 IV Hex:", iv);

    // Bob decrypts with his derived key
    const decryptedMessage = await decryptMessage(ciphertext, bobDerivedKey, iv);
    console.log("🔓 Decrypted Message:", decryptedMessage);

    if (decryptedMessage !== secretMessage) {
      throw new Error(`Decrypted message does not match plaintext! Expected: "${secretMessage}", Got: "${decryptedMessage}"`);
    }
    console.log("----------------------------------------------------\n");

    // ----------------------------------------------------
    // Test Case 6: ECIES Encryption & Decryption (Group Keys)
    // ----------------------------------------------------
    console.log("Test Case 6: ECIES Encryption and Decryption for Group Keys...");
    const groupKey = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    console.log("📝 Plaintext Group Key:", groupKey);

    // Alice encrypts for Bob
    const eciesPayload = await encryptECIES(groupKey, bobPublicKeyHex);
    console.log("🔒 ECIES Ciphertext Hex:", eciesPayload.ciphertext);
    console.log("🔒 ECIES IV Hex:", eciesPayload.iv);
    console.log("🔒 ECIES Ephemeral Public Key Hex:", eciesPayload.ephemeralPublicKey);

    // Bob decrypts
    const decryptedGroupKey = await decryptECIES(
      eciesPayload.ciphertext,
      bobKeys.privateKey,
      eciesPayload.iv,
      eciesPayload.ephemeralPublicKey
    );
    console.log("🔓 Decrypted Group Key:", decryptedGroupKey);

    if (decryptedGroupKey !== groupKey) {
      throw new Error(`Decrypted group key does not match! Expected: "${groupKey}", Got: "${decryptedGroupKey}"`);
    }

    console.log("\n🎉 ALL CRYPTOGRAPHIC TESTS PASSED SUCCESSFULLY! E2EE PROTOCOL IS SOUND.");

  } catch (error) {
    console.error("\n❌ CRYPTOGRAPHIC TEST FAILURE:", error);
    process.exit(1);
  }
}

runTests();
