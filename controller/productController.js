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
    const productExists = await Product.findOne({ productName });
  

if (productExists) {
  // Check if any new variant size already exists in the product
  const isSizeDuplicate = variants.some(newVariant =>
    productExists.variants.some(existingVariant =>
      existingVariant.size.toLowerCase() === newVariant.size.toLowerCase() 
    
    )
  );
    if (isSizeDuplicate) {
    return res.status(400).json({
      success: false,
      message: "Already exist this product",
    });
  }
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

  

      if(salePrice > regularPrice) {
      return res.json({success : false, message : "SalesPrice is grether than RegularPrice"})
  }
  if(salePrice < 0 || regularPrice < 0) {
     return res.json({success : false, message : "Please check price in product!!"})
  } 
   
   

    
  

    const newProduct = new Product({
      productName,
      description: fullDescription, 
      brand,
      category: foundCategory._id,
      regularPrice,
      salePrice,
      color,
      productImage: imageFilenames,
      createdOn: new Date(),
      variants : variants,
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

    const existingProduct = await Product.findOne({
      productName: productName,
      _id: { $ne: id },
    })

    if (existingProduct) {
      return res
        .status(400)
        .json({ success: false, message: "Product with this name already exists. Please try another name." })
    }



    const updateFields = {
      productName,
      description,
      regularPrice,
      salePrice,
      variants,
      color,
      brand,
      category,
    }

    const product = await Product.findById(id)
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" })
    }

    
    for (let i = 1; i <= 4; i++) {
      const croppedImageData = req.body[`croppedImage${i}`];
      
      if (croppedImageData && croppedImageData.startsWith('data:image')) {
        
        const base64Data = croppedImageData.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
       
        const filename = Date.now() + "-" + `cropped-image-${i}` + ".webp";
        const filepath = path.join(__dirname, "../karma-master/uploads/product-images", filename);

      
        await sharp(imageBuffer)
          .webp({ quality: 80 })
          .toFile(filepath);

        const imagePath = `uploads/product-images/${filename}`;

        
        if (product.productImage[i - 1]) {
          product.productImage[i - 1] = imagePath;
        } else {
          product.productImage.push(imagePath);
        }
      } else if (req.files && req.files[`image${i}`]) {
        
        const file = req.files[`image${i}`][0];
        const filename = Date.now() + "-" + file.originalname.replace(/\s/g, "") + ".webp";
        const filepath = path.join(__dirname, "../karma-master/uploads/product-images", filename);

        await sharp(file.buffer)
          .resize(800, 800, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(filepath);

        const imagePath = `uploads/product-images/${filename}`;

        if (product.productImage[i - 1]) {
          product.productImage[i - 1] = imagePath;
        } else {
          product.productImage.push(imagePath);
        }
      }
    }

    Object.assign(product, updateFields);
    await product.save();

    res.json({ success: true, message: "Product updated successfully" });
  } catch (error) {
    console.error("Error in editProduct:", error);
    res.status(500).json({ success: false, message: "An error occurred while updating the product" });
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


