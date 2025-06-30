
const Order = require("../models/orderSchema")
const Product = require("../models/productSchema");
const { productDetails } = require("./productController");
const User = require('../models/userSchema')
const Transaction = require('../models/transactionSchema')
const Coupon = require('../models/couponSchema')

const getOrders = async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdOn: -1 });

    // Filter out entire orders if they contain any item with status 'payment_failed'
    const validOrders = orders.filter(order =>
      !order.orderedItems.some(item => item.status === 'payment_failed')
    );

    res.render("admin-orders", {
      orders: validOrders,
      title: "Order Management"
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).send("Internal Server Error");
  }
};





const getOrderDetails = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).send("Order not found")
    res.render("admin-order-details", { order, title: "Order Details" })
  } catch (error) {
    console.error("Error fetching order details:", error)
    res.status(500).send("Internal Server Error")
  }
}

const updateOrderStatus = async (req, res) => {      
  try {
    const { orderId, productId, status, size } = req.body
    const order = await Order.findById(orderId)
    if (!order) return res.status(404).json({ success: false, message: "Order not found" })
    if (order.status === "cancelled")
      return res.status(400).json({ success: false, message: "Cannot update cancelled order" })

   
    if (order.paymentMethod === 'cod') {
     
      order.status = status;
      
    
      order.orderedItems.forEach(item => {
        if (item.status !== 'cancelled') {
          item.status = status;
        }
      });

      if (status === "delivered") {
        order.deliveredOn = new Date();
      }

      await order.save()
      res.json({ success: true, message: "Order status updated successfully for all products" })
    } else {
      // For online/wallet payments: Update individual product status (existing logic)
      const orderProduct = order.orderedItems.find(item => item.product.toString() === productId && item.size === size);
      if(!orderProduct) {
        return res.status(404).json({success : false, message : "Product not found"});
      }

      orderProduct.status = status                                                                       

      if (status === "delivered") {
        order.deliveredOn = new Date();
      }

      await order.save()
      res.json({ success: true, message: "Product status updated successfully" })
    }
  } catch (error) {
    console.error("Error updating order status:", error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}



// Helper function to process refunds
const processRefund = async (userId, order) => {
  try {
    const user = await User.findById(userId);
    if (!user) return false;

    if (typeof user.wallet !== "number") user.wallet = 0;
    
    user.wallet += order.finalAmount;
    await user.save();

    // Record refund transaction
    const transaction = new Transaction({
      userId: userId,
      amount: order.finalAmount,
      transactionType: "credit",
      paymentMethod: "refund",
      purpose: "cancellation",
      description: `Order cancelled: ${order.orderId}`,
      orders: [{ orderId: order.orderId, amount: order.finalAmount }],
      walletBalanceAfter: user.wallet,
    });
    await transaction.save();

    return true;
  } catch (error) {
    console.error("Error processing refund:", error);
    return false;
  }
}

const updateReturnStatus = async (req, res) => {
 try {
   const { orderId, productId, newStatus, size } = req.body;

   const order = await Order.findOne({ _id: orderId });
   if (!order) {
     return res.status(404).json({ success: false, message: "Order not found" });
   }

   const orderedProduct = order.orderedItems.find(
     item => item.product.toString() === productId && item.size === size
   );

   if (!orderedProduct) {
     return res.status(404).json({ success: false, message: "Product or size not found in order" });
   }

   const result = await Order.updateOne(
     { _id: orderId, "orderedItems.product": productId, "orderedItems.size": size },
     {
       $set: {
         "orderedItems.$.status": newStatus,
         "orderedItems.$.requestStatus": newStatus === "approved" ? "approved" : "rejected",
         "updatedOn": new Date()
       }
     }
   );

   if (result.modifiedCount === 0) {
     return res.status(404).json({ success: false, message: "Order or product not found" });
   }

   if (newStatus === "approved") {
     const originalAmountPaid = order.finalAmount;  //2150
     const remainingItemsTotal = order.orderedItems  ///1000
       .filter(item => 
         item.status !== "cancelled" && 
         item.status !== "returned" && 
         !(item.product.toString() === productId && item.size === size)
       )  
       .reduce((sum, item) => sum + (item.price * item.quantity), 0);

     let couponStillValid = false;
     let newFinalAmount = remainingItemsTotal + 50;  //1050

     if (order.couponApplied && order.couponDetails?.couponId) {
       const coupon = await Coupon.findById(order.couponDetails.couponId);
       if (coupon) {
         const minimumPrice = coupon.minimumPrice || 0;
         couponStillValid = remainingItemsTotal >= minimumPrice;
         
         if (couponStillValid) {
           const discountAmount = Math.min(order.discount, remainingItemsTotal);
           newFinalAmount = remainingItemsTotal - discountAmount + 50;
           order.discount = discountAmount;
         } else {
           order.discount = 0;
           order.couponApplied = false;
           order.couponDetails = undefined;
         }
       } else {
         order.discount = 0;
         order.couponApplied = false;
         order.couponDetails = undefined;
       }
     }

     const refundAmount = originalAmountPaid - newFinalAmount;
     order.totalPrice = remainingItemsTotal;
     order.finalAmount = newFinalAmount;

     let actualRefundAmount = 0;
     
     if (order.paymentMethod === "online" || order.paymentMethod === "wallet" && refundAmount > 0) {
       const user = await User.findById(order.userId);
       if (!user) {
         return res.status(404).json({ success: false, message: "User not found" });
       }

       if (typeof user.wallet !== "number") user.wallet = 0;
       
       user.wallet += refundAmount;
       actualRefundAmount = refundAmount;
       await user.save();

       const transaction = new Transaction({
         userId: order.userId,
         amount: refundAmount,
         transactionType: "credit",
         paymentMethod: "refund",
         purpose: "return",
         description: `Return approved: ${orderedProduct.productName} (Size: ${size})`,
         orders: [{ orderId: order.orderId, amount: refundAmount }],
         metadata: {
           productId,
           productName: orderedProduct.productName,
           size,
           quantity: orderedProduct.quantity,
           originalAmountPaid,
           newFinalAmount,
           refundAmount,
           couponWasApplied: order.couponApplied || false,
           couponStillValid,
           remainingItemsTotal,
           returnApproved: true
         },
         walletBalanceAfter: user.wallet,
       });
       await transaction.save();

     } else if (order.paymentMethod === "cod") {
       actualRefundAmount = 0;
       
       const transaction = new Transaction({
         userId: order.userId,
         amount: refundAmount,
         transactionType: "credit",
         paymentMethod: "refund",
         purpose: "return",
         description: `Return approved (COD): ${orderedProduct.productName} (Size: ${size}) - Amount adjusted`,
         orders: [{ orderId: order.orderId, amount: refundAmount }],
         metadata: {
           productId,
           productName: orderedProduct.productName,
           size,
           quantity: orderedProduct.quantity,
           originalAmountPaid,
           newFinalAmount,
           adjustmentAmount: refundAmount,
           couponWasApplied: order.couponApplied || false,
           couponStillValid,
           remainingItemsTotal,
           returnApproved: true,
           paymentMethod: "cod",
           note: "Customer will pay reduced amount at delivery"
         },
         walletBalanceAfter: 0,
       });
       await transaction.save();
     }

     const product = await Product.findById(productId);
     if (product) {
       const variant = product.variants.find(v => v.size === size);
       if (variant) {
         variant.quantity += orderedProduct.quantity;
         await product.save();
       }
     }

     await order.save();

     return res.status(200).json({
       success: true,
       message: "Return approved and refund processed successfully",
       refundAmount: actualRefundAmount,
       couponStillValid,
       originalAmountPaid,
       newFinalAmount,
       remainingItemsTotal,
       paymentMethod: order.paymentMethod
     });

   } else {
     return res.status(200).json({
       success: true,
       message: "Return status updated successfully"
     });
   }

 } catch (error) {
   console.error("Error in updateReturnStatus:", error);
   return res.status(500).json({ success: false, message: "Server Error" });
 }
};




module.exports = {
 getOrders,
 getOrderDetails,
 updateOrderStatus,
 updateReturnStatus,
 
 
}