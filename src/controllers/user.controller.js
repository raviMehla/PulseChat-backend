export const getProfile = async (req, res) => {
  res.status(200).json({
    user: req.user
  });
};

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
