import Story from "../models/Story.js";
import cloudinary from "../config/cloudinary.js";
import streamifier from "streamifier";

// Helper to extract Cloudinary public ID from URL
const getPublicIdFromUrl = (url) => {
  try {
    const parts = url.split("/upload/");
    if (parts.length < 2) return null;
    let path = parts[1];
    const versionMatch = path.match(/^v\d+\/(.+)$/);
    if (versionMatch) {
      path = versionMatch[1];
    }
    const dotIndex = path.lastIndexOf(".");
    if (dotIndex !== -1) {
      path = path.substring(0, dotIndex);
    }
    return path;
  } catch (error) {
    console.error("Failed to parse public_id from URL:", url, error);
    return null;
  }
};

// CLOUDINARY UPLOAD HELPER (Buffer → Cloud URL)
const uploadBufferToCloudinary = (buffer, folder = "pulsechat/status") =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", folder },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

// 1. Publish a status update (text or image)
export const publishStory = async (req, res) => {
  try {
    const { type, content, gradient } = req.body;
    let url = null;

    if (type === "image") {
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }
      const result = await uploadBufferToCloudinary(req.file.buffer);
      url = result.secure_url;
    }

    const story = await Story.create({
      user: req.user._id,
      type: type || "text",
      content: type === "image" ? null : content,
      url,
      gradient: type === "image" ? [] : (Array.isArray(gradient) ? gradient : [gradient]),
      viewedBy: [req.user._id] // creator automatically views own story
    });

    // Populate user details for returning
    const populated = await Story.findById(story._id).populate("user", "name username profilePic");

    res.status(201).json(populated);
  } catch (error) {
    console.error("Publish Story Error:", error);
    res.status(500).json({ message: "Failed to publish status update", error: error.message });
  }
};

// 2. Get all active stories grouped by user
export const getStories = async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stories = await Story.find({ createdAt: { $gte: twentyFourHoursAgo } })
      .populate("user", "name username profilePic")
      .sort({ createdAt: -1 });

    const mine = {
      user: {
        _id: req.user._id,
        name: req.user.name,
        username: req.user.username,
        profilePic: req.user.profilePic
      },
      stories: []
    };

    const othersMap = {};

    stories.forEach(story => {
      if (!story.user) return;
      if (String(story.user._id) === String(req.user._id)) {
        mine.stories.push(story);
      } else {
        const userId = story.user._id;
        if (!othersMap[userId]) {
          othersMap[userId] = {
            _id: userId,
            user: story.user,
            stories: [],
            viewed: true
          };
        }
        othersMap[userId].stories.push(story);
        
        // Check if current user has viewed this story
        const hasViewed = story.viewedBy.some(id => String(id) === String(req.user._id));
        if (!hasViewed) {
          othersMap[userId].viewed = false;
        }
      }
    });

    // Sort stories chronologically (oldest first) inside groups for sequential viewer play
    mine.stories.reverse();

    const others = Object.values(othersMap).map(item => {
      item.stories.reverse();
      return item;
    });

    res.json({
      mine: mine.stories.length > 0 ? mine : null,
      others
    });
  } catch (error) {
    console.error("Get Stories Error:", error);
    res.status(500).json({ message: "Failed to retrieve status updates", error: error.message });
  }
};

// 3. Mark a specific story as viewed
export const viewStory = async (req, res) => {
  try {
    const { storyId } = req.params;
    const story = await Story.findByIdAndUpdate(
      storyId,
      { $addToSet: { viewedBy: req.user._id } },
      { new: true }
    );
    
    if (!story) {
      return res.status(404).json({ message: "Story not found" });
    }

    res.json({ message: "Story marked as viewed", story });
  } catch (error) {
    console.error("View Story Error:", error);
    res.status(500).json({ message: "Failed to mark story as viewed", error: error.message });
  }
};

// 4. Delete all stories of the current user
export const deleteMyStories = async (req, res) => {
  try {
    const stories = await Story.find({ user: req.user._id, type: "image" });
    for (const story of stories) {
      if (story.url) {
        const publicId = getPublicIdFromUrl(story.url);
        if (publicId) {
          cloudinary.uploader.destroy(publicId)
            .catch(err => console.error("Failed to delete status image from Cloudinary:", err));
        }
      }
    }
    await Story.deleteMany({ user: req.user._id });
    res.json({ message: "All your status updates have been deleted" });
  } catch (error) {
    console.error("Delete Stories Error:", error);
    res.status(500).json({ message: "Failed to delete status updates", error: error.message });
  }
};
