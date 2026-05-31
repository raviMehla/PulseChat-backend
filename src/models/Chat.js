import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    isGroup: {
      type: Boolean,
      default: false
    },

    chatName: {
      type: String,
      trim: true
    },

    // 🛡️ ARCHITECTURAL UPGRADE: Support for Group Details
    description: {
      type: String,
      default: "",
      maxLength: [250, "Description cannot exceed 250 characters"]
    },
    
    groupAvatar: {
      type: String,
      default: ""
    },

    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],

    groupAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message"
    },
    
    lastMessageAt: {
      type: Date
    },
    
    unreadCount: {
      type: Map,
      of: Number,
      default: {}
    },
    
    // 🟢 Phase 2: Group Invites
    pendingMembers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],

    // 🛡️ SOFT DELETION: Users who have "deleted" this chat from their view.
    // Instead of hard-deleting chats globally, we hide them per user.
    // When a new message arrives, the sender can pull their ID from this array.
    hiddenFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }],

    // 🔒 E2EE Group Key Management
    encryptedGroupKeys: [{
      userId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      encryptedKey: { type: String, required: true },   // GroupKey encrypted with ECDH shared secret
      iv:           { type: String, required: true },
      keyVersion:   { type: Number, default: 1 }        // Rotation index
    }],
    groupKeyVersion: { type: Number, default: 1 }       // Incremented on member removal
  },
  { timestamps: true }
);

const Chat = mongoose.model("Chat", chatSchema);

export default Chat;