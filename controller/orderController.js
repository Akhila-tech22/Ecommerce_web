const Order = require("../models/orderSchema");
const User = require("../models/userSchema");
const Product = require("../models/productSchema");
const Category = require("../models/categorySchema");
const Address = require("../models/addressSchema");
const path = require("path");
const fs = require("fs");
const generateInvoice = require("../utils/generateInvoice"); 
const Coupon = require('../models/couponSchema')
const Transaction = require('../models/transactionSchema'); // Adjust path as needed
const mongoose = require('mongoose');

// Get all orders of logged-in user
const getOrders = async (req, res) => {
  try {
    const userId = req.session.user;
    const orders = await Order.find({ userId }).sort({ createdOn: -1 });
    const categories = await Category.find({ isListed: true });
    const productData = await Product.find({
      isBlocked: false,
      category: { $in: categories.map((cat) => cat._id) },
      quantity: { $gt: 0 },
    });
    const user = await User.findById(userId);

    res.render("orders", {
      orders,
      user,
      product: productData,
    });
  } catch (error) {
    console.error("Error in getOrders:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Load details for a single order
const loadOrderDetails = async (req, res) => {
  try {
    const userId = req.session.user;
    const orderId = req.query.orderId;

    const order = await Order.findOne({ orderId, userId });
    if (!order) {
      return res.status(404).send("Order not found");
    }

    const user = await User.findById(userId);

    res.render("order-details", {
      order,
      user,
    });
  } catch (error) {
    console.error("Error in loadOrderDetails:", error);
    res.status(500).send("Internal server error");
  }
};

const cancelOrder = async (req, res) => {
  try {
    const { orderId, reason, productId, size } = req.body;
    const userId = req.session.user;

    // Find the order
    const order = await Order.findOne({ _id: orderId, userId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // Find the specific product to cancel
    const orderedProduct = order.orderedItems.find(
      item => item.product.toString() === productId && item.size === size
    );
    if (!orderedProduct)
      return res.status(404).json({ success: false, message: "Product not found in order" });

    // Check if item can be cancelled
    if (orderedProduct.status === "cancelled" || orderedProduct.status === "delivered")
      return res.status(400).json({ success: false, message: "Cannot cancel this item" });

    // Store original total paid amount
    const originalAmountPaid = order.finalAmount;  //2150

    // Mark the item as cancelled
    orderedProduct.status = "cancelled";
    orderedProduct.cancelReason = reason;
    order.updatedOn = new Date();

    // Calculate remaining items total (non-cancelled items)
    const remainingItemsTotal = order.orderedItems
      .filter(item => item.status !== "cancelled")
      .reduce((sum, item) => sum + item.price * item.quantity, 0);  //1000

    // Check if coupon is still valid after cancellation
    let couponStillValid = false;
    let newFinalAmount = remainingItemsTotal + 50; //1050

    if (order.couponApplied && order.couponDetails?.couponId) {
      const coupon = await Coupon.findById(order.couponDetails.couponId);
      if (coupon) {
        const minimumPrice = coupon.minimumPrice || 0;    // 1010
        couponStillValid = remainingItemsTotal >= minimumPrice;  //valid  1000 - 1000
        
        if (couponStillValid) {
          // Coupon still valid - apply discount to remaining items
          const discountAmount = Math.min(order.discount, remainingItemsTotal);  // 100 , 1000
          newFinalAmount = remainingItemsTotal - discountAmount + 50; // 1000  -100 = 900+ 50 = 950
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
    const refundAmount = originalAmountPaid - newFinalAmount;   // 2150 - 950 = 1200 || 2150 - 1050 = 1100
    
    // Update order totals
    order.totalPrice = remainingItemsTotal; //1000
    order.finalAmount = newFinalAmount; //950 

    // Handle refund based on payment method
    let actualRefundAmount = 0;
    
    if (order.paymentMethod === "online" && refundAmount > 0) {
      // Add refund to user's wallet
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      if (typeof user.wallet !== "number") user.wallet = 0;
      
      user.wallet += refundAmount;  
      actualRefundAmount = refundAmount;
      await user.save();

      // Record refund transaction
      const transaction = new Transaction({
        userId,
        amount: refundAmount,
        transactionType: "credit",
        paymentMethod: "refund",
        purpose: "cancellation",
        description: `Cancelled: ${orderedProduct.productName} (Size: ${size})`,
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
          remainingItemsTotal
        },
        walletBalanceAfter: user.wallet,
      });
      await transaction.save();
    }
    // For COD, no immediate refund needed

    // Restore stock for cancelled product
    const product = await Product.findById(productId);
    if (product) {
      const variant = product.variants.find(v => v.size === size);
      if (variant) {
        variant.quantity += orderedProduct.quantity;
        await product.save();
      }
    }

    await order.save();

    res.json({
      success: true,
      message: "Order cancelled successfully",
      refundAmount: actualRefundAmount,
      couponStillValid,
      originalAmountPaid,
      newFinalAmount,
      remainingItemsTotal
    });

  } catch (error) {
    console.error("Cancel error:", error);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};




const requestReturn = async (req, res) => {
  try {
    const { orderId,productId, returnReason } = req.body;
    const userId = req.session.user;

    // Fix: match using _id instead of orderId
    const order = await Order.findOne({ _id: orderId, userId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const orderedProduct = order.orderedItems.find(item => item.product.toString() === productId)
     if (!orderedProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    if (orderedProduct.status !== "delivered") {
      return res.status(400).json({ success: false, message: "Return request not allowed" });
    }

    orderedProduct.status = "return_requested"; // from db
    orderedProduct.returnReason = returnReason;  
    order.updatedOn = new Date();

    await order.save();

    return res.json({ success: true, message: "Return request submitted successfully" });
  } catch (error) {
    console.error("Error in requestReturn:", error);
    return res.status(500).json({ success: false, message: "Something went wrong!" });
  }
};

const downloadInvoice = async (req, res) => {
  try {
    const orderId = req.params.orderId;

    const order = await Order.findById(orderId)
      .populate('userId')
      .populate('orderedItems.product');

    if (!order) return res.status(404).send('Order not found');

    // Get refund amounts from Transaction collection
    const orderedItems = await Promise.all(order.orderedItems.map(async (item) => {
      let refundAmount = 0;
      
      // Get actual refund from database for cancelled/returned items
      if (item.status === 'cancelled' || item.status === 'returned') {
        // Try multiple query approaches to find the transaction
        let transaction = await Transaction.findOne({
          'orders.orderId': order.orderId,
          'metadata.productId': item.product.toString(),
          'metadata.size': item.size,
          transactionType: 'credit',
          purpose: { $in: ['cancellation', 'return'] }
        });

        // If not found, try without size filter
        if (!transaction) {
          transaction = await Transaction.findOne({
            'orders.orderId': order.orderId,
            'metadata.productId': item.product.toString(),
            transactionType: 'credit',
            purpose: { $in: ['cancellation', 'return'] }
          });
        }

        // If still not found, try with productName
        if (!transaction) {
          transaction = await Transaction.findOne({
            'orders.orderId': order.orderId,
            'metadata.productName': item.productName,
            transactionType: 'credit',
            purpose: { $in: ['cancellation', 'return'] }
          });
        }

        // If still not found, try broader search by orderId only
        if (!transaction) {
          transaction = await Transaction.findOne({
            'orders.orderId': order.orderId,
            transactionType: 'credit',
            purpose: { $in: ['cancellation', 'return'] }
          });
        }

        // Debug logging
        console.log('Looking for refund transaction:', {
          orderId: order.orderId,
          productId: item.product.toString(),
          productName: item.productName,
          size: item.size,
          status: item.status
        });
        
        if (transaction) {
          console.log('Found transaction:', transaction.amount);
        } else {
          console.log('No transaction found');
        }
        
        refundAmount = transaction ? transaction.amount : 0;
      }

      return {
        productName: item.productName || item.product?.productName || 'Unknown',
        qty: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
        size: item.size,
        status: item.status.toUpperCase(),
        refund: refundAmount,
        productImages: item.productImages
      };
    }));

    const totalRefund = orderedItems.reduce((sum, item) => sum + item.refund, 0);

    const invoiceData = {
      websiteName: 'Karma',
      websiteUrl: 'www.Karma.com',
      orderId: order.orderId,
      invoiceDate: order.invoiceDate?.toLocaleDateString('en-GB') || new Date().toLocaleDateString('en-GB'),
      customer: {
        name: order.userId.name,
        address: order.address,
        phone: order.userId.phone || '',
      },
      payment: {
        method: order.paymentMethod,
        status: order.paymentStatus,
      },
      status: order.status,
      orderedItems,
      subtotal: order.totalPrice,
      totalRefund,
      finalAmount: order.finalAmount + 50,
      couponApplied: order.couponApplied,
      discount: order.discount,
      deliveryCharge: order.deliveryCharge || 50
    };

    const invoicePath = path.join(__dirname, `../invoices/invoice-${orderId}.pdf`);
    await generateInvoice(invoiceData, invoicePath);

    setTimeout(() => {
      res.download(invoicePath, `invoice-${order.orderId}.pdf`);
    }, 1000);
  } catch (err) {
    console.error('Error in downloadInvoice:', err);
    res.status(500).send('Server error');
  }
};

// Helper function to get refund amount from wallet for specific item
async function getRefundFromWallet(orderId, item) {
  try {
    // Look for wallet credit transaction for this specific item
    const transaction = await Transaction.findOne({
      'orders.orderId': orderId,
      'metadata.productId': item.product?.toString(),
      'metadata.size': item.size,
      transactionType: 'credit',
      purpose: { $in: ['cancellation', 'return'] }
    });
    
    return transaction ? transaction.amount : 0;
  } catch (error) {
    console.error('Error getting refund from wallet:', error);
    return 0;
  }
}

// Helper function to get total refund from wallet for entire order (when coupon applied)
async function getTotalRefundFromWalletForOrder(orderId) {
  try {
    const transactions = await Transaction.find({
      'orders.orderId': orderId,
      transactionType: 'credit',
      purpose: { $in: ['cancellation', 'return'] }
    });
    
    return transactions.reduce((total, transaction) => total + transaction.amount, 0);
  } catch (error) {
    console.error('Error getting total refund from wallet:', error);
    return 0;
  }
}





// Helper function to find refund transaction
async function findRefundTransaction(orderId, item) {
  // Try multiple query approaches to find the transaction
  let transaction = await Transaction.findOne({
    'orders.orderId': orderId,
    'metadata.productId': item.product?.toString() || item.productId,
    'metadata.size': item.size,
    transactionType: 'credit',
    purpose: { $in: ['cancellation', 'return', 'refund'] }
  });

  // If not found, try without size filter
  if (!transaction) {
    transaction = await Transaction.findOne({
      'orders.orderId': orderId,
      'metadata.productId': item.product?.toString() || item.productId,
      transactionType: 'credit',
      purpose: { $in: ['cancellation', 'return', 'refund'] }
    });
  }

  // If still not found, try with productName
  if (!transaction) {
    transaction = await Transaction.findOne({
      'orders.orderId': orderId,
      'metadata.productName': item.productName,
      transactionType: 'credit',
      purpose: { $in: ['cancellation', 'return', 'refund'] }
    });
  }

  // If still not found, try broader search by orderId only
  if (!transaction) {
    transaction = await Transaction.findOne({
      'orders.orderId': orderId,
      transactionType: 'credit',
      purpose: { $in: ['cancellation', 'return', 'refund'] }
    });
  }

  return transaction;
}

// Helper function to calculate expected refund amount
async function calculateExpectedRefund(order, item) {
  // Base refund is the item total
  let refundAmount = item.price * item.quantity;
  
  // Check if coupon needs to be recalculated
  if (order.couponApplied && order.discount > 0) {
    // Get all valid (non-cancelled, non-returned) items
    const validItems = order.orderedItems.filter(orderItem => 
      orderItem.status !== 'cancelled' && 
      orderItem.status !== 'canceled' && 
      orderItem.status !== 'returned' &&
      orderItem._id.toString() !== item._id.toString() // Exclude current item being refunded
    );
    
    const validItemsTotal = validItems.reduce((sum, validItem) => 
      sum + (validItem.price * validItem.quantity), 0
    );
    
    // Example logic: If valid items total is less than coupon minimum threshold,
    // adjust the refund to account for loss of coupon discount
    // You'll need to implement this based on your coupon rules
    
    // For now, we'll calculate proportional coupon impact
    const totalItemsValue = order.orderedItems.reduce((sum, orderItem) => 
      sum + (orderItem.price * orderItem.quantity), 0
    );
    
    const itemCouponShare = (refundAmount / totalItemsValue) * order.discount;
    
    // The refund should be reduced by the coupon benefit this item received
    refundAmount = refundAmount - itemCouponShare;
  }
  
  return Math.max(0, refundAmount); // Ensure refund is not negative
}




const cancelReturn = async (req, res) => {
  try {
    const { orderId, productId } = req.body;

    if (!orderId || !productId) {
      return res.json({ success: false, message: "Can't get IDs" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.json({ success: false, message: "Order not found" });
    }

    const orderProduct = order.orderedItems.find(
      item => item.product.toString() === productId
    );

    if (!orderProduct) {
      return res.json({ success: false, message: "Product not found" });
    }

    if (orderProduct.status === "return_requested") {
      orderProduct.status = "delivered";
      await order.save();
      return res.json({ success: true });
    } else {
      return res.json({ success: false, message: "Product is not in return_requested state" });
    }
  } catch (error) {
    console.error("Error in cancelReturn:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const placeWalletOrder = async (req, res) => {
  try {
    const userId = req.session.user
    const { addressId, couponCode } = req.body

    const user = await User.findById(userId).populate({
      path: "cart.productId",
      model: "Product",
    })

    if (!user || user.cart.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
      })
    }

    const address = await Address.findOne({ userId: userId, "address._id": addressId })
    if (!address) {
      return res.status(400).json({
        success: false,
        message: "Address not found",
      })
    }

    const selectedAddress = address.address.find((addr) => addr._id.toString() === addressId)

    const totalAmount = user.cart.reduce((sum, item) => sum + item.productId.salePrice * item.quantity, 0)
    let discount = 0
    let couponApplied = false

    if (couponCode) {
      const coupon = await Coupon.findOne({ name: couponCode, isList: true })
      if (coupon && !coupon.userId.includes(userId)) {
        discount = coupon.offerPrice
        couponApplied = true
        await Coupon.findByIdAndUpdate(coupon._id, {
          $push: { userId: userId },
        })
      }
    }

    const finalAmount = totalAmount - discount + DELIVERY_CHARGE
    const discountedItems = distributeDiscount(
      user.cart.map((item) => ({
        product: item.productId._id,
        productName: item.productId.productName,
        productImages: item.productId.productImage,
        quantity: item.quantity,
        price: item.productId.salePrice,
      })),
      discount,
    )

    const orders = await Promise.all(
      discountedItems.map(async (item) => {
        const product = await Product.findById(item.product).select("regularPrice productName productImage")
        const order = new Order({
          userId: userId,
          orderedItems: [
            {
              product: item.product,
              productName: product.productName,
              productImages: product.productImage,
              quantity: item.quantity,
              price: item.discountedPrice,
              regularPrice: product.regularPrice,
              status: "pending",
            },
          ],
          totalPrice: item.price * item.quantity,
          discount: item.price * item.quantity - item.discountedPrice * item.quantity,
          finalAmount: item.discountedPrice * item.quantity + DELIVERY_CHARGE / discountedItems.length,
          address: selectedAddress,
          status: "pending",
          paymentMethod: "wallet",
          couponApplied: couponApplied,
          deliveryCharge: DELIVERY_CHARGE / discountedItems.length,
          createdOn: new Date(),
          updatedOn: new Date(), // Set initial updatedOn timestamp
        })

        await Product.findByIdAndUpdate(item.product, {
          $inc: { quantity: -item.quantity },
        })

        return order.save()
      }),
    )

    //rest of the code is same as placeOrder function.
    const wallet = await Wallet.findOne({ userId })

    if (!wallet || wallet.balance < finalAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
      })
    }

    wallet.balance -= finalAmount
    wallet.totalDebited += finalAmount
    wallet.transactions.push({
      amount: finalAmount,
      transactionType: "debit",
      transactionPurpose: "purchase",
      description: "Order payment from wallet",
    })

    await wallet.save()

    await Transaction.create({
      userId: userId,
      amount: finalAmount,
      transactionType: "debit",
      paymentMethod: "wallet",
      paymentGateway: "wallet",
      status: "completed",
      purpose: "purchase",
      description: "Order payment from wallet",
      orders: orders.map((order) => ({
        orderId: order.orderId,
        amount: order.finalAmount,
      })),
      walletBalanceAfter: wallet.balance,
    })

    // Clear cart
    await User.findByIdAndUpdate(userId, { $set: { cart: [] } })

    res.json({
      success: true,
      orderIds: orders.map((order) => order.orderId),
      message: "Orders placed successfully",
    })
  } catch (error) {
    console.error("Error in placeWalletOrder:", error)
    res.status(500).json({
      success: false,
      message: "Failed to place order",
    })
  }
}



module.exports = {

  getOrders,
  loadOrderDetails,
  cancelOrder,
  requestReturn,
  downloadInvoice,
  cancelReturn,
  placeWalletOrder,

};
