const Coupon = require("../models/couponSchema")
const mongoose = require("mongoose")


const loadCoupon = async (req,res) => {
    try {

        const findCoupons = await Coupon.find({}).sort({createdOn:-1})
        

        return res.render("coupon",{coupons:findCoupons})

    } catch (error) {
        return res.redirect("/pageerror")
        
    }
}

const createCoupon = async (req,res) => {
    try {
        
        
    const data = {
        couponName:req.body.couponName,
        startDate: new Date(req.body.startDate + "T00:00:00"),
        endDate: new Date(req.body.endDate + "T00:00:00"),
        offerPrice: parseInt(req.body.offerPrice),
        minimumPrice: parseInt(req.body.minimumPrice),
    }

    const newCoupon = new Coupon({
        name:data.couponName,
        createdOn: data.startDate,
        expireOn: data.endDate,
        offerPrice: data.offerPrice,
        minimumPrice: data.minimumPrice
    })

    await newCoupon.save()

    return res.redirect("/admin/coupon")

    } catch (error) {

        res.redirect("/pageerror")
        
    }
}

const editCoupon = async (req,res) => {
    try {

        const id = req.query.id;
        const findCoupon = await Coupon.findOne({_id:id});

        res.render("edit-coupon",{
            findCoupon:findCoupon,

        })
        
    } catch (error) {

        res.redirect("/pageerror")
        
    }
}

const updateCoupon = async (req, res) => {
    try {
        const couponId = req.query.couponId;
        if (!mongoose.Types.ObjectId.isValid(couponId)) {
            return res.status(400).json({ message: "Invalid coupon ID" });
        }

        const oid = new mongoose.Types.ObjectId(couponId); //	Converts string to ObjectId
        const selectedCoupon = await Coupon.findOne({ _id: oid });

        if (!selectedCoupon) {
            return res.status(404).json({ message: "Coupon not found" });
        }

        const startDate = new Date(req.body.startDate + "T00:00:00");
        const endDate = new Date(req.body.endDate + "T00:00:00");

        const updatedCoupon = await Coupon.findByIdAndUpdate(
            { _id: oid },
            {
                $set: {
                    name: req.body.couponName,
                    createdOn: startDate,
                    expireOn: endDate,
                    offerPrice: parseInt(req.body.offerPrice),
                    minimumPrice: parseInt(req.body.minimumPrice)
                }
            },
            { new: true }
        );

        if (!updatedCoupon) {
            return res.status(500).json({ message: "Error updating coupon" });
        }

        res.json({ message: "Coupon updated successfully", coupon: updatedCoupon });
    } catch (error) {
        console.error("Error updating coupon:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

const deleteCoupon = async (req,res) => {
    try {
        
        const id = req.query.id;
        await Coupon.deleteOne({_id:id})
        res.status(200).json({success:true,message:"Coupon deleted successfully"})

    } catch (error) {
        console.error("Error Deleting Coupon",error)
        res.status(500).json({success:false,message:"Internal Server Error"})
    }
}


module.exports = {
    loadCoupon,
    createCoupon,
    editCoupon,
    updateCoupon,
    deleteCoupon,


}