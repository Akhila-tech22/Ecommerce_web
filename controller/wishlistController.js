const User = require("../models/userSchema");
const Wishlist = require("../models/wishlistSchema");
const Product = require("../models/productSchema");

const loadWishlist = async (req, res) => {
    try {
        const userId = req.session.user;
        
        if (!userId) {
            return res.redirect("/login");
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.redirect("/login");
        }

        // Get wishlist using the Wishlist model
        const wishlist = await Wishlist.findOne({ userId }).populate({
            path: 'products.productId',
            populate: {
                path: 'category'
            }
        });

        
        const wishlistProducts = wishlist ? [...wishlist.products].reverse() : [];

        res.render("wishlist", {
            user,
            wishlist: wishlistProducts,
        });

    } catch (error) {
        console.error('Error loading wishlist:', error);
        res.redirect("/pageNotFound");
    }
};

const addToWishlist = async (req, res) => {
    try {
        let { productId, size } = req.body;

        console.log('Received data:', { productId, size }); // Debug log

        if (!productId) {
            return res.status(400).json({ status: false, message: "Product ID is required" });
        }

        const userId = req.session.user;
        if (!userId) {
            return res.status(401).json({ status: false, message: "User not logged in" });
        }

        // Check if product exists
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ status: false, message: "Product not found" });
        }

        // Handle size validation
        if (!size || size.trim() === '' || size === 'undefined') {
            // Try to get the first available size from product variants
            if (product.variants && product.variants.length > 0) {
                const availableVariant = product.variants.find(variant => variant.quantity > 0);
                if (availableVariant) {
                    size = availableVariant.size;
                } else {
                    size = product.variants[0].size; // Use first size even if out of stock
                }
            } else {
                // Default size if no variants found
                size = "Default";
            }
        }

        // Convert size to string and trim whitespace
        size = size.toString().trim();

        console.log('Processing size:', size); // Debug log

        // Find or create wishlist
        let wishlist = await Wishlist.findOne({ userId });

        if (!wishlist) {
            // Create a new wishlist
            wishlist = new Wishlist({
                userId,
                products: [{ productId, size }]
            });
            
            console.log('Creating new wishlist:', wishlist); // Debug log
        } else {
            // Check if product already exists with the same size
            const existingProduct = wishlist.products.find(
                item => item.productId.toString() === productId && item.size === size
            );

            if (existingProduct) {
                return res.status(200).json({ 
                    status: false, 
                    message: "Product with this size already in wishlist" 
                });
            }

            // Add new product to wishlist
            wishlist.products.push({ productId, size });
            console.log('Updated wishlist:', wishlist); // Debug log
        }

        // Save wishlist
        const savedWishlist = await wishlist.save();
        console.log('Saved wishlist:', savedWishlist); // Debug log

        return res.status(200).json({ 
            status: true, 
            message: `Product (Size: ${size}) added to wishlist successfully` 
        });

    } catch (error) {
        console.error("Wishlist error:", error);
        return res.status(500).json({ 
            status: false, 
            message: "Server error: " + error.message 
        });
    }
};

const addToWishlistFromShop = async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ status: false, message: "Product ID is required" });
    }

    const userId = req.session.user;
    if (!userId) {
      return res.status(401).json({ status: false, message: "User not logged in" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ status: false, message: "Product not found" });
    }

    // Select the first available size with quantity > 0
    let selectedSize = "Default";
    if (product.variants && product.variants.length > 0) {
      const available = product.variants.find(variant => variant.quantity > 0);
      selectedSize = available ? available.size : product.variants[0].size;
    }

    let wishlist = await Wishlist.findOne({ userId });

    if (!wishlist) {
      wishlist = new Wishlist({
        userId,
        products: [{ productId, size: selectedSize }]
      });
    } else {
      const exists = wishlist.products.find(
        item => item.productId.toString() === productId && item.size === selectedSize
      );

      if (exists) {
        return res.status(200).json({
          status: false,
          message: "Product with this size already in wishlist"
        });
      }

      wishlist.products.push({ productId, size: selectedSize });
    }

    await wishlist.save();

    return res.status(200).json({
      status: true,
      message: `Product (Size: ${selectedSize}) added to wishlist successfully`
    });

  } catch (error) {
    console.error("Wishlist (shop) error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error: " + error.message
    });
  }
};


const removeProduct = async (req, res) => {
    try {
        const { productId, size } = req.query; // Get both productId and size
        const userId = req.session.user;

        if (!userId) {
            return res.redirect("/login");
        }

        if (!productId) {
            return res.status(400).json({ status: false, message: "Product ID is required" });
        }

        // Find wishlist
        const wishlist = await Wishlist.findOne({ userId });
        
        if (!wishlist) {
            return res.status(404).json({ status: false, message: "Wishlist not found" });
        }

        // Remove the specific product with size (if size provided) or all instances
        if (size) {
            wishlist.products = wishlist.products.filter(
                item => !(item.productId.toString() === productId && item.size === size)
            );
        } else {
            // Remove all instances of this product (all sizes)
            wishlist.products = wishlist.products.filter(
                item => item.productId.toString() !== productId
            );
        }

        await wishlist.save();

        return res.redirect("/wishlist");

    } catch (error) {
        console.error('Remove product error:', error);
        return res.status(500).json({ status: false, message: "Server Error" });
    }
};


const addToCartFromWishlist = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ status: false, message: 'Please login to continue' });
    }

    const userId = req.user._id;
    const { productId, size } = req.body;

    if (!productId || !size) {
      return res.status(400).json({ status: false, message: 'Product ID or size missing.' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ status: false, message: 'Product not found.' });
    }

    if (product.isBlocked) {
      return res.status(400).json({ status: false, message: 'Product is currently not available.' });
    }

    const variant = product.variants.find(v => v.size === size);
    if (!variant) {
      return res.status(400).json({ status: false, message: 'Selected size is not available.' });
    }

    if (variant.quantity <= 0) {
      return res.status(400).json({ status: false, message: 'Selected size is out of stock.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    // Check if product already in cart
    const cartItem = user.cart.find(item => item.productId.toString() === productId && item.size === size);

    if (cartItem) {
      if (cartItem.quantity >= 5) {
        return res.status(400).json({ status: false, message: 'Maximum quantity (5) already in cart' });
      }
      cartItem.quantity += 1;
    } else {
      user.cart.push({
        productId: productId,
        size: size,
        quantity: 1,
        price: product.salePrice
      });
    }

    // Save updated user cart
    await user.save();

    await Wishlist.updateOne(
      { userId: userId },
      { $pull: { products: { productId: productId, size: size } } }
    );

    return res.status(200).json({
      status: true,
      message: 'Product added to cart and removed from wishlist'
    });

  } catch (error) {
    console.error('addToCartFromWishlist error:', error);
    return res.status(500).json({ status: false, message: 'Something went wrong. Please try again.' });
  }
};

module.exports = {
    loadWishlist,
    addToWishlist,
    removeProduct,
    addToCartFromWishlist,
    addToWishlistFromShop,
};