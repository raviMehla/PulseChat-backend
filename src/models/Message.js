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
      enum: ["text", "image", "video", "file", "system"],
      default: "text"
    },
    isDeleted: {
      type: Boolean,
      default: false
    },

    fileUrl: {
      type: String,
      default: null
    },

    fileName: {
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

const Message = mongoose.model("Message", messageSchema);

export default Message;