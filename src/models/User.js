import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    phone: {
      type: String,
      unique: true,
      sparse: true
    },

    password: {
      type: String,
      required: true
    },

    avatar: {
      type: String
    },

    twoFactorEnabled: {
      type: Boolean,
      default: false
    },

    isOnline: {
      type: Boolean,
      default: false
    },

    lastSeen: {
      type: Date
    },
    deviceToken: {
  type: String,
  default: null
},
  bio: {
  type: String,
  default: ""
},

profilePic: {
  type: String,
  default: ""
},

lastSeen: {
  type: Date,
  default: Date.now
},

privacy: {
  lastSeen: {
    type: String,
    enum: ["everyone", "contacts", "nobody"],
    default: "everyone"
  },
  profilePhoto: {
    type: String,
    enum: ["everyone", "contacts", "nobody"],
    default: "everyone"
  }
},

  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
