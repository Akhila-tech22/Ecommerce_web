const Coupon = require("../models/couponSchema")
const User = require("../models/userSchema")

const loadCoupons = async (req, res) => {
  try {
    const userId = req.session.user;
    const userData = await User.findById(userId);

    // Get current date
    const currentDate = new Date();

    // Fetch non-expired, listed coupons that haven't been used by this user
    const coupons = await Coupon.find({
      expireOn: { $gt: currentDate },
      isList: true,
      userId: { $ne: userId } // Exclude coupons already used by this user
    }).sort({ createdOn: -1 }); // Sort by createdOn in descending order

    // Since we've already filtered out used coupons, all remaining ones are available
    const couponsWithStatus = coupons.map(coupon => {
      return {
        ...coupon.toObject(),
        isUsed: false,
        usageMessage: "Available to use"
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
