const Brand = require('../models/brandSchema');
const Product = require('../models/productSchema');

const getBrandPage = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 6;
    const skip = (page - 1) * limit;

    const brandData = await Brand.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalBrands = await Brand.countDocuments();
    const totalPages = Math.ceil(totalBrands / limit);

    res.render('brands', {
      data: brandData,
      currentPage: page,
      totalPages,
      totalBrands,
      error: req.query.error,  // Pass error query parameter
      success: req.query.success  // Pass success query parameter
    });
  } catch (error) {
    console.error('Error fetching brand data:', error);
    res.redirect('/pageerror');
  }
};

const addBrand = async (req, res) => {
  try {
    const brandName = req.body.name.trim();
    
    // Check if brand name is empty
    if (!brandName) {
      return res.redirect('/admin/brands?error=Brand name is required');
    }

    const existingBrand = await Brand.findOne({ brandName: { $regex: new RegExp(`^${brandName}$`, 'i') } });

    if (existingBrand) {
      return res.redirect('/admin/brands?error=Brand already exists');
    }

    if (!req.file) {
      return res.redirect('/admin/brands?error=Brand image is required');
    }

    const newBrand = new Brand({
      brandName,
      brandImage: [req.file.filename],
    });

    await newBrand.save();
    return res.redirect('/admin/brands?success=Brand added successfully');
    
  } catch (error) {
    console.error('Add brand error:', error);
    res.redirect('/admin/brands?error=Something went wrong');
  }
};

const blockBrand = async (req, res) => {
  try {
    const id = req.query.id;
    await Brand.updateOne({ _id: id }, { $set: { isBlocked: true } });
    res.redirect('/admin/brands');
  } catch (error) {
    console.error('Block brand error:', error);
    res.redirect('/pageerror');
  }
};

const unBlockBrand = async (req, res) => {
  try {
    const id = req.query.id;
    await Brand.updateOne({ _id: id }, { $set: { isBlocked: false } });
    res.redirect('/admin/brands');
  } catch (error) {
    console.error('Unblock brand error:', error);
    res.redirect('/pageerror');
  }
};

const deleteBrand = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).redirect('/pageerror');
    }

    await Brand.deleteOne({ _id: id });
    res.redirect('/admin/brands');
  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).redirect('/pageerror');
  }
};

module.exports = {
  getBrandPage,
  addBrand,
  blockBrand,
  unBlockBrand,
  deleteBrand,
};



