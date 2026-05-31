import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import {
  publishStory,
  getStories,
  viewStory,
  deleteMyStories
} from "../controllers/story.controller.js";

const router = express.Router();

// Enforce auth for all routes in this file
router.use(protect);

router.post("/", upload.single("image"), publishStory);
router.get("/", getStories);
router.put("/view/:storyId", viewStory);
router.delete("/", deleteMyStories);

export default router;
