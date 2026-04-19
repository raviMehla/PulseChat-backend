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
}
  },
  { timestamps: true }
);

const Chat = mongoose.model("Chat", chatSchema);

export default Chat;
