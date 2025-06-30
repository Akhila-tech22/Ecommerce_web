const User = require("../models/userSchema");
const Product = require("../models/productSchema");
const Category = require("../models/categorySchema");

const getCart = async (req, res) => {
  try {
    const userId = req.session.user;
    if (!userId) return res.redirect('/login');

    const user = await User.findById(userId).populate({
      path: 'cart.productId',
      populate: { path: 'category', select: 'name' }
    });

    if (!user) return res.redirect('/login');

    const updatedCart = [];
    let cartModified = false;
    const outOfStockItems = []; // Track out of stock items
    const blockedItems = []; // Track blocked products

    // Process cart items in reverse order to safely remove items
    for (let i = user.cart.length - 1; i >= 0; i--) {
      const item = user.cart[i];
      
      // Check if product exists and is not blocked
      if (!item.productId || !item.size || !item.price || !item.quantity) {
        user.cart.splice(i, 1);
        cartModified = true;
        continue;
      }

      // Check if product is blocked
      if (item.productId.isBlocked) {
        blockedItems.push({
          name: item.productId.productName,
          size: item.size,
          reason: 'Product is currently unavailable'
        });
        user.cart.splice(i, 1);
        cartModified = true;
        continue;
      }

      const variant = item.productId.variants.find(v => v.size === item.size);
      const availableStock = variant ? variant.quantity : 0;

      // If product is completely out of stock, remove from cart
      if (availableStock === 0) {
        outOfStockItems.push({
          name: item.productId.productName,
          size: item.size
        });
        user.cart.splice(i, 1);
        cartModified = true;
        continue;
      }

      // If cart quantity exceeds available stock, adjust quantity
      if (item.quantity > availableStock) {
        item.quantity = availableStock;
        cartModified = true;
      }

      updatedCart.unshift({
        product: {
          _id: item.productId._id,
          productName: item.productId.productName,
          productImage: item.productId.productImage || [],
          salePrice: item.price,
          category: item.productId.category || { name: 'Unknown' },
          brand: item.productId.brand || 'Unknown',
          availableStock: availableStock
        },
        size: item.size,
        quantity: item.quantity,
        totalPrice: item.price * item.quantity
      });
    }

    // Save cart changes if any modifications were made
    if (cartModified) {
      await user.save();
    }

    const grandTotal = updatedCart.reduce((sum, item) => sum + item.totalPrice, 0);

    // Pass both out of stock and blocked items to the view
    res.render('cart', { 
      cartItems: updatedCart, 
      grandTotal, 
      user,
      outOfStockItems: outOfStockItems,
      blockedItems: blockedItems // Add blocked items
    });
    
  } catch (error) {
    console.error("Cart load error:", error);
    res.status(500).render('error', { message: 'Something went wrong loading the cart.' });
  }
};

const addToCart = async (req, res) => {
  try {
    const { productId, size } = req.body;

    if (!productId || !size) {
      return res.status(400).json({ status: false, message: "Product ID and size are required" });
    }

    const userId = req.session.user;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ status: false, message: "User not found" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ status: false, message: "Product not found" });
    }

    // Check if product is blocked
    if (product.isBlocked) {
      return res.status(400).json({ status: false, message: "This product is currently unavailable" });
    }

    const existingSize = product.variants.find(item => item.size === size && item.quantity > 0);
    if (!existingSize) {
      return res.status(400).json({ status: false, message: "Selected size is out of stock" });
    }

    // Check if this product+size is already in cart
    const alreadyInCart = user.cart.find(item =>
      item.productId.toString() === productId.toString() && item.size === size
    );

    if (alreadyInCart) {
      // Check stock availability for increase
      if (alreadyInCart.quantity >= existingSize.quantity) {
        return res.status(400).json({ status: false, message: `Only ${existingSize.quantity} items available in stock` });
      }
      if (alreadyInCart.quantity >= 5) {
        return res.status(400).json({ status: false, message: "Maximum 5 quantity allowed per item" });
      }
      alreadyInCart.quantity += 1;
    } else {
      // Add new item
      user.cart.push({
        productId,
        size,
        quantity: 1,
        price: product.salePrice
      });
    }

    await user.save();

    return res.status(200).json({
      status: true,
      message: "Product added to cart successfully",
      cartLength: user.cart.length
    });

  } catch (error) {
    console.error("Cart error:", error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
};

const changeQuantity = async (req, res) => {
  try {
    const { productId, action, size } = req.body;
    const userId = req.session.user;

    if (!userId) {
      return res.status(401).json({ status: false, message: "User not logged in" });
    }

    const user = await User.findById(userId).populate('cart.productId');
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const cartItemIndex = user.cart.findIndex(item => {
      const productMatch = item.productId._id.toString() === productId.toString();
      const sizeMatch = item.size.toString().trim() === size.toString().trim();
      return productMatch && sizeMatch;
    });

    if (cartItemIndex === -1) {
      return res.status(404).json({ status: false, message: "Item not found in cart" });
    }

    const cartItem = user.cart[cartItemIndex];
    const product = cartItem.productId;
    
    // Check if product is blocked
    if (product.isBlocked) {
      // Remove item from cart and show blocked message
      user.cart.splice(cartItemIndex, 1);
      await user.save();
      
      const grandTotal = user.cart.reduce((total, item) => 
        total + (item.price * item.quantity), 0
      );
      
      return res.json({ 
        status: false, 
        productBlocked: true,
        message: `${product.productName} (Size: ${size}) is currently unavailable and has been removed from your cart`,
        grandTotal: grandTotal,
        removeItem: true
      });
    }
    
    // Get current stock for this size
    const variant = product.variants.find(v => v.size === size);
    const availableStock = variant ? variant.quantity : 0;

    // Check if product is out of stock
    if (availableStock === 0) {
      // Remove item from cart and show out of stock message
      user.cart.splice(cartItemIndex, 1);
      await user.save();
      
      const grandTotal = user.cart.reduce((total, item) => 
        total + (item.price * item.quantity), 0
      );
      
      return res.json({ 
        status: false, 
        outOfStock: true,
        message: `${product.productName} (Size: ${size}) is out of stock and has been removed from your cart`,
        grandTotal: grandTotal,
        removeItem: true
      });
    }

    let newQuantity = cartItem.quantity;

    if (action === 'increase') {
      if (newQuantity >= 5) {
        return res.status(400).json({ status: false, message: "Maximum 5 quantity per user" });
      }
      if (newQuantity >= availableStock) {
        return res.status(400).json({ status: false, message: `Only ${availableStock} items available in stock` });
      }
      newQuantity++;
    } else if (action === 'decrease') {
      if (newQuantity > 1) {
        newQuantity--;
      } else {
        user.cart.splice(cartItemIndex, 1);
        await user.save();
        
        const grandTotal = user.cart.reduce((total, item) => 
          total + (item.price * item.quantity), 0
        );
        
        return res.json({ 
          status: true, 
          quantity: 0, 
          grandTotal: grandTotal,
          message: "Item removed from cart",
          removeItem: true
        });
      }
    }

    user.cart[cartItemIndex].quantity = newQuantity;
    await user.save();

    const grandTotal = user.cart.reduce((total, item) => 
      total + (item.price * item.quantity), 0
    );

    res.json({ 
      status: true, 
      quantity: newQuantity, 
      grandTotal: grandTotal 
    });

  } catch (error) {
    console.error("Error in changeQuantity:", error);
    res.status(500).json({ status: false, message: "Internal server error" });
  }
};

const deleteItem = async (req, res) => {
  try {
    const { id: productId, size } = req.query;

    if (!productId || !size) {
      return res.json({ status: false, message: "Please check your frontend" });
    }

    const userId = req.session.user;
    if (!userId) {
      return res.status(401).json({ status: false, message: "User not logged in" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const index = user.cart.findIndex(item =>
      item.productId.toString() === productId.toString() &&
      item.size.trim() === size.trim()
    );

    if (index === -1) {
      return res.status(404).json({ status: false, message: "Item not found in cart" });
    }

    user.cart.splice(index, 1);
    await user.save();

    return res.json({ status: true, message: "Item removed from cart" });

  } catch (error) {
    console.error("Error in deleteItem:", error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
};

const addToCartFromShop = async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ status: false, message: "Product ID is required" });
    }

    const userId = req.session.user;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ status: false, message: "User not found" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ status: false, message: "Product not found" });
    }

    // Check if product is blocked
    if (product.isBlocked) {
      return res.status(400).json({ status: false, message: "This product is currently unavailable" });
    }

    // Pick the first available size
    const availableVariant = product.variants.find(v => v.quantity > 0);
    if (!availableVariant) {
      return res.status(400).json({ status: false, message: "Product is out of stock" });
    }

    const selectedSize = availableVariant.size;

    // Check if this product+size is already in cart
    const alreadyInCart = user.cart.find(item =>
      item.productId.toString() === productId.toString() && item.size === selectedSize
    );

    if (alreadyInCart) {
      if (alreadyInCart.quantity >= availableVariant.quantity) {
        return res.status(400).json({ status: false, message: `Only ${availableVariant.quantity} items available in stock` });
      }
      if (alreadyInCart.quantity >= 5) {
        return res.status(400).json({ status: false, message: "Maximum 5 quantity allowed per item" });
      }
      alreadyInCart.quantity += 1;
    } else {
      user.cart.push({
        productId,
        size: selectedSize,
        quantity: 1,
        price: product.salePrice
      });
    }

    await user.save();

    return res.status(200).json({
      status: true,
      message: `Added to cart (size: ${selectedSize})`,
      cartLength: user.cart.length
    });

  } catch (error) {
    console.error("Cart error (shop page):", error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
};

module.exports = {
  getCart,
  addToCart,
  changeQuantity,
  deleteItem,
  addToCartFromShop
};