import mongoose from "mongoose";

const storySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["text", "image"], default: "text" },
    content: { type: String, maxLength: 100 },
    url: { type: String },
    gradient: { type: [String], default: [] },
    viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  {
    timestamps: true
  }
);

// Auto-delete story after 24 hours (86400 seconds)
storySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

storySchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    return ret;
  }
});

const Story = mongoose.model("Story", storySchema);
export default Story;
