const User = require('../models/userSchema')
const Category = require('../models/categorySchema'); 
const Product = require("../models/productSchema")



const categoryInfo = async (req, res) => {
    try {
      const page = Number.parseInt(req.query.page) || 1
      const limit = 12
      const skip = (page - 1) * limit
  
      const query = {}
      if (req.query.search) {
        query.name = { $regex: `^${req.query.search}`, $options: "i" }
      }
      if (req.query.minOffer || req.query.maxOffer) {
        query.categoryOffer = {}
        if (req.query.minOffer) query.categoryOffer.$gte = Number.parseInt(req.query.minOffer)
        if (req.query.maxOffer) query.categoryOffer.$lte = Number.parseInt(req.query.maxOffer)
      }
  
      const categories = await Category.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit)
  
      const totalCategories = await Category.countDocuments(query)
      const totalPages = Math.ceil(totalCategories / limit)
  
      if (req.xhr || req.headers.accept.indexOf("json") > -1) {
        // If it's an AJAX request, send JSON response
        res.json({
          categories: categories,
          currentPage: page,
          totalPages: totalPages,
          totalCategories: totalCategories,
        })
      } else {
        // If it's a regular request, render the page
        res.render("category", {
          categories: categories,
          currentPage: page,
          totalPages: totalPages,
          totalCategories: totalCategories,
        })
      }
    } catch (error) {
      console.error(error)
      if (req.xhr || req.headers.accept.indexOf("json") > -1) {
        res.status(500).json({ error: "An error occurred while fetching categories" })
      } else {
        res.redirect("/pageerror")
      }
    }
  }


const addCategory = async (req, res) => {
    try {
      const { name, description } = req.body
  
      
      const trimmedName = name.trim()
      if (!trimmedName || trimmedName.length === 0) {
      
        return res.status(400).json({ success: false, message: "Category name cannot be empty" })
      }
  
      if (!description) {
      
        return res.status(400).json({ success: false, message: "Description is required" })
      }
  
      
      const existingCategory = await Category.findOne({ name: new RegExp(`^${trimmedName}$`, "i") })
      if (existingCategory) {
        
        return res.status(400).json({ success: false, message: "Category with this name already exists" })
      }
  
      const newCategory = new Category({ name: trimmedName, description })
      const savedCategory = await newCategory.save()
      
      res.status(201).json({ success: true, message: "Category added successfully", category: savedCategory })
    } catch (error) {
      console.error("Error in addCategory:", error)
      res.status(500).json({ success: false, message: "Failed to add category", error: error.message })
    }
  }


const addCategoryOffer = async (req, res) => {
    try {
      const { categoryId, percentage } = req.body;
      const category = await Category.findById(categoryId);
      if (!category) {
        return res.status(404).json({ status: false, message: "Category not found" });
      }
      if (isNaN(percentage) || percentage < 0 || percentage > 10) {
        return res.json({ status: false, message: "Invalid percentage value" });
      }
      await Category.updateOne({ _id: categoryId }, { $set: { categoryOffer: percentage } });
  
      // Update all products in this category
      const products = await Product.find({ category: categoryId });
      for (const product of products) {
        product.salePrice = await calculateEffectivePrice(product);
        await product.save();
      }
  
      res.json({ status: true, message: "Offer added successfully" });
    } catch (error) {
      console.error("Error in addCategoryOffer:", error);
      return res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  };


  const removeCategoryOffer = async (req, res) => {
    try {
      const categoryId = req.body.categoryId;
      const category = await Category.findById(categoryId);
      if (!category) {
        return res.status(404).json({ status: false, message: "Category not found" });
      }
      await Category.updateOne({ _id: categoryId }, { $set: { categoryOffer: null } });
  
      // Update all products in this category
      const products = await Product.find({ category: categoryId });
      for (const product of products) {
        product.salePrice = await calculateEffectivePrice(product);
        await product.save();
      }
  
      res.json({ status: true, message: "Offer removed successfully" });
    } catch (error) {
      console.error("Error in removeCategoryOffer:", error);
      return res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  };

  const getListCategory = async (req, res) => {
    try {
      const id = req.query.id
      await Category.findByIdAndUpdate(id, { isListed: false })
      res.json({ success: true, message: "Category unlisted successfully" })
    } catch (error) {
      console.error(error)
      res.status(500).json({ success: false, message: "Failed to unlist category" })
    }
  }
  
  const getUnlistCategory = async (req, res) => {
    try {
      const id = req.query.id
      await Category.findByIdAndUpdate(id, { isListed: true })
      res.json({ success: true, message: "Category listed successfully" })
    } catch (error) {
      console.error(error)
      res.status(500).json({ success: false, message: "Failed to list category" })
    }
  }


  const getEditCategory = async (req, res) => {
    try {
      const categoryId = req.params.id
      const category = await Category.findById(categoryId)
      if (!category) {
        return res.status(404).json({ success: false, message: "Category not found" })
      }
      res.json({ success: true, category })
    } catch (error) {
      console.error(error)
      res.status(500).json({ success: false, message: "Failed to fetch category" })
    }
  }


 const editCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const { name, description } = req.body;

    const normalizedNewName = name.trim().toLowerCase();

    // Check for duplicate name (case-insensitive)
    const existing = await Category.findOne({ 
      _id: { $ne: categoryId },
      name: { $regex: new RegExp(`^${normalizedNewName}$`, 'i') }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'Category name already exists' });
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      categoryId,
      { name: name.trim(), description },
      { new: true }
    );

    if (!updatedCategory) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    res.json({ success: true, message: "Category updated successfully" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to update category" });
  }
};

  
  const editCategoryOffer = async (req, res) => {
    try {
      const percentage = Number.parseInt(req.body.percentage);
      const categoryId = req.body.categoryId;
  
      if (isNaN(percentage) || percentage < 0 || percentage > 99) {
        return res.json({ status: false, message: "Invalid percentage value" });
      }
  
      const category = await Category.findById(categoryId);
      if (!category) {
        return res.status(404).json({ status: false, message: "Category not found" });
      }
  
      await Category.updateOne({ _id: categoryId }, { $set: { categoryOffer: percentage } });
  
      const products = await Product.find({ category: categoryId });
      for (const product of products) {
        product.salePrice = await calculateEffectivePrice(product);
        await product.save();
      }
  
      res.json({ status: true, message: "Offer updated successfully" });
    } catch (error) {
      console.error("Error in editCategoryOffer:", error);
      return res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  };
  
  
  const deleteCategory = async (req, res) => {
      try {
        const categoryId = req.params.id
        const deletedCategory = await Category.findByIdAndDelete(categoryId)
        if (!deletedCategory) {
          return res.status(404).json({ success: false, message: "Category not found" })
        }
        res.json({ success: true, message: "Category deleted successfully" })
      } catch (error) {
        console.error("Error in deleteCategory:", error)
        res.status(500).json({ success: false, message: "Failed to delete category" })
      }
    }

    const calculateEffectivePrice = async (product) => {
      const category = await Category.findById(product.category);
      const categoryOffer = category ? category.categoryOffer || 0 : 0;
      const productOffer = product.productOffer || 0;
    
      const effectiveOffer = Math.max(categoryOffer, productOffer);
      const effectivePrice = product.regularPrice * (1 - effectiveOffer / 100);
    
      return Math.round(effectivePrice * 100) / 100;
    };

  
  module.exports = { categoryInfo, 
                  addCategory,
                  addCategoryOffer,
                  removeCategoryOffer,
                   getListCategory,
                  getUnlistCategory,
                   getEditCategory,
                   editCategory,
                   editCategoryOffer,
                    deleteCategory, 
                   calculateEffectivePrice }