const User = require("../models/userSchema");
const Product = require("../models/productSchema");
const Address = require("../models/addressSchema");
const Order = require("../models/orderSchema");
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Coupon = require('../models/couponSchema')
const Transaction = require('../models/transactionSchema')


const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const retry = async (req, res) => {
  try {
    const { orderId } = req.query; 
    const userId = req.session.user;

    if (!userId) {
      return res.redirect("/login");
    }

    if (!orderId) {
      return res.redirect("/orders"); 
    }

    // Find the failed order
    const order = await Order.findOne({ 
      orderId: orderId, 
      userId: userId,
      $or: [
        { paymentStatus: 'failed' },
        { 'orderedItems.status': 'payment_failed' }
      ]
    }).populate({
      path: 'orderedItems.product',
      model: 'Product',
      populate: {
        path: 'category',
        model: 'Category'
      }
    });

    if (!order) {
      return res.redirect("/orders"); // Order not found or not failed
    }

    // Store retry order info in session for payment processing
    req.session.retryOrder = {
      orderId: order.orderId,
      originalOrderId: order._id
    };

    
    res.redirect("/checkout");

  } catch (error) {
    console.error("Error in retry:", error);
    res.redirect("/pageNotFound");
  }
};


const loadCheckoutPage = async (req, res) => {
  try {
    const userId = req.session.user;

    if (!userId) {
      return res.redirect("/login");
    }

     
    
 
    const retryOrder = req.session.retryOrder;
    if (retryOrder) {
   
      delete req.session.retryOrder;
      
      // Find the retry order and render checkout
      const order = await Order.findOne({ 
        orderId: retryOrder.orderId, 
        userId: userId 
      }).populate({
        path: 'orderedItems.product',
        model: 'Product',
        populate: {
          path: 'category',
          model: 'Category'
        }
      });

      if (order) {
        const user = await User.findById(userId);
        const addressData = await Address.findOne({ userId });

        const cartItems = order.orderedItems.map(item => {  // a , b , c
          const product = item.product;  // a , b
          return { 
            product,  // a
            quantity: item.quantity,
             size: item.size,
            totalPrice: product.regularPrice * item.quantity,
            salesPrice: item.price,
          };
        });

        return res.render("checkout", {
          user,
          cartItems,
          subtotal: order.totalPrice,
          shippingCharge: order.shippingCharge || 50,
          grandTotal: order.finalAmount +50,
          couponDiscount: order.couponApplied || 0,
          userAddress: addressData,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID,
          appliedCoupon: order.couponDetails || null,
          isRetry: true,
          retryOrderId: order.orderId,
          wallet : user.wallet || 0,

        });
      }
    }

    // Original checkout logic for normal cart checkout
    const user = await User.findById(userId).populate({
      path: "cart.productId",
      model: "Product",
      populate: {
        path: "category",
        model: "Category",
      },
    });

    const addressData = await Address.findOne({ userId });

    if (!user) {
      return res.status(404).send("User not found");
    }

    // If cart is empty
    if (!user.cart || user.cart.length === 0) {
      return res.render("checkout", {
        user,
        cartItems: [],
        subtotal: 0,
        shippingCharge: 0,
        grandTotal: 0,
        couponDiscount: 0,
        userAddress: addressData,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID,
        appliedCoupon: null,
        isRetry: false
      });
    }

    // Validate stock and clean cart
    let cartModified = false;
    for (let item of user.cart) {
      if (item.productId && item.quantity > item.productId.quantity) {
        item.quantity = item.productId.quantity;
        cartModified = true;
        if (item.quantity === 0) {
          user.cart = user.cart.filter(
            (cartItem) =>
              cartItem.productId &&
              cartItem.productId.toString() !== item.productId.toString()  //Remove this item from the cart if stock is zero.
          );
        }
      }
    }

    if (cartModified) await user.save();

    // Filter and calculate cart items
    const cartItems = user.cart
      .filter((item) => {
        if (!item.productId) return false;
        if (item.productId.isBlocked === true) return false;
        if (item.productId.quantity <= 0) return false;
        if (item.productId.category && item.productId.category.isListed === false)
          return false;
        return true;
      })
      .map((item) => {
        const product = item.productId;
        const quantity = item.quantity;
        const discountPercent = Math.max(product.category.categoryOffer, product.productOffer);
        const discountAmount = quantity * product.regularPrice * (discountPercent / 100);
        const regularPriceSingle = product.regularPrice * quantity;
        const salesPrice =
          discountPercent > 0
            ? regularPriceSingle - discountAmount
            : (product.salePrice || product.regularPrice) * quantity;

        return {
          product,
          quantity,
          size: item.size,
          totalPrice: product.regularPrice * quantity,
          discountPercent,
          discountAmount,
          regularPriceSingle,
          salesPrice,
        };
      });

    // Calculate subtotal
    const subtotal = cartItems.reduce((total, item) => total + item.salesPrice, 0);

    // Get coupon from session (if applied)
    const coupon = req.session.coupon || null;
    const couponDiscount = coupon?.offerPrice || 0;

    // Shipping charge
    const shippingCharge = 50;

    // Final grand total with coupon discount
    const grandTotal = subtotal - couponDiscount + shippingCharge;

    res.render("checkout", {
      user,
      cartItems,
      subtotal,
      shippingCharge,
      grandTotal,
      couponDiscount,
      userAddress: addressData,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      appliedCoupon: coupon,
      isRetry: false
    });

  } catch (error) {
    console.error("Error in loadCheckoutPage:", error);
    res.redirect("/pageNotFound");
  }
};

const addAddressCheckout = async (req, res) => {
    try {
        const user = req.session.user;
        const userData = await User.findById(user);
        res.render("add-address-checkout", {
            theUser: user,
            user: userData
        });
    } catch (error) {
        res.redirect("/pageNotFound");
    }
};

const postAddAddressCheckout = async (req, res) => {
    try {
        const userId = req.session.user;
        const userData = await User.findOne({ _id: userId });
        const { addressType, name, country, city, landMark, state, streetAddress, pincode, phone, email, altPhone } = req.body;

        const userAddress = await Address.findOne({ userId: userData._id });
        
        if (!userAddress) {
            const newAddress = new Address({
                userId: userData,
                address: [{ addressType, name, country, city, landMark, state, streetAddress, pincode, phone, email, altPhone }]
            });
            await newAddress.save();
        } else {
            userAddress.address.push({ addressType, name, country, city, landMark, state, streetAddress, pincode, phone, email, altPhone });
            await userAddress.save();
        }

        res.redirect("/checkout");
    } catch (error) {
        console.error("Error adding address", error);
        res.redirect("/pageNotFound");
    }
};


const placeOrder = async (req, res) => {
  try {
    const userId = req.session.user;
    const { addressId, paymentMethod, appliedCoupon } = req.body;

    if (!userId || !addressId || !paymentMethod) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Check if this is a retry order
    const retryOrder = req.session.retryOrder;

    if (retryOrder) {
      // Handle retry payment - reuse existing failed order
      const existingOrder = await Order.findOne({ 
        _id: retryOrder.originalOrderId, 
        userId: userId 
      });

      if (!existingOrder) {
        return res.status(400).json({ success: false, message: "Retry order not found" });
      }

      if (paymentMethod.toLowerCase() === 'online') {
        // Create new Razorpay order for retry
        const razorpayOrder = await razorpay.orders.create({
          amount: existingOrder.finalAmount * 100,
          currency: 'INR',
          receipt: `retry_${existingOrder.orderId}_${Date.now()}`,
          notes: { userId, retryOrderId: existingOrder._id }
        });


        existingOrder.razorpayOrderId = razorpayOrder.id;
        await existingOrder.save();

        return res.status(200).json({
          success: true,
          razorpayOrderId: razorpayOrder.id,
          orderId: existingOrder._id,
          orderItems: existingOrder.orderedItems,
          totalAmount: existingOrder.totalPrice,
          discount: existingOrder.discount,
          deliveryCharge: existingOrder.deliveryCharge,
          finalAmount: existingOrder.finalAmount,
          address: existingOrder.address,
          name: existingOrder.address.name,
          email: existingOrder.address.email,
          contact: existingOrder.address.phone,
          isRetry: true
        });
      }

      return res.status(400).json({ success: false, message: "Invalid payment method for retry" });
    }

    // Normal order flow (your original code)
    const user = await User.findById(userId).populate({
      path: "cart.productId",
      model: "Product",
    });

    if (!user || !user.cart.length) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    const addressDoc = await Address.findOne({ userId });
    const selectedAddress = addressDoc?.address?.find(addr => addr._id.toString() === addressId);
    if (!selectedAddress) {
      return res.status(400).json({ success: false, message: "Invalid address" });
    }

    let orderItems = [];
    let totalAmount = 0;

    for (const item of user.cart) {
      const product = item.productId;
      const variant = product?.variants?.find(v => v.size === item.size);
      if (!variant || variant.quantity < item.quantity) {
        return res.status(400).json({ success: false, message: `Stock issue for ${product.productName}` });
      }

      const price = product.salePrice || product.regularPrice;
      totalAmount += price * item.quantity;

      orderItems.push({
        product: product._id,
        productName: product.productName,
        productImages: product.productImage[0],
        size: item.size,
        quantity: item.quantity,
        price,
        regularPrice: product.regularPrice || 0,
        status: 'pending',
      });
    }

    const discount = appliedCoupon?.offerPrice || 0;
    const deliveryCharge = 50;
    const finalAmount = totalAmount + 50 - discount;

    //  ADDED: Prepare coupon details for database storage
    let couponDetails = null;
    let couponApplied = false;
    
    if (appliedCoupon && discount > 0) {
      couponApplied = true;
      couponDetails = {
        couponId: appliedCoupon._id || null,
        couponName: appliedCoupon.name || appliedCoupon.code || 'Unknown Coupon',
        couponCode: appliedCoupon.name || 'Unknown Code',
        discountAmount: discount
      };
    }

    if (paymentMethod.toLowerCase() === 'online') {
      const razorpayOrder = await razorpay.orders.create({
        amount: finalAmount * 100,
        currency: 'INR',
        receipt: `order_${Date.now()}`,
        notes: { userId, addressId }
      });

      // Create order with payment_failed status initially
      const failedOrderItems = orderItems.map(item => ({
        ...item,
        status: 'payment_failed'  // Keep your original logic
      }));

      const failedOrder = new Order({
        userId,
        orderedItems: failedOrderItems,
        totalPrice: totalAmount,
        discount,
        deliveryCharge,
        finalAmount,
        address: selectedAddress,
        paymentMethod: 'online',
        paymentStatus: 'failed',  // Keep your original logic
        status: 'payment_failed', // Keep your original logic
        invoiceDate: new Date(),
        razorpayOrderId: razorpayOrder.id,
        //  ADDED: Store coupon information even for failed orders
        couponApplied,
        couponDetails
      });
      await failedOrder.save();

      return res.status(200).json({
        success: true,
        razorpayOrderId: razorpayOrder.id,
        orderId: failedOrder._id,
        orderItems,
        totalAmount,
        discount,
        deliveryCharge,
        finalAmount,
        address: selectedAddress,
        name: user.name,
        email: user.email,
        contact: user.phone || selectedAddress.phone,
        appliedCoupon
      });
    }

//  WALLET PAYMENT LOGIC - WITH TRANSACTION RECORDING
if (paymentMethod.toLowerCase() === 'wallet') {
  // Check if user has sufficient wallet balance
  const currentWalletBalance = user.wallet || 0;
  
  if (currentWalletBalance < finalAmount) {
    return res.status(400).json({ 
      success: false, 
      message: "Insufficient wallet balance" 
    });
  }

  // Deduct amount from wallet
  const newWalletBalance = currentWalletBalance - finalAmount;
  user.wallet = newWalletBalance;
  await user.save();

  // Create successful order
  const order = new Order({
    userId,
    orderedItems: orderItems,
    totalPrice: totalAmount,
    discount,
    deliveryCharge,
    finalAmount,
    address: selectedAddress,
    paymentMethod: 'wallet',
    paymentStatus: 'completed',
    status: 'pending',
    invoiceDate: new Date(),
    couponApplied,
    couponDetails
  });

  await order.save();

  // Record wallet debit transaction
  const transaction = new Transaction({
    userId,
    amount: finalAmount,
    transactionType: 'debit',
    paymentMethod: 'wallet',
    paymentGateway: 'wallet',
    status: 'completed',
    purpose: 'purchase',
    description: `Wallet payment for order ${order.orderId || order._id}`,
    orders: [{
      orderId: order._id.toString(),
      amount: finalAmount
    }],
    walletBalanceAfter: newWalletBalance
  });

  await transaction.save();
  
  // Reduce stock for wallet orders
  for (const item of orderItems) {
    const product = await Product.findById(item.product);
    if (product) {
      const variant = product.variants.find(v => v.size === item.size);
      if (variant && variant.quantity >= item.quantity) {
        variant.quantity -= item.quantity;
        await product.save();
      }
    }
  }
  
  // Clear cart
  user.cart = [];
  await user.save();

  // Mark coupon as used for wallet orders
  if (appliedCoupon && appliedCoupon.name) {
    await Coupon.findOneAndUpdate(
      { name: appliedCoupon.name },
      { $addToSet: { userId: userId } }
    );
  }

  return res.status(200).json({ success: true, orderId: order._id });
}

    //  ADDED: COD orders with coupon information
    const order = new Order({
      userId,
      orderedItems: orderItems,
      totalPrice: totalAmount,
      discount,
      deliveryCharge,
      finalAmount,
      address: selectedAddress,
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      status: 'pending',
      invoiceDate: new Date(),
      // ✅ ADDED: Store coupon information for COD orders
      couponApplied,
      couponDetails
    });

    await order.save();
    user.cart = [];
    await user.save();

    // ✅ ADDED: Mark coupon as used for COD orders (since COD is confirmed immediately)
    if (appliedCoupon && appliedCoupon.name) {
      await Coupon.findOneAndUpdate(
        { name: appliedCoupon.name },
        { $addToSet: { userId: userId } }
      );
    }

    return res.status(200).json({ success: true, orderId: order._id });

  } catch (err) {
    console.error("Order error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    } = req.body;

    const userId = req.session.user;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      //  PAYMENT SUCCESS - Update order status (coupon info already stored)
      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

      // Check if this is a retry payment
      const isRetry = req.session.retryOrder && req.session.retryOrder.originalOrderId.toString() === orderId;

      // Update order to success status
      order.paymentStatus = 'completed';
      order.status = 'pending';  
      order.razorpayPaymentId = razorpay_payment_id;
      order.razorpaySignature = razorpay_signature;
      
      // Update order items status to confirmed
      order.orderedItems.forEach(item => {
        item.status = 'pending';  // Change from payment_failed to confirmed
      });

      await order.save();

      //  ADDED: Mark coupon as used for successful online payments
      if (order.couponApplied && order.couponDetails && order.couponDetails.couponCode) {
        await Coupon.findOneAndUpdate(
          { name: order.couponDetails.couponCode },
          { $addToSet: { userId: userId } }
        );
      }

      // Reduce stock
      for (const item of order.orderedItems) {
        const product = await Product.findById(item.product);
        if (product) {
          const variant = product.variants.find(v => v.size === item.size);
          if (variant && variant.quantity >= item.quantity) {
            variant.quantity -= item.quantity;
            await product.save();
          }
        }
      }

      // Clear cart only for new orders, not retry
      if (!isRetry) {
        const user = await User.findById(userId);
        user.cart = [];
        await user.save();
      }

      // Clear retry session if it exists
      if (req.session.retryOrder) {
        delete req.session.retryOrder;
      }

      //  NOTE: Coupon information is already stored in the order
      // No additional coupon processing needed here since it was stored during placeOrder

      return res.status(200).json({ success: true, orderId: order._id });
    }

    // PAYMENT FAILED - Keep as payment_failed (don't change status)
    // The order already has payment_failed status, so just return error
    return res.status(400).json({ success: false, message: "Payment verification failed" });

  } catch (err) {
    console.error("Payment verification error:", err);
    // Don't change order status on server error, let it remain as is
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const orderSuccess = async (req, res) => {
  try {
    const orderId = req.query.orderId;
    const order = await Order.findById(orderId).populate('orderedItems.product');
    
    if (!order) {
      return res.redirect('/pageNotFound');
    }

    res.render('order-success', { 
      order,
      user: req.session.user
    });
  } catch (error) {
    console.error("Error loading success page:", error);
    res.redirect('/pageNotFound');
  }
};

const orderFailure = async (req, res) => {
  try {
    res.render('order-failure', { 
      user: req.session.user 
    });
  } catch (error) {
    console.error("Error loading failure page:", error);
    res.redirect('/pageNotFound');
  }
};


// Modified applyCoupon function - store coupon in session
const applyCoupon = async (req, res) => {
    try {
        const { couponCode, subtotal } = req.body;
        const userId = req.session.user;

        const coupon = await Coupon.findOne({ name: couponCode, isList: true });

        if (!coupon) {
            return res.json({ success: false, message: 'Invalid coupon code' });
        }

        if (new Date() > coupon.expireOn) {
            return res.json({ success: false, message: 'Coupon has expired' });
        }

        if (subtotal < coupon.minimumPrice) {
            return res.json({ success: false, message: `Minimum purchase amount should be ₹${coupon.minimumPrice}` });
        }

        if (coupon.userId.includes(userId)) {
            return res.json({ success: false, message: 'You have already used this coupon' });
        }

        // Store applied coupon in session
        req.session.appliedCoupon = coupon;

        res.json({ success: true, coupon: coupon });
    } catch (error) {
        console.error('Error applying coupon:', error);
        res.status(500).json({ success: false, message: 'An error occurred while applying the coupon' });
    }
};



module.exports = {
    loadCheckoutPage,
    postAddAddressCheckout,
    addAddressCheckout,
    placeOrder,
    verifyPayment,
    orderSuccess,
    orderFailure,
    applyCoupon,
    retry,
};


