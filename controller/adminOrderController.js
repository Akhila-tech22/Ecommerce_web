const Order = require("../models/orderSchema")
const Product = require("../models/productSchema");
const { productDetails } = require("./productController");
const User = require('../models/userSchema')
const Transaction = require('../models/transactionSchema')
const Coupon = require('../models/couponSchema')
const getOrders = async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdOn: -1 });


    res.render("admin-orders", {
      orders,
      title: "Order Management"
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).send("Internal Server Error");
  }
};
const getReturnRequests = async (req, res) => {
  try {
    const returnOrders = await Order.find({
      returnReason: { $exists: true, $ne: null },
      requestStatus: "pending"
    })
      .populate('userId', 'name') // Only get the 'name' field of the user
      .sort({ updatedOn: -1 });

    res.render('admin-return-requests', {
      orders: returnOrders,
      title: 'Return Requests'
    });
  } catch (error) {
    console.error("Error fetching return requests:", error);
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
    const { orderId, productId, status , size} = req.body
    const order = await Order.findById(orderId)
    if (!order) return res.status(404).json({ success: false, message: "Order not found" })
    if (order.status === "cancelled")
      return res.status(400).json({ success: false, message: "Cannot update cancelled order" })

   const orderProduct = order.orderedItems.find(item => item.product.toString() === productId && item.size === size);
  if(!orderProduct) {
    return res.status(404).json({success : false, message : "Product not found"});
  }



    orderProduct.status = status                                                                       

  if (status === "delivered") {

  order.deliveredOn = new Date();
}


    await order.save()
    res.json({ success: true, message: "Order status updated successfully" })
  } catch (error) {
    console.error("Error updating order status:", error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}

const cancelOrder = async (req, res) => {
  try {
    const { orderId , productId, size } = req.body
    const order = await Order.findById(orderId)
    if (!order) return res.status(404).json({ success: false, message: "Order not found" })

    if (order.status !== "cancelled" && order.status !== "delivered") {
      order.status = "cancelled"
      order.orderedItems[0].status = "cancelled"
      order.updatedOn = new Date()

      await Product.findByIdAndUpdate(order.orderedItems[0].product, {
        $inc: { quantity: order.orderedItems[0].quantity },
      })

      if (order.paymentMethod === "online" || order.paymentMethod === "wallet") {
        const refundSuccess = await processRefund(order.userId, order)
        if (!refundSuccess) {
          return res.status(500).json({ success: false, message: "Failed to process refund" })
        }
      }

      await order.save()
      return res.json({ success: true, message: "Order cancelled and refund processed successfully" })
    }

    res.status(400).json({ success: false, message: "Order cannot be cancelled" })
  } catch (error) {
    console.error("Error cancelling order:", error)
    res.status(500).json({ success: false, message: "Internal server error" })
  }
}



const updateReturnStatus = async (req, res) => {
  try {
    const { orderId, productId, newStatus, size } = req.body;

    // 1. Find the order
    const order = await Order.findOne({ _id: orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // 2. Find the specific ordered product
    const orderedProduct = order.orderedItems.find(
      item => item.product.toString() === productId && item.size === size
    );

    if (!orderedProduct) {
      return res.status(404).json({ success: false, message: "Product or size not found in order" });
    }

    // 3. Update the return status
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

    // 4. PROCESS REFUND ONLY IF ADMIN APPROVES THE RETURN
    if (newStatus === "approved") {
      
      // Store original total paid amount
      const originalAmountPaid = order.finalAmount; // 2150

      // Calculate remaining items total (after return approval)
      const remainingItemsTotal = order.orderedItems
        .filter(item => 
          item.status !== "cancelled" && 
          item.status !== "returned" && 
          !(item.product.toString() === productId && item.size === size)
        )  
        .reduce((sum, item) => sum + (item.price * item.quantity), 0); //1050

      // Check if coupon is still valid after return
      let couponStillValid = false;
      let newFinalAmount = remainingItemsTotal + 50;

      if (order.couponApplied && order.couponDetails?.couponId) {
        const coupon = await Coupon.findById(order.couponDetails.couponId);
        if (coupon) {
          const minimumPrice = coupon.minimumPrice || 0;
          couponStillValid = remainingItemsTotal >= minimumPrice;
          
          if (couponStillValid) {
            // Coupon still valid - apply discount to remaining items
            const discountAmount = Math.min(order.discount, remainingItemsTotal);
            newFinalAmount = remainingItemsTotal - discountAmount + 50;
            order.discount = discountAmount;
          } else {
            // Coupon no longer valid - remove discount
            order.discount = 0;
            order.couponApplied = false;
            order.couponDetails = undefined;
          }
        } else {
          // Coupon not found - remove discount
          order.discount = 0;
          order.couponApplied = false;
          order.couponDetails = undefined;
        }
      }

      // Calculate refund amount: Original paid - New total
      const refundAmount = originalAmountPaid - newFinalAmount;
      
      // Update order totals
      order.totalPrice = remainingItemsTotal;
      order.finalAmount = newFinalAmount;

      // Handle refund based on payment method
      let actualRefundAmount = 0;
      
      if (order.paymentMethod === "online" && refundAmount > 0) {
        // Add refund to user's wallet
        const user = await User.findById(order.userId);
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found" });
        }

        if (typeof user.wallet !== "number") user.wallet = 0;
        
        user.wallet += refundAmount;
        actualRefundAmount = refundAmount;
        await user.save();

        // Record refund transaction
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
        // COD: Customer will pay less at delivery (or get refund if already paid)
        actualRefundAmount = 0; // No immediate wallet refund for COD
        
        // Record the adjustment for COD
        const transaction = new Transaction({
          userId: order.userId,
          amount: refundAmount,
          transactionType: "credit",
          paymentMethod: "cod_adjustment",
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
          walletBalanceAfter: 0, // No wallet change for COD
        });
        await transaction.save();
      }

      // Restore product stock
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
      // If rejected, just return success message
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
  cancelOrder,
  updateReturnStatus,
  getReturnRequests,
}
