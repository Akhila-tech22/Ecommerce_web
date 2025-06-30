const Product = require("../models/productSchema");
const Category = require("../models/categorySchema");
const Brand = require("../models/brandSchema");
const User = require('../models/userSchema')

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");



const calculateEffectivePrice = async (product) => {
  const category = await Category.findById(product.category);
  const categoryOffer = category ? category.categoryOffer || 0 : 0;
  const productOffer = product.productOffer || 0;

  const effectiveOffer = Math.max(categoryOffer, productOffer);
  const effectivePrice = product.regularPrice * (1 - effectiveOffer / 100);

  return Math.round(effectivePrice * 100) / 100;
};

// GET: Render Add Product Page
const getProductAddPage = async (req, res) => {
  try {
    const page = parseInt(req.session.page) || 1;
    const limit = 4;
    const skip = (page - 1) * limit;

    const category = await Category.find({ isListed: true });
    const brands = await Brand.find({ isBlocked: false }).skip(skip).limit(limit);

    res.render("product-add", {
      cat: category,
      brand: brands,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error loading product add page:", error);
    res.status(500).json({
      success: false,
      message: "Error loading product add page",
    });
  }
};


// POST: Save Uploaded Image (Optional Crop Save Route)
const saveImage = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    const filename = Date.now() + '-' + file.originalname.replace(/\s/g, "");
    const filepath = path.join(__dirname, "../../karma-master/upload/product-images", filename);

    await sharp(file.buffer)
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(filepath);

    return res.status(200).json({
      success: true,
      message: "Image saved successfully",
      filename,
    });
  } catch (error) {
    console.error("Error saving image:", error);
    return res.status(500).json({
      success: false,
      message: "Error saving image",
    });
  }
};



// POST: Add New Product
const addProducts = async (req, res) => {
  try {
    const { productName, description: fullDescription, brand, category, regularPrice, salePrice, color } = req.body;
    const variants = req.body.variants;
      
    if (!variants || variants.length === 0) {
      return res.json({ success: false, message: "Variants not found" });
    }

    // Parse prices to numbers for validation
    const regPrice = parseFloat(regularPrice);
    const sPrice = parseFloat(salePrice);

    // Validate prices - Check for negative values first
    if (regPrice < 0 || sPrice < 0) {
      return res.json({ success: false, message: "Prices cannot be negative!" });
    }

    // Check if prices are valid numbers and greater than 0
    if (regPrice <= 0 || sPrice <= 0) {
      return res.json({ success: false, message: "Prices must be greater than 0!" });
    }

    // Check if sale price is greater than regular price
    if (sPrice > regPrice) {
      return res.json({ success: false, message: "Sale price cannot be greater than regular price!" });
    }

    // Check if product name already exists - PREVENT DUPLICATES
    const productExists = await Product.findOne({ 
      productName: { $regex: new RegExp(`^${productName}$`, 'i') } // Case-insensitive check
    });

    if (productExists) {
      return res.status(400).json({
        success: false,
        message: "Product name already exists! Please choose a different name.",
      });
    }

    const uploadDir = path.join(__dirname, "../karma-master/uploads/product-images");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const imageFilenames = [];

    for (let i = 1; i <= 4; i++) {
      const croppedImageData = req.body[`croppedImage${i}`];

      if (croppedImageData && croppedImageData.startsWith("data:image")) {
        const base64Data = croppedImageData.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, "base64");

        const filename = Date.now() + `-cropped-image-${i}.webp`;
        const filepath = path.join(uploadDir, filename);

        await sharp(imageBuffer)
          .webp({ quality: 80 })
          .toFile(filepath);

        imageFilenames.push(`uploads/product-images/${filename}`);
      } else if (req.files && req.files[`image${i}`]) {
        const file = req.files[`image${i}`][0];
        const filename = Date.now() + "-" + file.originalname.replace(/\s/g, "") + ".webp";
        const filepath = path.join(uploadDir, filename);

        await sharp(file.buffer)
          .resize(800, 800, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(filepath);

        imageFilenames.push(`uploads/product-images/${filename}`);
      }
    }

    if (imageFilenames.length < 4) {
      return res.status(400).json({
        success: false,
        message: "Please upload all 4 product images",
      });
    }

    const foundCategory = await Category.findOne({ name: category });
    if (!foundCategory) {
      return res.status(400).json({
        success: false,
        message: "Category not found",
      });
    }

    // Create new product only if name doesn't exist
    const newProduct = new Product({
      productName,
      description: fullDescription, 
      brand,
      category: foundCategory._id,
      regularPrice: regPrice,
      salePrice: sPrice,
      color,
      productImage: imageFilenames,
      createdOn: new Date(),
      variants: variants,
      status: "available", 
    });

    await newProduct.save();

    return res.status(200).json({
      success: true,
      message: "Product added successfully",
    });
  } catch (error) {
    console.error("Error saving product:", error);
    return res.status(500).json({
      success: false,
      message: "Error saving product",
    });
  }
};

// GET: All Products Page
const getAllProducts = async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = 19;

   
   
   const query = {
  $or: [
    { productName: { $regex: search, $options: "i" } },
    { brand: { $regex: search, $options: "i" } }
  ]
};


    const productData = await Product.find(query)
      .sort({ createdAt: 1 })  // ascending
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("category")
      .exec();

    const count = await Product.countDocuments(query);
    const totalPages = Math.ceil(count / limit);
    const category = await Category.find({ isListed: true });

    const productsWithEffectivePrices = await Promise.all(
      productData.map(async (product) => {
        // Placeholder for future price calculation logic
        return {
          ...product.toObject(),  // take data
          salePrice: product.salePrice,
        };
      })
    );

    if (category.length > 0) {
      res.render("products", {
        data: productsWithEffectivePrices,
        currentPage: page,
        totalPages,
        cat: category,
      });
    } else {
      res.render("admin-error");
    }
  } catch (error) {
    console.error("Error fetching products:", error);
    res.render("admin-error");
  }
};


const addProductOffer = async (req, res) => {
  try {
    const { productId, percentage } = req.body;
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ status: false, message: "Product not found" });
    }



    product.productOffer = parseInt(percentage);
    product.salePrice = await calculateEffectivePrice(product);
    await product.save();

    res.json({ status: true, message: "Offer added successfully" });
  } catch (error) {
    console.error("Error in addProductOffer:", error);
    res.status(500).json({ status: false, message: "Internal server error" });
  }
};

const removeProductOffer = async (req, res) => {
  try {
    const { productId } = req.body;
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ status: false, message: "Product not found" });
    }

    product.productOffer = 0;
    product.salePrice = await calculateEffectivePrice(product);
    await product.save();

    res.json({ status: true, message: "Offer removed successfully" });
  } catch (error) {
    console.error("Error in removeProductOffer:", error);
    res.status(500).json({ status: false, message: "Internal server error" });
  }
};


const blockProduct = async (req,res) => {
  try {

    let id = req.query.id;
    let currentPage = req.query.page || 1;
    await Product.updateOne({_id:id},{$set:{isBlocked:true}});
    res.redirect(`/admin/products?page=${currentPage}`)
    
  } catch (error) {
    res.redirect("/pageerror")
    
  }
}

const unblockProduct = async (req,res) => {
  try {

    let id = req.query.id;
    await Product.updateOne({_id:id},{$set:{isBlocked:false}});
    res.redirect("/admin/products")
    
  } catch (error) {
    res.redirect("/pageerror")
    
  }
}


const getEditProduct = async (req, res) => {
  try {
    const id = req.query.id
    const product = await Product.findOne({ _id: id }).populate("category")
    const categories = await Category.find({})

    if (!product) {
      return res.status(404).send("Product not found")
    }

    res.render("product-edit", {
      product: product,
      cat: categories,
    })
  } catch (error) {
    console.error("Error in getEditProduct:", error)
    res.redirect("/pageerror")
  }
}






const editProduct = async (req, res) => {
  try {
    const id = req.params.id
    const {
      productName,
      description,
      regularPrice,
      salePrice,
      color,
      variants,
      brand,
      category,
    } = req.body

    // ========== FIND CURRENT PRODUCT ==========
    const product = await Product.findById(id)
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: "Product not found" 
      })
    }

    // ========== VALIDATION SECTION ==========
    
    // 1. Basic field validation
    const errors = []
    
    // Validate product name
    const normalizedProductName = productName?.trim()
    if (!normalizedProductName) {
      errors.push("Product name is required")
    }

    // Validate description
    const normalizedDescription = description?.trim()
    if (!normalizedDescription) {
      errors.push("Product description is required")
    }

    // Validate prices
    const parsedRegularPrice = parseFloat(regularPrice)
    const parsedSalePrice = parseFloat(salePrice)

    if (isNaN(parsedRegularPrice) || parsedRegularPrice <= 0) {
      errors.push("Regular price must be a positive number")
    }

    if (isNaN(parsedSalePrice) || parsedSalePrice <= 0) {
      errors.push("Sale price must be a positive number")
    }

    // Validate that sale price is not greater than regular price
    if (!isNaN(parsedRegularPrice) && !isNaN(parsedSalePrice) && parsedSalePrice > parsedRegularPrice) {
      errors.push("Sale price cannot be greater than regular price")
    }

    // Validate color
    if (!color || color.trim() === '') {
      errors.push("Product color is required")
    }

    // Validate brand
    const normalizedBrand = brand?.trim()
    if (!normalizedBrand) {
      errors.push("Brand is required")
    }

    // Validate category
    if (!category) {
      errors.push("Category is required")
    }

    // Validate variants
    let processedVariants = []
    if (variants && Array.isArray(variants)) {
      processedVariants = variants.map((variant, index) => {
        const size = variant.size?.trim()
        const quantity = parseInt(variant.quantity)
        
        if (!size) {
          errors.push(`Variant ${index + 1}: Size is required`)
        }
        
        if (isNaN(quantity) || quantity < 0) {
          errors.push(`Variant ${index + 1}: Quantity must be a non-negative number`)
        }
        
        return {
          size: size,
          quantity: quantity || 0
        }
      })
    } else if (variants && typeof variants === 'object') {
      // Handle case where variants come as object with numeric keys
      processedVariants = Object.values(variants).map((variant, index) => {
        const size = variant.size?.trim()
        const quantity = parseInt(variant.quantity)
        
        if (!size) {
          errors.push(`Variant ${index + 1}: Size is required`)
        }
        
        if (isNaN(quantity) || quantity < 0) {
          errors.push(`Variant ${index + 1}: Quantity must be a non-negative number`)
        }
        
        return {
          size: size,
          quantity: quantity || 0
        }
      })
    } else {
      errors.push("At least one product variant is required")
    }

    // Validate that at least one variant exists
    if (processedVariants.length === 0) {
      errors.push("At least one product variant is required")
    }

    // Check for duplicate sizes in variants
    const sizes = processedVariants.map(v => v.size).filter(s => s)
    const uniqueSizes = [...new Set(sizes)]
    if (sizes.length !== uniqueSizes.length) {
      errors.push("Duplicate sizes found in variants. Each variant must have a unique size.")
    }

    // ========== DUPLICATE NAME CHECK ==========
    
    // Only check for duplicates if the product name is actually being changed
    const isNameChanged = normalizedProductName.toLowerCase() !== product.productName.toLowerCase()

    if (isNameChanged) {
      // Check for existing product with same name (case-insensitive), excluding current product
      const existingProduct = await Product.findOne({
        productName: { $regex: new RegExp(`^${normalizedProductName}$`, 'i') },
        _id: { $ne: id },
      })

      if (existingProduct) {
        errors.push("Product with this name already exists. Please try another name.")
      }
    }

    // ========== IMAGE VALIDATION ==========
    
    // Count existing images and new uploads
    let imageCount = 0
    let hasNewImages = false
    
    // Count existing images that are not null/empty
    const existingImages = product.productImage.filter(img => img && img.trim() !== '')
    imageCount += existingImages.length
    
    // Count new cropped images
    for (let i = 1; i <= 4; i++) {
      const croppedImageData = req.body[`croppedImage${i}`]
      if (croppedImageData && croppedImageData.startsWith('data:image')) {
        hasNewImages = true
        // This will replace an existing image or add a new one
        if (i > existingImages.length) {
          imageCount++
        }
      }
    }
    
    // Count new uploaded files
    if (req.files) {
      for (let i = 1; i <= 4; i++) {
        if (req.files[`image${i}`]) {
          hasNewImages = true
          // This will replace an existing image or add a new one
          if (i > existingImages.length && !req.body[`croppedImage${i}`]) {
            imageCount++
          }
        }
      }
    }
    
    // Calculate final image count after processing
    let finalImageCount = Math.max(existingImages.length, 0)
    for (let i = 1; i <= 4; i++) {
      const croppedImageData = req.body[`croppedImage${i}`]
      const hasFileUpload = req.files && req.files[`image${i}`]
      
      if (croppedImageData && croppedImageData.startsWith('data:image')) {
        if (i > finalImageCount) {
          finalImageCount = i
        }
      } else if (hasFileUpload) {
        if (i > finalImageCount) {
          finalImageCount = i
        }
      }
    }
    
    // Require exactly 4 images
    if (finalImageCount < 4 && !hasNewImages) {
      errors.push("Exactly 4 product images are required. Please upload missing images.")
    }

    // ========== RETURN VALIDATION ERRORS ==========
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors
      })
    }

    // ========== PROCESSING SECTION ==========
    
    // Prepare update fields
    const updateFields = {
      productName: normalizedProductName,
      description: normalizedDescription,
      regularPrice: parsedRegularPrice,
      salePrice: parsedSalePrice,
      variants: processedVariants,
      color: color.trim(),
      brand: normalizedBrand,
      category,
    }

    // Handle image uploads
    for (let i = 1; i <= 4; i++) {
      const croppedImageData = req.body[`croppedImage${i}`];
      
      if (croppedImageData && croppedImageData.startsWith('data:image')) {
        // Process cropped image
        const base64Data = croppedImageData.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        const filename = Date.now() + "-" + `cropped-image-${i}` + ".webp";
        const filepath = path.join(__dirname, "../karma-master/uploads/product-images", filename);

        await sharp(imageBuffer)
          .webp({ quality: 80 })
          .toFile(filepath);

        const imagePath = `uploads/product-images/${filename}`;

        // Ensure array has enough elements
        while (product.productImage.length < i) {
          product.productImage.push(null);
        }
        product.productImage[i - 1] = imagePath;
        
      } else if (req.files && req.files[`image${i}`]) {
        // Process regular uploaded file
        const file = req.files[`image${i}`][0];
        const filename = Date.now() + "-" + file.originalname.replace(/\s/g, "") + ".webp";
        const filepath = path.join(__dirname, "../karma-master/uploads/product-images", filename);

        await sharp(file.buffer)
          .resize(800, 800, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(filepath);

        const imagePath = `uploads/product-images/${filename}`;

        // Ensure array has enough elements
        while (product.productImage.length < i) {
          product.productImage.push(null);
        }
        product.productImage[i - 1] = imagePath;
      }
    }

    // Final check - ensure we have 4 images after processing
    const finalProductImages = product.productImage.filter(img => img && img.trim() !== '')
    if (finalProductImages.length < 4) {
      return res.status(400).json({
        success: false,
        message: `Only ${finalProductImages.length} images available. Please upload ${4 - finalProductImages.length} more image(s) to complete the requirement of 4 images.`,
        currentImageCount: finalProductImages.length,
        requiredImageCount: 4
      })
    }

    // Apply updates to the product
    Object.assign(product, updateFields);
    
    // Save the updated product
    await product.save();

    res.json({ 
      success: true, 
      message: "Product updated successfully with all validations passed",
      productId: product._id,
      imageCount: finalProductImages.length
    });

  } catch (error) {
    console.error("Error in editProduct:", error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        success: false, 
        message: "Database validation failed",
        errors: validationErrors
      });
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: "Product with this name already exists. Please try another name." 
      });
    }

    // Handle file system errors
    if (error.code === 'ENOENT' || error.code === 'EACCES') {
      return res.status(500).json({ 
        success: false, 
        message: "File system error occurred while processing images" 
      });
    }

    res.status(500).json({ 
      success: false, 
      message: "An unexpected error occurred while updating the product",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};



const deleteSingleImage = async (req, res) => {
  try {
    const { imageNameToServer, productIdToServer, imageIndex } = req.body;
    const product = await Product.findById(productIdToServer);

    if (!product) {
      return res.status(404).json({ status: false, message: "Product not found" });
    }

    
    product.productImage.splice(imageIndex, 1);
    await product.save();

    const imagePath = path.join(__dirname, "../karma-master", imageNameToServer);

    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      console.log(`Image ${imageNameToServer} deleted successfully`);
    } else {
      console.log(`Image ${imageNameToServer} not found`);
    }

    res.json({ status: true, message: "Image deleted successfully" });
  } catch (error) {
    console.error("Error in deleteSingleImage:", error);
    res.status(500).json({ status: false, message: "An error occurred while deleting the image" });
  }
};



const deleteProduct = async (req, res) => {
  const productId = req.query.id;
  
  if (!productId) {
      return res.status(400).json({ status: false, message: 'Product ID is required' });
  }
  
  try {
      
      const product = await Product.findByIdAndDelete(productId);

      if (!product) {
          return res.status(404).json({ status: false, message: 'Product not found' });
      }

      res.redirect('/admin/products'); 
  } catch (err) {
      console.error(err);
      res.status(500).json({ status: false, message: 'Server Error' });
  }
}




const productDetails = async (req, res) => {
  try {
    const userId = req.session.user;
    const userData = await User.findById(userId);
    const productId = req.query.id;
    const product = await Product.findById(productId).populate('category');
    const findCategory = product.category;
    const categoryOffer = findCategory?.categoryOffer || 0;
    const productOffer = product.productOffer || 0;
    const totalOffer = categoryOffer + productOffer;

    // Fetch latest products only
    const categories = await Category.find({ isListed: true });
    const categoryIds = categories.map(category => category._id.toString());

    const products = await Product.find({
      isBlocked: false,
      category: { $in: categoryIds },
      quantity: { $gt: 0 },
    })
      .sort({ createdOn: -1 })
      .skip(0)
      .limit(9);

    res.render("product-details", {
      user: userData,
      product: product,
      products: products,  
      quantity: product.quantity,
      totalOffer: totalOffer,
      category: findCategory
    });

  } catch (error) {
    console.error("Error for fetching product details", error);
    res.redirect("/pageNotFound");
  }
};














// EXPORT CONTROLLER
module.exports = {
  getProductAddPage,
  saveImage,
  addProducts,
  getAllProducts,
  removeProductOffer,
  addProductOffer,
  calculateEffectivePrice,
  unblockProduct,
  blockProduct,
  getEditProduct,
  editProduct,
  deleteProduct,
  deleteSingleImage,
  productDetails,
};


