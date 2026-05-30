import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return this.messageType !== "system";
      }
    },

    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true
    },

    // TEXT MESSAGE
    content: {
      type: String,
      trim: true
    },

    // MEDIA SUPPORT
    messageType: {
      type: String,
      enum: ["text", "image", "video", "audio", "voice", "file", "system"],
      default: "text"
    },
    isDeleted: {
      type: Boolean,
      default: false
    },

    // Forwarded message flag
    isForwarded: {
      type: Boolean,
      default: false
    },

    isPinned: {
      type: Boolean,
      default: false
    },

    isStarred: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],

    isEdited: {
      type: Boolean,
      default: false
    },

    editedAt: {
      type: Date,
      default: null
    },

    fileUrl: {
      type: String,
      default: null
    },

    fileName: {
      type: String,
      default: null
    },

    // Voice/audio message duration (e.g. "0:12" or "15" seconds)
    duration: {
      type: String,
      default: null
    },
      
    replyTo: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Message",
  default: null
},

    // READ / DELIVERY TRACKING
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],

    deliveredTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    reactions: [
  {
    emoji: {
      type: String,
      required: true
    },
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ]
  }
],
  },
  { timestamps: true }
);

// 🛡️ LEVEL 1 FIX: Compound Index for ultra-fast chat history queries
// This prevents MongoDB from doing a full-table scan (COLLSCAN) when loading a chat.
messageSchema.index({ chat: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;