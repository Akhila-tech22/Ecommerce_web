const Coupon = require("../models/couponSchema");
const mongoose = require("mongoose");

const loadCoupon = async (req, res) => {
    try {
        const findCoupons = await Coupon.find({}).sort({ createdOn: -1 });
        return res.render("coupon", { 
            coupons: findCoupons,
            error: null,
            message: null
        });
    } catch (error) {
        console.error("Error loading coupons:", error);
        return res.redirect("/pageerror");
    }
};

const createCoupon = async (req, res) => {
    try {
        const { couponName, startDate, endDate, offerPrice, minimumPrice } = req.body;

        // First check if coupon already exists
        const existingCoupon = await Coupon.findOne({ name: couponName });
        if (existingCoupon) {
            const findCoupons = await Coupon.find({}).sort({ createdOn: -1 });
            return res.render("coupon", {
                coupons: findCoupons,
                error: "Coupon with this name already exists",
                message: null
            });
        }

        // Validate dates
        const startDateObj = new Date(startDate + "T00:00:00");
        const endDateObj = new Date(endDate + "T00:00:00");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (startDateObj < today) {
            const findCoupons = await Coupon.find({}).sort({ createdOn: -1 });
            return res.render("coupon", {
                coupons: findCoupons,
                error: "Start date cannot be in the past",
                message: null
            });
        }

        if (endDateObj <= startDateObj) {
            const findCoupons = await Coupon.find({}).sort({ createdOn: -1 });
            return res.render("coupon", {
                coupons: findCoupons,
                error: "End date must be after start date",
                message: null
            });
        }

        // Validate prices
        const offerPriceNum = parseInt(offerPrice);
        const minimumPriceNum = parseInt(minimumPrice);

        if (isNaN(offerPriceNum) || isNaN(minimumPriceNum)) {
            const findCoupons = await Coupon.find({}).sort({ createdOn: -1 });
            return res.render("coupon", {
                coupons: findCoupons,
                error: "Please enter valid numbers for prices",
                message: null
            });
        }

        if (offerPriceNum >= minimumPriceNum) {
            const findCoupons = await Coupon.find({}).sort({ createdOn: -1 });
            return res.render("coupon", {
                coupons: findCoupons,
                error: "Offer price must be less than minimum price",
                message: null
            });
        }

        // Create new coupon
        const newCoupon = new Coupon({
            name: couponName,
            createdOn: startDateObj,
            expireOn: endDateObj,
            offerPrice: offerPriceNum,
            minimumPrice: minimumPriceNum,
            isList: true
        });

        await newCoupon.save();
        return res.redirect("/admin/coupon"); // Redirect to avoid form resubmission

    } catch (error) {
        console.error("Error creating coupon:", error);
        return res.redirect("/pageerror");
    }
};


const editCoupon = async (req, res) => {
    try {
        const id = req.query.id;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.redirect("/admin/coupon");
        }

        const findCoupon = await Coupon.findOne({ _id: id });
        if (!findCoupon) {
            return res.redirect("/admin/coupon");
        }

        res.render("edit-coupon", {
            findCoupon: findCoupon
        });

    } catch (error) {
        console.error("Error editing coupon:", error);
        return res.redirect("/pageerror");
    }
};


const updateCoupon = async (req, res) => {
    try {
        const couponId = req.query.couponId;
        if (!mongoose.Types.ObjectId.isValid(couponId)) {
            return res.status(400).json({ success: false, message: "Invalid coupon ID" });
        }

        const { couponName, startDate, endDate, offerPrice, minimumPrice } = req.body;

        // Validate input data
        if (!couponName || !startDate || !endDate || !offerPrice || !minimumPrice) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        // Validate dates
        const startDateObj = new Date(startDate + "T00:00:00");
        const endDateObj = new Date(endDate + "T00:00:00");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (startDateObj < today) {
            return res.status(400).json({ success: false, message: "Start date cannot be in the past" });
        }

        if (endDateObj <= startDateObj) {
            return res.status(400).json({ success: false, message: "End date must be after start date" });
        }

        // Validate prices
        const offerPriceNum = parseInt(offerPrice);
        const minimumPriceNum = parseInt(minimumPrice);

        if (isNaN(offerPriceNum)) {
            return res.status(400).json({ success: false, message: "Offer price must be a valid number" });
        }

        if (isNaN(minimumPriceNum)) {
            return res.status(400).json({ success: false, message: "Minimum price must be a valid number" });
        }

        if (offerPriceNum >= minimumPriceNum) {
            return res.status(400).json({ success: false, message: "Offer price must be less than minimum price" });
        }

        // Check if coupon name already exists (excluding current coupon)
        const existingCoupon = await Coupon.findOne({ 
            name: couponName,
            _id: { $ne: couponId }
        });

        if (existingCoupon) {
            return res.status(400).json({ success: false, message: "Coupon with this name already exists" });
        }

        // Update coupon
        const updatedCoupon = await Coupon.findByIdAndUpdate(
            couponId,
            {
                name: couponName,
                createdOn: startDateObj,
                expireOn: endDateObj,
                offerPrice: offerPriceNum,
                minimumPrice: minimumPriceNum
            },
            { new: true }
        );

        if (!updatedCoupon) {
            return res.status(404).json({ success: false, message: "Coupon not found" });
        }

        return res.status(200).json({ 
            success: true, 
            message: "Coupon updated successfully",
            coupon: updatedCoupon
        });

    } catch (error) {
        console.error("Error updating coupon:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

const deleteCoupon = async (req, res) => {
    try {
        const id = req.query.id;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid coupon ID" });
        }

        const deletedCoupon = await Coupon.findByIdAndDelete(id);
        if (!deletedCoupon) {
            return res.status(404).json({ success: false, message: "Coupon not found" });
        }

        return res.status(200).json({ 
            success: true, 
            message: "Coupon deleted successfully" 
        });

    } catch (error) {
        console.error("Error deleting coupon:", error);
        return res.status(500).json({ 
            success: false, 
            message: "Internal server error" 
        });
    }
};

module.exports = {
    loadCoupon,
    createCoupon,
    editCoupon,
    updateCoupon,
    deleteCoupon
};