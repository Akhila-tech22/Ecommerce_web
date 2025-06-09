const User = require("../models/userSchema");
const Product = require("../models/productSchema");
const Address = require("../models/addressSchema");
const Order = require("../models/orderSchema");
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Coupon = require('../models/couponSchema')

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const loadCheckoutPage = async (req, res) => {
  try {
    const userId = req.session.user;

    if (!userId) {
      return res.redirect("/login");
    }

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
        appliedCoupon: null
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
              cartItem.productId.toString() !== item.productId.toString()
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
      appliedCoupon: coupon, // send coupon to view
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
    const { addressId, paymentMethod, appliedCoupon } = req.body; // Added appliedCoupon

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    if (!addressId || !paymentMethod) {
      
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Normalize payment method to lowercase for enum validation
    const paymentMethodNormalized = paymentMethod.toLowerCase();
    if (!['cod', 'online', 'wallet'].includes(paymentMethodNormalized)) {
      console.log("Invalid payment method:", paymentMethodNormalized);
      return res.status(400).json({ success: false, message: "Invalid payment method" });
    }

    // Fetch user and populate cart products
    const user = await User.findById(userId).populate({
      path: "cart.productId",
      model: "Product",
    });

    if (!user) {
      console.log("User not found");
      return res.status(400).json({ success: false, message: "User not found" });
    }

    if (!user.cart || user.cart.length === 0) {
      console.log("User cart is empty");
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

   

    // Get user address document
    const addressDoc = await Address.findOne({ userId });
    if (!addressDoc) {
      console.log("Address document not found for user");
      return res.status(400).json({ success: false, message: "Address not found" });
    }

    // Find selected address inside address array
    const selectedAddress = addressDoc.address.find(addr => addr._id.toString() === addressId);
    if (!selectedAddress) {
      console.log("Selected address invalid");
      return res.status(400).json({ success: false, message: "Invalid address selected" });
    }

    let orderItems = [];
    let totalAmount = 0;

    for (const item of user.cart) {
      const product = item.productId;
      const quantity = item.quantity;
      const size = item.size; // Get size from cart

      if (!product) {
        console.log("Product missing in cart item");
        return res.status(400).json({ success: false, message: "Invalid product in cart" });
      }

      // Check stock for specific size variant
      const variant = product.variants.find(v => v.size === size);
      if (!variant || variant.quantity < quantity) {
        console.log(`Insufficient stock for product: ${product.productName} in size ${size}`);
        return res.status(400).json({ success: false, message: `Insufficient stock for product: ${product.productName} in size ${size}` });
      }

      const price = product.salePrice || product.regularPrice || 0;
      const totalPrice = price * quantity;

      totalAmount += totalPrice;

      orderItems.push({
        product: product._id,
        productName: product.productName,
        productImages: product.productImage[0],
        size: size, // Include size in order
        quantity,
        price,
        regularPrice: product.regularPrice || 0,
        status: 'pending',
      });

      // Update product stock for specific size variant
      variant.quantity -= quantity;
      try {
        await product.save();
      } catch (err) {
        console.error(`Error updating stock for product ${product.productName}:`, err);
        throw err;
      }
    }

    // Handle coupon discount calculation
    let discount = 0;
    let couponApplied = false;
    let couponData = null;

    if (appliedCoupon && appliedCoupon.offerPrice) {
      // Validate coupon again before applying
      const coupon = await Coupon.findById(appliedCoupon._id);
      
      if (coupon && coupon.isList && new Date() <= coupon.expireOn) {
        if (totalAmount >= coupon.minimumPrice && !coupon.userId.includes(userId)) {
          discount = appliedCoupon.offerPrice;
          couponApplied = true;
          couponData = {
            couponId: coupon._id,
            couponName: coupon.name,
            couponCode: coupon.name,
            discountAmount: discount
          };
          
          // Add user to coupon's used list
          coupon.userId.push(userId);
          await coupon.save();
        }
      }
    }

    // Calculate final amount
    const deliveryCharge = totalAmount > 500 ? 0 : 50; // Free shipping over ₹500
    const finalAmount = totalAmount + 50 - discount;

    // Handle payment method
    if (paymentMethodNormalized === 'online') {
      
    
      
      // Create Razorpay order
      const razorpayOrder = await razorpay.orders.create({
        amount: finalAmount * 100, // Razorpay accepts amount in paise
        currency: 'INR',
        receipt: `order_${Date.now()}`,
        notes: {
          userId: userId.toString(),
          addressId: addressId
        }
      });

      // Create order with Razorpay order ID but keep status as pending
      const order = new Order({
        userId,
        orderedItems: orderItems,
        totalPrice: totalAmount,
        discount,
        deliveryCharge,
        finalAmount,
        address: selectedAddress,
        paymentMethod: paymentMethodNormalized,
        paymentStatus: 'pending',
        razorpayOrderId: razorpayOrder.id,
        status: 'pending',
        invoiceDate: new Date(),
        couponApplied: couponApplied, // Add coupon applied status
        ...(couponData && { // Add coupon data if exists
          couponDetails: couponData
        })
      });

      await order.save();

      // Don't clear cart yet - will clear after successful payment
      console.log("Razorpay order created with ID:", razorpayOrder.id);

      return res.status(200).json({ 
        success: true, 
        message: "Razorpay order created", 
        orderId: order._id,
        razorpayOrderId: razorpayOrder.id,
        amount: finalAmount,
        currency: 'INR',
        name: user.name,
        email: user.email,
        contact: user.phone || selectedAddress.phone
      });

    } else {
      // Handle COD
      const order = new Order({
        userId,
        orderedItems: orderItems,
        totalPrice: totalAmount,
        discount,
        deliveryCharge,
        finalAmount,
        address: selectedAddress,
        paymentMethod: paymentMethodNormalized,
        paymentStatus: 'pending',
        status: 'confirmed',
        invoiceDate: new Date(),
        couponApplied: couponApplied, // Add coupon applied status
        ...(couponData && { // Add coupon data if exists
          couponDetails: couponData
        })
      });

      await order.save();

      // Clear user cart after COD order placed
      user.cart = [];
      await user.save();

      console.log("COD Order placed successfully with ID:", order._id);

      return res.status(200).json({ 
        success: true, 
        message: "Order placed successfully", 
        orderId: order._id 
      });
    }

  } catch (error) {
    console.error("Error placing order:", error);
    console.error("Full stack:", error.stack);
    res.status(500).json({ success: false, message: "An unexpected error occurred", error: error.message });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    // Verify signature
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      // Payment verified successfully
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }

      // Update order with payment details
      order.razorpayPaymentId = razorpay_payment_id;
      order.razorpaySignature = razorpay_signature;
      order.paymentStatus = 'completed';
      order.status = 'confirmed';
      await order.save();

      // Clear user cart
      const user = await User.findById(order.userId);
      user.cart = [];
      await user.save();

      console.log("Payment verified successfully for order:", orderId);

      res.status(200).json({ 
        success: true, 
        message: "Payment verified successfully",
        orderId: orderId
      });
    } else {
      // Payment verification failed
      const order = await Order.findById(orderId);
      if (order) {
        order.paymentStatus = 'failed';
        order.status = 'cancelled';
        await order.save();

        // Restore product stock
        for (const item of order.orderedItems) {
          const product = await Product.findById(item.product);
          if (product) {
            const variant = product.variants.find(v => v.size === item.size);
            if (variant) {
              variant.quantity += item.quantity;
              await product.save();
            }
          }
        }
      }

      console.log("Payment verification failed for order:", orderId);
      res.status(400).json({ success: false, message: "Payment verification failed" });
    }
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ success: false, message: "Payment verification error" });
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
    const orderId = req.query.orderId;
    const order = await Order.findById(orderId);
    
    res.render('order-failure', { 
      order,
      user: req.session.user
    });
  } catch (error) {
    console.error("Error loading failure page:", error);
    res.redirect('/pageNotFound');
  }
};

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
};