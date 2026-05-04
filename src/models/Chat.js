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
  },
  { timestamps: true }
);

const Chat = mongoose.model("Chat", chatSchema);

export default Chat;