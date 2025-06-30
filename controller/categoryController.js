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
  
      if (!description || description.trim().length === 0) {
        return res.status(400).json({ success: false, message: "Description is required" })
      }
  
      // Enhanced function to normalize text for comparison
      function normalizeText(text) {
        return text
          .toLowerCase()
          .trim()
          // Replace all types of apostrophes and quotes with standard ones
          .replace(/[''`'"]/g, "'")
          .replace(/[""]/g, '"')
          // Remove extra spaces and normalize whitespace
          .replace(/\s+/g, ' ')
          // Remove common punctuation that might be inconsistent
          .replace(/[.,;:!?]/g, '')
          // Handle common word variations
          .replace(/\b(and|&)\b/g, 'and')
          .replace(/\b(womens?|women's)\b/g, 'women')
          .replace(/\b(mens?|men's)\b/g, 'men')
          .replace(/\b(kids?|children's?)\b/g, 'kids')
      }
      
      const normalizedInputName = normalizeText(trimmedName)
      console.log('Input name normalized:', normalizedInputName)
      
      // Get all categories and check for duplicates
      const allCategories = await Category.find({})
      
      for (let category of allCategories) {
        const normalizedExistingName = normalizeText(category.name)
        console.log('Existing name normalized:', normalizedExistingName)
        
        if (normalizedExistingName === normalizedInputName) {
          console.log('DUPLICATE FOUND!')
          return res.status(409).json({ 
            success: false, 
            message: `Duplicate category` 
          })
        }
      }

      // Additional check for very similar names using edit distance
      const isSimilar = (str1, str2) => {
        const levenshteinDistance = (a, b) => {
          const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null))
          
          for (let i = 0; i <= a.length; i += 1) {
            matrix[0][i] = i
          }
          
          for (let j = 0; j <= b.length; j += 1) {
            matrix[j][0] = j
          }
          
          for (let j = 1; j <= b.length; j += 1) {
            for (let i = 1; i <= a.length; i += 1) {
              const indicator = a[i - 1] === b[j - 1] ? 0 : 1
              matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + indicator
              )
            }
          }
          
          return matrix[b.length][a.length]
        }
        
        const distance = levenshteinDistance(str1, str2)
        const maxLength = Math.max(str1.length, str2.length)
        const similarity = 1 - (distance / maxLength)
        
        return similarity > 0.85 
      }

      // Check for very similar names
      for (let category of allCategories) {
        const normalizedExistingName = normalizeText(category.name)
        
        if (isSimilar(normalizedInputName, normalizedExistingName)) {
          console.log('SIMILAR CATEGORY FOUND!')
          return res.status(409).json({ 
            success: false, 
            message: `Duplicate category` 
          })
        }
      }
  
      const newCategory = new Category({ name: trimmedName, description: description.trim() })
      const savedCategory = await newCategory.save()
      
      res.status(201).json({ 
        success: true, 
        message: "Category added successfully", 
        category: savedCategory 
      })
    } catch (error) {
      console.error("Error in addCategory:", error)
      
      // Handle MongoDB duplicate key error
      if (error.code === 11000) {
        return res.status(409).json({ 
          success: false, 
          message: "Category with this name already exists" 
        })
      }
      
      res.status(500).json({ 
        success: false, 
        message: "Failed to add category", 
        error: error.message 
      })
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