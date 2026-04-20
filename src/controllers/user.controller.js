

export const saveDeviceToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Token required" });
    }

    await User.findByIdAndUpdate(req.user._id, {
      deviceToken: token
    });

    res.status(200).json({
      message: "Device token saved"
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, bio } = req.body;

    const user = await User.findById(req.user._id);

    if (name) user.name = name;
    if (bio) user.bio = bio;

    await user.save();

    res.status(200).json({
      message: "Profile updated",
      user
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProfilePic = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (req.file) {
      user.profilePic = req.file.path;
    }

    await user.save();

    res.status(200).json({
      message: "Profile picture updated",
      profilePic: user.profilePic
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updatePrivacy = async (req, res) => {
  try {
    const { lastSeen, profilePhoto } = req.body;

    const user = await User.findById(req.user._id);

    if (lastSeen) user.privacy.lastSeen = lastSeen;
    if (profilePhoto) user.privacy.profilePhoto = profilePhoto;

    await user.save();

    res.status(200).json({
      message: "Privacy updated",
      privacy: user.privacy
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");

    res.status(200).json(user);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};