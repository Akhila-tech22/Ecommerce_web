const Coupon = require("../models/couponSchema")
const User = require("../models/userSchema")

const loadCoupons = async (req, res) => {
  try {
    const userId = req.session.user;
    const userData = await User.findById(userId);

    // Get current date
    const currentDate = new Date();

    // Fetch non-expired, listed coupons, sorted by createdOn (newest first)
    const coupons = await Coupon.find({
      expireOn: { $gt: currentDate },
      isList: true,
    }).sort({ createdOn: -1 }); // Sort by createdOn in descending order

    // Enhance coupons with usage status
    const couponsWithStatus = coupons.map(coupon => {
      const isUsed = coupon.userId.includes(userId);
      return {
        ...coupon.toObject(), // Convert Mongoose document to plain object
        isUsed: isUsed,
        usageMessage: isUsed ? "Already used, can't use this coupon" : "Available to use"
      };
    });

    res.render("my-coupons", {
      coupons: couponsWithStatus,
      user: userData,
    });
  } catch (error) {
    console.error("Error in loadCoupons:", error);
    res.redirect("/pageerror");
  }
};

module.exports = {
  loadCoupons,
}
